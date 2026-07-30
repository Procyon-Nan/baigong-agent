/**
 * 讯飞星火 MaaS API 实现（Embedding + Rerank 共用一个文件）。
 *
 * 功能：对接讯飞 MaaS（OpenAI 兼容格式），实现 Embedder 接口和 rerank 调用。
 * 创建日期: 2026-07-30
 *
 * 接入信息（已从控制台确认，地址/密钥走环境变量，见 .env 或配置文档）：
 *   根地址：https://maas-api.cn-huabei-1.xf-yun.com
 *   Embedding：POST /v2/embeddings   body: { model, input }
 *   Rerank：    POST /v2/rerank       body: { model, query, documents }
 *   鉴权：Authorization: Bearer <APIKey>
 *   模型：Embedding = xop3qwen8bembedding，Rerank = xop3qwen8breranker
 *
 * 输入: 文本 / 文本数组 / (query + documents)。
 * 输出: ① EmbedResult（向量） ② RerankItem（重排结果，见 reranker.ts）。
 *
 * 注意：
 *   - rerank 返回的 results 默认不按分数排序，本实现内部已按 relevance_score 降序排好。
 *   - 超时/鉴权失败抛出明确错误，便于上层降级（向量挂了退关键词检索）。
 */

import "server-only";
import type { Embedder, EmbedResult } from "../embedder";
import type { RerankItem } from "../reranker";
import { xfyunConfig } from "../retrieval.config";

/** 讯飞 MaaS 配置 */
export interface XfyunMaasConfig {
  /** 根地址，默认华北1 */
  baseUrl: string;
  /** APIKey（从环境变量读，不写死） */
  apiKeyEnv: string;
  /** Embedding 模型 ID */
  embeddingModel: string;
  /** Rerank 模型 ID */
  rerankModel: string;
  /** 请求超时（毫秒），默认 15000 */
  timeoutMs?: number;
  /** 维度（留空则从首次返回自动读取） */
  dim?: number;
  /**
   * 输出维度（传给讯飞的 dimensions 参数）。Qwen3-Embedding-8B 支持 32~4096。
   * 不填则用讯飞默认（768）；填 4096 用原生最高维。
   * ⚠️ 改维度 = 已入库向量作废，需重建索引；建表向量列维度须与此一致。
   */
  dimensions?: number;
  /**
   * 每秒最大请求数（QPS）。控制台限流值，默认 20。
   * 入库流水线按此控制节奏，避免触发限流导致超时/拒绝。
   */
  qps?: number;
  /**
   * 单批嵌入的文本条数。批量嵌入时按此切分，避免单次请求过大。
   * 默认 16（经验值，兼顾吞吐与不超限）。
   */
  batchSize?: number;
}

/**
 * 默认配置：从 retrieval.config.ts 集中读取（参数在那里统一调整）。
 * 改参数请去 src/server/retrieval/retrieval.config.ts，不要改这里。
 */
export const XFYUN_DEFAULT_CONFIG: XfyunMaasConfig = {
  baseUrl: xfyunConfig.baseUrl,
  apiKeyEnv: xfyunConfig.apiKeyEnv,
  embeddingModel: xfyunConfig.embeddingModel,
  rerankModel: xfyunConfig.rerankModel,
  timeoutMs: xfyunConfig.timeoutMs,
  dimensions: xfyunConfig.embeddingDimensions,
  batchSize: xfyunConfig.embeddingBatchSize,
};

/**
 * 讯飞 MaaS 共用的 HTTP 调用。
 * 返回解析后的 JSON；鉴权失败或超时抛出带上下文的错误。
 */
async function maasPost(
  config: XfyunMaasConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<any> {
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `[xfyun] 缺少环境变量 ${config.apiKeyEnv}（讯飞 MaaS APIKey）。请在 .env 或部署环境中配置。`,
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 15000);
  try {
    const res = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`[xfyun] ${path} 返回 ${res.status}: ${text.slice(0, 300)}`);
    }
    return await res.json();
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error(`[xfyun] ${path} 请求超时（${config.timeoutMs ?? 15000}ms）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 创建讯飞 MaaS 嵌入器（实现 Embedder 接口）。
 */
export function createXfyunEmbedder(config: XfyunMaasConfig = XFYUN_DEFAULT_CONFIG): Embedder {
  let inferredDim = config.dim;

  async function embedBatch(texts: string[]): Promise<EmbedResult[]> {
    if (texts.length === 0) return [];
    const body: Record<string, unknown> = { model: config.embeddingModel, input: texts };
    if (config.dimensions !== undefined) body.dimensions = config.dimensions;
    const json = await maasPost(config, "/v2/embeddings", body);
    // OpenAI 兼容格式：json.data[i].embedding，按 index 对齐
    const data: { embedding: number[]; index: number }[] = json.data ?? [];
    if (data.length === 0) throw new Error("[xfyun] embedding 返回空 data");
    if (inferredDim === undefined) inferredDim = data[0].embedding.length;
    return data
      .sort((a, b) => a.index - b.index)
      .map((d) => ({ vector: d.embedding, dim: inferredDim as number, model: config.embeddingModel }));
  }

  return {
    model: config.embeddingModel,
    get dim() {
      if (inferredDim === undefined) {
        throw new Error(
          "[xfyun] 维度尚未确定：请先调用一次 embed/embedBatch，或在配置里显式指定 dim。",
        );
      }
      return inferredDim;
    },
    async embed(text: string): Promise<EmbedResult> {
      const [r] = await embedBatch([text]);
      return r;
    },
    embedBatch,
  };
}

/**
 * 调用讯飞 MaaS rerank，返回按相关性分数降序排序的结果。
 *
 * 输入：query（用户问题）+ documents（候选文档片段数组）。
 * 输出：RerankItem[]，已按 relevance_score 从高到低排序。
 *
 * 注意：讯飞返回的 results 默认不排序，这里用 relevance_score 降序排好。
 *       index 是原 documents 数组的下标，可用于回溯原文。
 */
export async function xfyunRerank(
  query: string,
  documents: string[],
  config: XfyunMaasConfig = XFYUN_DEFAULT_CONFIG,
): Promise<RerankItem[]> {
  if (documents.length === 0) return [];
  const json = await maasPost(config, "/v2/rerank", {
    model: config.rerankModel,
    query,
    documents,
  });
  const results: { index: number; relevance_score: number }[] = json.results ?? [];
  // 按相关性分数降序排序（官方明确返回默认不排序）
  return results
    .map((r) => ({
      index: r.index,
      score: r.relevance_score,
      text: documents[r.index] ?? "",
    }))
    .sort((a, b) => b.score - a.score);
}
