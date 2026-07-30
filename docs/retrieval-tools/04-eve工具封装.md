"""
检索工具集 —— eve 工具封装

功能: 说明如何把已写好的检索能力（01-03）包装成 eve 工具，让 agentic 自动调用、也能单独调用。
创建日期: 2026-07-30

本文件只讲一件事：怎么给检索能力"装上插头"接到 eve。
前置依赖: 01-嵌入服务.md、02-存储与入库.md、03-检索引擎.md（能力核心已写好）。
依据: 已核实 eve 0.27.11 官方文档（tools / default-harness / subagents）。
"""

# 04 · eve 工具封装（让能力被 agentic / 单独调用都能用）

> 前三篇已经把检索核心逻辑写成了 `lib/` 里的纯函数。本篇讲：**怎么给它"装上插头"接到 eve**，让同事后续两种用法都行。
>
> **官方核实的结论**：eve 鼓励"核心逻辑放 `lib/`，工具是薄包装"。这是同时支持 agentic 调用和单独调用的标准姿势。

---

## 1. 两种用法（回顾）

```
                    ┌─────────────────────────────┐
                    │  lib/ 检索核心（01-03 已写好） │
                    │  vectorSearch()              │
                    │  keywordSearch()             │
                    │  hybridSearch()              │
                    └──────────────┬──────────────┘
                           ┌───────┴────────┐
                           ▼                ▼
                   ┌───────────────┐  ┌─────────────────┐
            用法A  │ eve 工具封装   │  │ 单独调用         │  用法B
   agentic 自动选用 │ agent/tools/  │  │ 任意代码 import  │
                   └───────────────┘  └─────────────────┘
```

- **用法 A**：把工具文件放进 `agent/tools/`，eve 自动发现，模型根据问题选用。
- **用法 B**：在任意代码（API 路由、脚本）直接 `import { vectorSearch } from "@/lib/..."`，不经模型。

**因为核心在 `lib/`，两种用法共用同一套逻辑，不重复造。**

---

## 2. 用法 B：单独调用（最简单，现在已经能用）

只要 01–03 写完了，**不需要任何 eve 的东西**，就能在普通代码里直接用：

```ts
// 例如：app/api/search/route.ts（一个普通 Next.js API 路由）
import { hybridSearch } from "@/server/retrieval/hybrid-search";
import { getAuth } from "@/lib/auth";   // 项目自己的鉴权（P2 后就有）

export async function POST(req: Request) {
  const { query } = await req.json();
  const auth = await getAuth(req);      // 从请求拿当前用户身份
  const result = await hybridSearch({
    query,
    tenantId: auth.tenantId,            // 身份从鉴权来，不从用户输入来
    userId: auth.userId,
    limit: 5,
  });
  return Response.json(result);
}
```

> 这条路**完全绕开 eve 和模型**，适合"固定流程里调一次检索"的场景。

---

## 3. 用法 A：包装成 eve 工具（agentic 自动调用）

### 3.1 eve 工具的核心规则（官方文档原文）

- **文件名即工具名**：`agent/tools/vector_search.ts` → 模型看到工具 `vector_search`。
- **放进目录自动发现**，无需注册。
- **`description` 是模型选用的核心信号**——写给模型看，越具体越好。
- **`inputSchema`** 用 zod 描述参数。
- **`execute(input, ctx)`** 从 `ctx.session.auth` 拿身份（不从 input 拿）。

### 3.2 第一步：写一个从 ctx 取身份的小工具

这是多租户隔离的命脉——**模型只能在 input 里传 query，不能传 tenantId**：

```ts
// agent/lib/tenant-caller.ts
/**
 * 从 eve 的上下文里取出当前租户/用户身份。
 * 检索工具必须用这个取身份，绝不能让模型在参数里传 tenantId。
 *
 * 说明：ctx.session.auth.current 的完整类型在 eve 的 .d.ts 里，
 * 这里只取检索需要的字段。P2 登录验证器落地后字段名以实际为准。
 */
import type { ToolContext } from "eve/tools";

export function requireTenantCaller(ctx: ToolContext): { tenantId: string; userId?: string } {
  const caller = ctx.session.auth.current;
  const tenantId = caller?.attributes?.tenantId as string | undefined;
  if (typeof tenantId !== "string") {
    throw new Error("检索需要已认证的租户用户身份。");
  }
  return { tenantId, userId: caller?.principalId };
}
```

> ⚠️ **依赖同事 P2**：这个文件依赖 `ctx.session.auth.current` 里有 `tenantId`。那是同事 P2 登录验证器要填的。**联调时确认字段名**，现在先按这个写。

### 3.3 第二步：写工具（三个，薄包装）

```ts
// agent/tools/vector_search.ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireTenantCaller } from "../lib/tenant-caller";
import { vectorSearch } from "../../src/server/retrieval/vector-search";

export default defineTool({
  description:
    "在当前租户的知识库中按语义相似度检索文档片段。" +
    "适合概念类、含义类、'怎么做/是什么'类问题。" +
    "返回片段摘要，需要完整原文时再用 fetch_document。",
  inputSchema: z.object({
    query: z.string().min(1).describe("自然语言检索 query"),
    limit: z.number().int().min(1).max(20).default(5),
    collection: z.string().optional().describe("限定知识库 slug，不填查全部"),
  }),
  async execute({ query, limit, collection }, ctx) {
    const { tenantId, userId } = requireTenantCaller(ctx);   // 身份从 ctx 来
    return vectorSearch({ query, tenantId, userId, collectionSlug: collection, limit });
  },
  toModelOutput(output) {
    // 只给模型看精简摘要，省 token
    const summary = output.hits
      .map((h, i) => `${i + 1}. ${h.filename}（分数 ${h.score.toFixed(2)}）\n${h.text}`)
      .join("\n\n");
    return { type: "text", value: summary || "未找到相关文档。" };
  },
});
```

