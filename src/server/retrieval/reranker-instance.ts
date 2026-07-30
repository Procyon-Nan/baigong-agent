/**
 * Reranker 统一出口。
 *
 * 功能：实例化讯飞 reranker，供检索引擎（hybrid_search 召回后精排）import。
 * 创建日期: 2026-07-30
 *
 * 当前实现：讯飞 MaaS（Qwen3-Reranker-8B）。
 * 切换后端：只改这一个文件。
 */

import "server-only";
import { xfyunRerank, XFYUN_DEFAULT_CONFIG } from "./embedders/xfyun-maas";
import type { Reranker, RerankInput, RerankItem } from "./reranker";

/**
 * 全局 reranker 实例。
 * 上层代码只 import 这个 `reranker`。
 */
export const reranker: Reranker = {
  async rerank(input: RerankInput): Promise<RerankItem[]> {
    const items = await xfyunRerank(input.query, input.documents, XFYUN_DEFAULT_CONFIG);
    return input.topN ? items.slice(0, input.topN) : items;
  },
};
