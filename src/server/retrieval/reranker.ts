/**
 * Reranker 服务接口定义（与具体厂商解耦）。
 *
 * 功能：定义「对召回结果做精排」的统一接口 Reranker。
 *       在向量/关键词召回（粗筛出几十段）之后，用它按相关性重新排序，把最相关的顶到前面。
 * 创建日期: 2026-07-30
 *
 * 输入: RerankInput（query + documents 候选片段 + 可选 topN）。
 * 输出: RerankItem[]（按相关性分数降序排序的结果）。
 *
 * 设计要点：
 *   - 与 Embedder 同思路：接口固定，实现可换（讯飞/别家）。
 *   - 检索链路中的位置：召回 Top20 → reranker 精排 → 取 Top5。量小，免费额度够用。
 */

/** rerank 输入 */
export interface RerankInput {
  /** 用户问题 / 查询语句 */
  query: string;
  /** 召回出的候选文档片段（粗筛后的几十段） */
  documents: string[];
  /** 返回前 N 条；不填则全部返回（已按分数排序） */
  topN?: number;
}

/** 单条 rerank 结果 */
export interface RerankItem {
  /** 在原 documents 数组里的下标（用于回溯原文） */
  index: number;
  /** 相关性分数（越高越相关） */
  score: number;
  /** 文档片段原文（已回填，方便上层直接用） */
  text: string;
}

/**
 * Reranker 接口：所有实现（讯飞/别家）都要满足这个形状。
 */
export interface Reranker {
  /** 对一组文档按 query 重排序，返回按相关性降序的结果 */
  rerank(input: RerankInput): Promise<RerankItem[]>;
}