```ts
// agent/tools/keyword_search.ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireTenantCaller } from "../lib/tenant-caller";
import { keywordSearch } from "../../src/server/retrieval/keyword-search";

export default defineTool({
  description:
    "在当前租户的知识库中按关键词精确检索。" +
    "适合查找员工编号、产品型号、专有名词、代码等需要字面匹配的内容。",
  inputSchema: z.object({
    query: z.string().min(1).describe("关键词检索 query"),
    limit: z.number().int().min(1).max(20).default(5),
    collection: z.string().optional(),
  }),
  async execute({ query, limit, collection }, ctx) {
    const { tenantId, userId } = requireTenantCaller(ctx);
    return keywordSearch({ query, tenantId, userId, collectionSlug: collection, limit });
  },
  // toModelOutput 同上，略
});
```

```ts
// agent/tools/hybrid_search.ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireTenantCaller } from "../lib/tenant-caller";
import { hybridSearch } from "../../src/server/retrieval/hybrid-search";

export default defineTool({
  description:
    "在当前租户的知识库中进行混合检索（语义 + 关键词，自动融合）。" +
    "当不确定问题类型、或想要最全面的召回时使用。",
  inputSchema: z.object({
    query: z.string().min(1).describe("检索 query"),
    limit: z.number().int().min(1).max(20).default(5),
    collection: z.string().optional(),
  }),
  async execute({ query, limit, collection }, ctx) {
    const { tenantId, userId } = requireTenantCaller(ctx);
    return hybridSearch({ query, tenantId, userId, collectionSlug: collection, limit });
  },
});
```

> **注意工具的 description**：这是模型决定"调哪个工具"的唯一依据。三种工具的描述刻意区分了适用场景（概念类 / 专名类 / 综合），模型才会正确分流——**这正是 Agentic RAG 打破传统固定管道的关键**。

---

## 4. 为什么这样封装是对的（官方依据）

| 设计点 | 官方依据 |
| --- | --- |
| 核心逻辑放 `lib/` | 文档原文："import shared code from `lib/`"、"share typed helpers via `lib/`" |
| 文件名即工具名、自动发现 | 文档原文："The filename is the tool name the model sees" |
| 身份从 `ctx.session.auth` 取 | 文档原文：`ctx` 携带 `session.auth`；多租户示例均按 `auth.current` 分流 |
| `toModelOutput` 控制模型所见 | 文档原文："project it down with `toModelOutput`" |

> **不要这样做**：在业务代码里直接 `tool.execute(input, fakeCtx)` 调用工具。官方没提供脱离 agent loop 构造 ctx 的方式，这是非受支持用法。**单独调用请走用法 B（直接 import lib），不要走工具的 execute。**

---

## 5. 你现在能做的 vs 需要同事的

| 任务 | 依赖 | 现在能做吗 |
| --- | --- | --- |
| 写 `agent/lib/tenant-caller.ts` | 字段名待 P2 确认 | ✅ 先按预设写，联调时改字段名 |
| 写三个工具文件（vector/keyword/hybrid） | 依赖 01–03 的 lib | ✅ 能写 |
| 工具被 agentic 真正调用 | 依赖同事 P2 验证器 + 真实模型 | ❌ 联调阶段（不阻塞你写代码） |
| 单独调用（用法 B） | 依赖自己的鉴权 | ✅ 你自己就能验证 |

**所以**：用法 A 的代码你现在就能全部写好，只是"真正跑起来让模型调"要等同事 P2。在那之前，用法 B 你已经能独立验证检索能力对不对。

---

## 6. 怎么验证做对了

- **用法 B 验证**（现在就能做）：在临时脚本或 API 路由里 import `hybridSearch`，跑通 → ✅
- **用法 A 验证**（等同事 P2）：把工具文件放进 `agent/tools/`，配好模型，问 agent 一个知识库问题，看它是否自动选了 `vector_search` 等工具 → ✅

---

## 7. 完整文件清单（全套工具做完后的样子）

```
src/server/retrieval/          ← 检索核心（lib，01-03）
  ├─ types.ts / embedder*.ts / tokenizer.ts
  ├─ vector-search.ts / keyword-search.ts / hybrid-search.ts

src/server/indexing/           ← 入库流水线（02）
  ├─ chunker.ts / ingest.ts

agent/lib/tenant-caller.ts     ← 从 ctx 取身份（本篇）
agent/tools/                   ← eve 工具封装（本篇）
  ├─ vector_search.ts
  ├─ keyword_search.ts
  └─ hybrid_search.ts
```

**核心在 `src/server/`（lib），工具在 `agent/tools/`（薄包装）。** 同事只需你的 `agent/tools/` + `agent/lib/` 两个目录，就能接入；想单独调用，直接 import `src/server/retrieval/`。
