/**
 * 嵌入器统一出口。
 *
 * 功能：实例化具体嵌入器，供上层（入库流水线、检索引擎）import。
 * 创建日期: 2026-07-30
 *
 * 当前实现：讯飞 MaaS（Qwen3-Embedding-8B）。
 * 切换后端：只改这一个文件（换 import 和工厂函数），上层代码不动。
 *   ⚠️ 换模型 = 已入库向量作废，需重新跑入库流水线。
 */

import "server-only";
import { createXfyunEmbedder, XFYUN_DEFAULT_CONFIG } from "./embedders/xfyun-maas";

/**
 * 全局嵌入器实例。
 * 上层代码只 import 这个 `embedder`，不直接碰具体实现。
 */
export const embedder = createXfyunEmbedder(XFYUN_DEFAULT_CONFIG);
