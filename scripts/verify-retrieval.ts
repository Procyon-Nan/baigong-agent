/**
 * 检索工具验证脚本（临时，验证完可删）。
 *
 * 功能：实际调用讯飞 MaaS，验证 embedding 和 rerank 是否能跑通。
 * 创建日期: 2026-07-30
 *
 * 输入: 从 .env 读 XFYUN_API_KEY；用几段固定的测试文本。
 * 输出: ① embedding 返回的向量维度和前几个数字；② rerank 返回的排序结果。
 *
 * 运行: node --import tsx scripts/verify-retrieval.ts
 */

import "dotenv/config";  // 自动加载 .env
import { embedder } from "../src/server/retrieval/embedder-instance";
import { reranker } from "../src/server/retrieval/reranker-instance";

async function main() {
  // 确认 key 加载了（只打印长度，不打印真值）
  const key = process.env.XFYUN_API_KEY;
  if (!key) {
    console.error("❌ 未读到 XFYUN_API_KEY，请确认 .env 已填且脚本从项目根目录运行。");
    process.exit(1);
  }
  console.log(`✅ 已加载 XFYUN_API_KEY（长度 ${key.length}）\n`);

  // ===== ① 测试 embedding =====
  console.log("===== ① 测试 Embedding =====");
  const query = "员工出差怎么报销";
  console.log(`查询文本: "${query}"`);
  const emb = await embedder.embed(query);
  console.log(`✅ 返回向量，维度: ${emb.dim}`);
  console.log(`   前 5 个数字: [${emb.vector.slice(0, 5).map((n) => n.toFixed(4)).join(", ")}]`);

  // 批量
  const batch = await embedder.embedBatch(["报销政策", "请假流程", "服务器配置"]);
  console.log(`✅ 批量嵌入 ${batch.length} 段，每段维度 ${batch[0].dim}\n`);

  // ===== ② 测试 rerank =====
  console.log("===== ② 测试 Rerank =====");
  const documents = [
    "员工出差后需在 7 天内提交报销申请，附发票。",
    "公司服务器每天凌晨 3 点自动备份。",
    "请假需提前在 OA 系统提交，由主管审批。",
    "差旅费标准：一线城市住宿上限 500 元/晚。",
    "新员工入职需配置工位和电脑。",
  ];
  console.log(`查询: "${query}"`);
  console.log(`候选文档 ${documents.length} 段，重排结果（应把报销相关的顶到前面）：`);
  const items = await reranker.rerank({ query, documents, topN: 3 });
  items.forEach((item, i) => {
    console.log(`  ${i + 1}. [分数 ${item.score.toFixed(4)}] ${item.text}`);
  });

  console.log("\n✅ 全部通过：embedding + rerank 正常工作。");
}

main().catch((err) => {
  console.error("❌ 验证失败：", err);
  process.exit(1);
});
