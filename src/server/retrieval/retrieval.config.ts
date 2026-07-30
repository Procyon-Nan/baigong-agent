/**
 * 检索工具 · 集中配置文件。
 *
 * 功能：把检索相关的「可调参数」集中在一处，方便调整，不用翻实现代码。
 * 创建日期: 2026-07-30
 *
 * 设计原则：
 *   - 密钥（XFYUN_API_KEY）不放这里 → 放 .env（敏感、不进仓库）。
 *   - 可调参数（维度/批次/限流/超时）集中在这里 → 进仓库、有 git 记录、一目了然。
 *   - 实现逻辑（怎么调讯飞接口）在 embedders/xfyun-maas.ts，不在这里。
 *
 * 调整方式：直接改本文件里对应数值即可，注释标了每个参数的含义和注意事项。
 */

/** 讯飞星火 MaaS 配置 */
export const xfyunConfig = {
  /** 讯飞 MaaS 根地址（华北1节点） */
  baseUrl: "https://maas-api.cn-huabei-1.xf-yun.com",

  /** APIKey 的环境变量名（真值放 .env，不写死） */
  apiKeyEnv: "XFYUN_API_KEY",

  /** Embedding 模型 ID（Qwen3-Embedding-8B） */
  embeddingModel: "xop3qwen8bembedding",

  /** Rerank 模型 ID（Qwen3-Reranker-8B） */
  rerankModel: "xop3qwen8breranker",

  /**
   * Embedding 输出维度。Qwen3-8B 支持 32~4096。
   *   - 4096 = 原生最高维（测试期推荐，效果最佳）
   *   - 讯飞默认会压成 768（不指定时）
   * ⚠️ 改维度 = 已入库向量作废，需重建索引；建表（02）的向量列维度必须同步改。
   */
  embeddingDimensions: 4096,

  /**
   * 批量嵌入时每批的文本条数。
   * 讯飞 QPS/并发上限 20，每批 16 留余量，避免限流超时。
   */
  embeddingBatchSize: 16,

  /** 单次请求超时（毫秒） */
  timeoutMs: 15000,
} as const;

/** 检索相关参数（召回与精排） */
export const retrievalConfig = {
  /** 向量召回数量（粗筛，reranker 前先召回这么多条） */
  recallTopK: 20,

  /** reranker 精排后最终返回的条数 */
  finalTopN: 5,

  /** 切片大小（每段字符数） */
  chunkMaxChars: 500,

  /** 切片重叠（相邻段重叠字符数，避免切断语义） */
  chunkOverlap: 50,
} as const;
