/**
 * 嵌入服务接口定义（与具体厂商解耦）。
 *
 * 功能：定义「把文本变成向量」的统一接口 Embedder。
 *       无论后端是讯飞 MaaS、自建 Qwen3 还是别家，上层（入库流水线、检索引擎）只认这个接口。
 * 创建日期: 2026-07-30
 *
 * 输入: 文本（单条或批量）。
 * 输出: 向量数组（每条文本对应一个 number[]）。
 *
 * 设计要点：
 *   - 入库嵌入（批量、一次性）和查询嵌入（单条、高频）用同一个模型、同一维度。
 *   - 换后端时，上层代码不用改，只换 src/server/retrieval/embedders/ 下的实现文件。
 */

/** 单条嵌入结果 */
export interface EmbedResult {
  /** 向量（一串数字） */
  vector: number[];
  /** 向量维度（必须和建表时向量列的维度一致） */
  dim: number;
  /** 实际使用的模型名（便于排查和记录） */
  model: string;
}

/**
 * 嵌入器接口：所有实现（讯飞/自建/别家）都要满足这个形状。
 * 上层只 import embedder 实例，不直接碰具体实现。
 */
export interface Embedder {
  /** 当前使用的模型名 */
  readonly model: string;
  /** 向量维度 */
  readonly dim: number;
  /** 把一段文本变成向量（查询嵌入走这里，高频低延迟） */
  embed(text: string): Promise<EmbedResult>;
  /** 批量嵌入（入库嵌入走这里，一次性大批量） */
  embedBatch(texts: string[]): Promise<EmbedResult[]>;
}
