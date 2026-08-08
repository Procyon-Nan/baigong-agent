# P5：Agent 基础能力

> 文件名：`docs/P5-Agent基础能力.md`
> 状态：已完成
> 定稿日期：2026-08-06
> 完成日期：2026-08-08
> 前置阶段：P0、P1、P2、P3、P4 已完成

## 1. 目标

P5 在既有安全对话、会话持久化和管理员审计链路上交付以下基础能力：

- 用户当前会话的本地持久化附件。
- 图片和 PDF 的模型原生多模态输入。
- 由管理员实际启用或关闭的动态 Tool，以及无需重新构建或重启即可管理的数据库 Markdown Skill。
- eve 原生根级 `agent` Tool 提供的单层 Subagent。
- 每个 Turn 锁定的不可变 Agent 能力版本。
- 模型 Tool Calling 能力验证和手工声明的多模态能力。

本阶段不把项目扩展为文件管理系统或知识库系统。用户会话附件由本项目保存；外部知识内容、索引和原始知识文件仍由外部系统负责，并在 P6 通过只读 Tool 接入。

## 2. 范围边界

### 2.1 P5 范围

- PNG、JPEG、WebP 和 PDF 会话附件的上传、绑定、权限、额度、展示、预览和下载。
- 文字加附件和仅附件消息。
- 模型版本的图片输入、原生 PDF 输入能力声明。
- 默认模型的完整 `tool_calls` 往返测试。
- 固定启用 eve 原生 `agent` 与 `ask_question`，并为 `todo`、`web_fetch` 和会话附件 Tool提供管理员开关。
- 数据库 Markdown Skill的创建、修改、启停、不可变版本和动态 `load_skill`。
- 每租户固定主 Agent 及不可变能力版本。
- 根级单层 Subagent、父会话附件读取、取消传播和 P4 审计复用。
- 独立 P5 数据库测试、HTTP 验收和真实模型人工验收。

### 2.2 P5 不做

- 不启用终端、Sandbox 或通用文件系统访问。
- 不建设 Docker、Sandbox 后端、终端审批、终端策略或对应管理页面。
- 不启用 `bash`、`read_file`、`write_file`、`glob`、`grep` 或 eve `Workflow`。
- 不建设本地知识库，不上传、解析、分块、Embedding 或索引外部知识文件。
- 不实现 DOCX、TXT、Markdown、CSV、JSON 等文档转换；文档转 Markdown 是未来独立 Tool。
- 不支持旧版 `.doc`。
- 不实现 OCR、多模态描述 Tool 或备用识图模型。
- 不为不支持 Tool Calling 的模型提供兼容或文本协议兜底。
- 不启用 eve 原生、依赖模型提供商能力的 `web_search`。
- 不在 P5 实现自定义搜索 Tool，也不接入 Bing、Google、Tavily、Brave 等搜索供应商；未来单独设计本项目自己的搜索 Tool。
- 不实现 Tool 逐次审批、应用层自动重试或普通用户 Tool 详情页面。
- 不定义固定专家 Subagent，不修改 eve 的单层委派和原生执行机制；应用层采用独立的主 Agent 与 Subagent 并发计数。
- 不支持 Skill脚本、附件、支持文件或其他可执行内容；未来 Agent自行创建 Skill的产品规则不在 P5 实现。

### 2.3 未来保留边界

终端、Sandbox 和通用文件工具不是永久删除，但在当前 P1 至 P10 完整路线内持续禁用。未来确有需要时，必须建立独立方案，重新确认隔离后端、文件挂载、网络策略、资源限制、凭据隔离、审批、审计和验收；未完成该流程前不得留下隐藏入口或仅靠前端关闭的能力。

会话附件 Tool 和 P6 外部知识库只读 Tool 都是服务端受控的特定资源接口，不属于通用文件系统访问。

## 3. 已安装 eve 事实与采用方式

当前项目固定使用 `eve@0.27.12-baigong.4`。P5 依据已安装源码和文档采用以下原生能力：

- eve 请求 `message` 接受字符串或 AI SDK `UserContent`，可混合文本、图片和文件 part。
- `createDataUrlFilePart` 可将受信服务端读取的字节构造为内联 `data:` URL 文件 part。
- `message.received.parts` 只投影可渲染的文件名、媒体类型、大小和可选 URL，不包含原始字节或 Sandbox 路径。
- `disableTool()` 可按同名文件移除框架 Tool，拼写或目标错误会在构建时失败。
- `disableSandbox()` 可按 Agent 节点显式禁用 Sandbox；禁用后不会选择、安装、预热或启动 Sandbox 后端，内联图片和 PDF `FilePart` 原样进入模型适配层。
- disabled Sandbox 下，当前 Turn 的新图片和 PDF 使用文件感知 Token 估算，不会在首次模型调用前因 Base64 文本估算膨胀而触发压缩。
- Tool 返回的图片和 PDF 会临时投影为提供商可识别的多模态用户输入；投影不进入持久历史或事件流，Tool role 也不携带完整 Base64。
- Session/Turn 级动态 Tool 跨模型 Step 重放时保留 `toModelOutput`；无法恢复声明的 mapper 时整个 Tool 失败关闭，不退回包含完整 Base64 的原始 JSON。
- `todo` 使用 eve 原生每会话持久状态。
- `web_fetch` 在应用运行时执行；eve 原生 `web_search` 由支持它的模型提供商托管执行，但 P5 不采用该能力。
- eve 静态 Markdown Skill在构建期扫描并编译，新增或修改后需要重新构建；eve动态 Skill依赖 Sandbox。两者都不符合 P5 的运行时数据库 Skill边界，因此 P5 不使用其原生 Skill注册表。
- 根级 `agent` Tool 创建主 Agent 的副本，继承根 Agent 的指令、连接、身份、Tools 和 Skills，但使用独立会话历史和独立状态；子 Agent 不再获得 `agent` 或 `Workflow`。
- 子 Agent 运行具有独立事件流；父流提供 `subagent.called`、`subagent.completed` 及代理的交互事件。取消父 Turn 时，eve 会请求取消其活动子任务。
- Tool `execute` 获得 `ctx.abortSignal`；支持取消的 I/O 必须传递该信号。

应用继续负责身份、附件授权、动态能力版本解析、安全事件投影和管理员审计，不能把 eve 原生能力本身当作应用授权边界。

### 3.1 P5 的动态能力实现方式

P5 使用百工维护的 eve 补丁版本提供显式无 Sandbox 模式。能力按以下方式组合：

- eve 原生根级 `agent` 与 `ask_question` 固定启用，不进入数据库 Tool开关。
- eve 原生 `web_search` 继续通过 `disableTool()` 固定禁用，未来由本项目实现普通动态搜索 Tool。
- `todo` 与 `web_fetch` 复用 eve原生执行器，但由本项目动态 Tool解析器按 Turn决定是否返回。
- 两个会话附件 Tool由本项目实现为普通动态 Tool。
- 本项目实现数据库驱动的动态 `load_skill` Tool，不注册 `agent/skills/` 静态 Skill，也不使用 eve动态 Skill。

创建或继续 Turn时，BFF把锁定的 `agentConfigVersionId` 写入受签名服务令牌和 `ctx.session.auth`。动态 Tool解析器只从该不可变版本解析 Tool与 Skill版本集合；不接受 Prompt、Tool参数或普通请求体声明版本。当前 Turn内不重新读取主 Agent当前指针，管理员修改从下一 Turn生效。

## 4. 当前持续禁用的能力

以下文件继续导出 `disableTool()`，在所有本地用户、嵌入用户、管理员发起的 Agent Turn 和 Subagent 中保持禁用：

| Tool | 当前决定 |
| --- | --- |
| `bash` | 禁用 |
| `read_file` | 禁用 |
| `write_file` | 禁用 |
| `glob` | 禁用 |
| `grep` | 禁用 |

eve `Workflow` 保持未注册。根 Agent 的 `agent/sandbox.ts` 导出 `disableSandbox()`，以显式阻止默认 Sandbox 后端选择和附件暂存；不新增 Sandbox workspace、Sandbox 镜像、Sandbox 运行时依赖、终端策略数据库字段或管理控件。该语义按 Agent 节点独立生效，未来增加独立配置的静态 Subagent 时必须逐节点确认。

自动化必须读取实际编译后的 Agent 能力清单，确认上述 Tool 均未暴露，不能只断言前端没有入口。

## 5. 模型能力

### 5.1 强制 Tool Calling

所有可分配给 Agent 的模型必须支持 OpenAI Chat Completions `tool_calls`：

- 不根据模型名称猜测是否支持。
- 不支持 Tool Calling 的模型不进入可用 Agent 模型集合。
- 不提供 XML、Markdown、特殊文本标记或二次解析作为兼容协议。
- 不因某个模型不支持 Tool Calling 而减少生产 Tool 集合或改变 Agent 行为。

连接测试仍保留当前固定提示词和现有语义。另增加可选“测试工具调用”按钮：

1. 使用管理员当前尚未保存的表单配置。
2. 服务端临时注册一个无副作用 Tool，并在输入中加入服务端生成的随机值。
3. 让模型实际发起 `tool_calls`，执行临时 Tool，再将结果返回模型，验证完整往返而不是只验证模型能输出普通文本。
4. 页面展示成功或失败、模型最终回复、耗时和 Token 使用量。
5. 临时 Tool 不进入生产 Tool 注册表，不修改或保存模型配置。
6. 测试失败不阻止管理员保存配置，但默认模型在 P5 人工验收中必须通过该测试。
7. 不在该入口自动测试图片或 PDF。
8. 不增加 P5 自定义输出 Token 上限，沿用当前模型和提供商的原生输出限制。

### 5.2 图片和 PDF 能力声明

`model_config_versions` 增加两个不可变字段：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `supports_image_input` | `false` | 模型版本接受 PNG、JPEG、WebP 原生输入 |
| `supports_native_pdf_input` | `false` | 模型版本接受 PDF 原生输入 |

- 两项由管理员手工声明，配置页清楚说明声明必须与实际提供商能力一致。
- 保存模型配置时把声明写入新版本；历史版本不被修改。
- 每个 Turn 使用其锁定模型版本的声明，配置变化从下一 Turn 生效。
- 前端根据当前模型版本阻止选择不支持的附件类型；服务端在上传和消息绑定时再次验证，不能信任前端。
- 图片能力关闭时只提示当前模型不支持图片，不做 OCR 或备用模型识图。
- PDF 能力关闭时只提示当前模型不支持原生 PDF；必须等待未来文档转 Markdown Tool，不做隐藏文本提取。
- 管理员错误声明导致提供商拒绝请求时，只终止本次回复，保留消息和附件，会话仍可在后续 Turn 使用修正后的模型配置继续。

## 6. 会话附件存储与数据模型

### 6.1 权威存储

- 附件唯一权威副本位于 `BAIGONG_DATA_DIR/attachments`。
- 不使用外部对象存储，不为同一附件维护外部副本或本地缓存副本。
- 附件目录与 PostgreSQL 必须整体备份和迁移；只恢复数据库或只恢复附件目录都不构成完整灾难恢复。
- 文件内容不做应用层 AES 加密。生产部署依赖数据目录 `0700`、应用用户独占和部署磁盘加密。
- 文件不进入 `public/`，存储文件名使用随机内部 ID，不包含用户文件名、用户 ID、会话 ID或可猜测序号。
- 浏览器和模型永远不接收本地绝对路径或存储键。

### 6.2 `conversation_attachments`

新增附件表，至少保存：

| 字段 | 说明 |
| --- | --- |
| `id` | 应用生成的不可预测附件 ID |
| `tenant_id` | 权威租户 |
| `owner_user_id` | 权威所有者 |
| `owner_source` | `LOCAL` 或 `EMBEDDED`，永久隔离身份来源 |
| `request_id` | 客户端上传幂等键 |
| `storage_key` | 数据目录内部随机存储键，只在服务端使用 |
| `display_name` | 用户原始显示文件名的安全版本 |
| `extension` | 规范化允许扩展名 |
| `declared_media_type` | 浏览器声明且经允许列表校验的类型 |
| `size_bytes` | 实际接收字节数 |
| `status` | `PENDING` 或 `BOUND` |
| `conversation_id` | 绑定后的会话，未绑定时为空 |
| `message_id` | 绑定后的用户消息，未绑定时为空 |
| `created_at` | 创建时间 |
| `bound_at` | 绑定时间 |

数据库约束保证：

- `(tenant_id, owner_user_id, owner_source, request_id)` 唯一，相同上传重试复用原记录。
- `BOUND` 必须同时具备 `conversation_id`、`message_id` 和 `bound_at`；`PENDING` 不具备这些字段。
- 绑定后的所有者、身份来源、会话和消息不可修改。
- 会话和消息必须与附件属于同一租户、所有者和身份来源。
- 本地用户与嵌入用户即使显示资料相同，也不能共享或相互绑定附件。

### 6.3 格式与额度

首版允许列表：

| 扩展名 | 声明类型 |
| --- | --- |
| `.png` | `image/png` |
| `.jpg`、`.jpeg` | `image/jpeg` |
| `.webp` | `image/webp` |
| `.pdf` | `application/pdf` |

固定限制：

- 单文件最多 20 MiB。
- 每条消息最多 5 个附件。
- 每条消息附件合计最多 50 MiB。
- 每个用户全部会话附件合计最多 1 GiB，归档会话附件仍计入。
- 未绑定 `PENDING` 和已绑定 `BOUND` 附件都计入用户额度，删除或清理成功后才释放额度。

额度判断和消息绑定必须使用数据库事务及必要的行级锁，避免并发上传或并发发送绕过上限。

### 6.4 校验与响应安全

- 只校验允许扩展名、浏览器声明类型、实际接收大小和组合额度。
- 不计算内容哈希，不执行恶意文件扫描，不做复杂 MIME 探测或文件签名识别。
- 显示文件名必须去除路径含义和控制字符，并设长度上限；显示名不能参与存储定位。
- 下载和预览必须先验证当前服务端身份、租户和附件归属。
- 图片和 PDF 可使用鉴权的内联预览；响应设置准确的允许类型、`Content-Disposition` 和 `X-Content-Type-Options: nosniff`。
- 管理员可在会话审计页面读取或下载本租户附件，但不能替换、重命名或删除附件。

## 7. 上传、绑定、幂等与清理

### 7.1 独立上传

新增 `POST /api/attachments`：

1. 验证本地数据库会话或嵌入 Bearer 会话，取得权威租户、用户和身份来源。
2. 验证 `requestId`、文件名、扩展名、声明类型和大小。
3. 检查当前用户总额度。
4. 以随机存储键写入数据目录临时文件，并在完整写入后原子移动到附件目录。
5. 创建或复用同一 `requestId` 的 `PENDING` 记录。
6. 返回安全附件元数据，不返回本地路径或存储键。

重复 `requestId`：

- 请求属于同一身份且文件元数据一致时返回原附件。
- 同一 `requestId` 的文件元数据不一致时返回冲突，不覆盖已有内容。
- 已绑定附件仍可作为同一上传请求的幂等结果返回，但不能绑定到另一条消息。

上传过程中出现数据库或文件写入失败时，删除本次无权威记录的临时文件；后台清理也负责移除无法关联数据库记录的残留临时文件。清理逻辑必须限制在经过验证的附件目录内，不接受请求参数作为清理路径。

### 7.2 消息绑定

创建或继续消息时请求体携带 `attachmentIds`。服务端在预留 Turn 和保存用户消息的同一事务中：

1. 按 ID 锁定全部附件记录。
2. 验证附件均为当前租户、用户、身份来源的 `PENDING` 记录。
3. 验证数量、合计大小和 Turn 锁定模型版本的图片/PDF能力。
4. 将附件绑定到权威会话和本次用户消息。
5. 保存安全附件投影，并使所有者、会话和消息关联不可变。

相同消息 `requestId` 重试必须复用既有 Turn、用户消息和附件绑定，不创建重复消息或重复附件。模型调用失败、用户取消或提供商错误都不回滚已接受的用户消息和附件。

### 7.3 生命周期

- 用户可删除自己的未绑定 `PENDING` 附件。
- 未绑定 `PENDING` 附件创建 24 小时后由定期清理任务删除文件和记录。
- 已绑定 `BOUND` 附件不自动过期，归档会话不删除附件，首版不支持独立删除。
- 后续只能通过明确的系统级保留策略批量清理已绑定附件，并为清理操作本身留下审计记录。
- 删除先以数据库状态保证附件不再可见，再清理文件；文件删除失败必须可重试，不能重新暴露附件。

## 8. 聊天交互与模型输入

### 8.1 用户交互

- 支持“文字 + 附件”和“仅附件”。
- 文件选择后立即独立上传，按文件显示进度；全部所选文件上传完成后才允许发送。
- 失败文件可以单独重试或移除，不要求重新上传成功文件。
- 图片显示缩略图；PDF 显示文件卡片并提供鉴权预览和下载。
- 仅附件的新会话标题取第一个文件名；多个附件显示“首文件名等 N 个附件”。
- 当前模型不支持所选类型时，在选择阶段明确提示且不上传；服务端仍执行同样校验。

### 8.2 发送给 eve

服务端只从已绑定且已授权的附件记录解析内容：

- 文本消息转换为 `text` part；仅附件消息不注入伪造的用户文本。
- 服务端读取附件字节并构造 AI SDK 文件 part，使用已验证的媒体类型和安全显示名。
- 图片和 PDF 只在 Turn 锁定的模型版本声明支持时加入模型请求。
- 当前用户消息已经携带的图片或 PDF 由模型直接分析，不先调用附件列表或读取 Tool。
- 历史附件回读以及 Subagent 按需读取父主会话附件时，才使用附件列表和读取 Tool。
- 不把附件鉴权 URL交给外部模型抓取，不把磁盘路径写入 Prompt。
- 不在消息提交期间执行文档解析、OCR 或 Markdown 转换。

### 8.3 安全历史投影

PostgreSQL 和普通用户历史只保存、返回以下附件信息：

- 附件 ID。
- 安全显示名。
- 字节大小。
- 允许列表中的媒体类型。
- 由应用生成的鉴权预览或下载地址。

不保存或返回内联 `data:` URL、原始字节、本地路径、存储键、模型提供商请求体或附件正文。P4 的 `message.received` 处理必须由应用附件绑定记录生成权威投影，不能直接把 eve 事件中的文件 URL 透传给普通用户。

## 9. Tool 注册、开关与运行语义

### 9.1 固定 Tool 与可管理 Tool

以下 eve 原生 Tool固定启用，不显示管理员开关：

| Tool ID | 实现与边界 |
| --- | --- |
| `agent` | 仅根 Agent可用的 eve原生单层 Subagent；子 Agent原生移除 |
| `ask_question` | eve原生用户提问；子 Agent请求代理回根会话 |

“Agent 能力”页面只管理以下普通动态 Tool：

| Tool ID | 默认 | 实现与边界 |
| --- | --- | --- |
| `todo` | 开启 | 动态包装 eve原生每会话持久状态 |
| `web_fetch` | 关闭 | 动态包装 eve原生公开 HTTPS抓取、SSRF防护、超时和大小限制 |
| `list_conversation_attachments` | 开启 | 列出当前根会话可读附件的安全元数据 |
| `read_conversation_attachment` | 开启 | 读取当前根会话内一个已授权附件供模型使用 |

开关控制服务端动态解析器是否实际返回 Tool定义，不是仅隐藏前端控件。数据库出现未知 Tool ID时失败关闭；不能为了兼容旧记录而暴露未识别 Tool。

动态 `load_skill` 不提供独立开关：当前 Turn存在至少一个启用 Skill版本时自动暴露，没有启用 Skill时不暴露。

### 9.2 会话附件 Tool

- `list_conversation_attachments` 仅列出当前根会话全部已绑定附件的安全元数据。
- `read_conversation_attachment` 只能读取列表中的附件；不接受路径、用户 ID、租户 ID或任意会话 ID。
- 服务端从 `ctx.session` 和已验证的父子会话关系解析根会话，再执行数据库所有权校验。
- 主 Agent 和其子 Agent具有相同的根会话附件读取范围；均不能读取用户其他会话或其他用户附件。
- Tool 输出不得包含本地路径。图片/PDF是否作为模型内容返回仍受 Turn 锁定模型能力限制。
- 当前消息已经携带的附件不重复调用本节 Tool；Tool 只用于历史附件回读或 Subagent 获取未随委派消息携带的父主会话附件。
- 不自动把全部附件正文复制进每条 Subagent 委派消息；子 Agent 按需调用附件 Tool。

### 9.3 Web Tool

- `web_fetch` 保持 eve 原生行为，只允许其既有公开 HTTPS 策略，不新增 HTTP 放宽、私网白名单或自定义代理。
- eve 原生 `web_search` 固定禁用，不显示管理员开关，也不因当前模型提供商支持而自动开启。
- 未来搜索能力使用本项目自己的普通动态 Tool；搜索后端、凭据、限额和安全策略在对应阶段单独确定。
- P5 不为 Web Tool 增加逐次审批。管理员启用即代表该 Agent 允许调用。

### 9.4 失败、取消与审计

- Tool 生命周期沿用 eve `actions.requested` 和 `action.result`。
- Tool 失败后应用层不自动重试；模型可以依据错误自行调整参数、再次调用或向用户解释。
- API Key 错误、模型不存在、请求参数错误等模型错误沿用现有统一回复重试和失败语义，不在 P5 建立特殊 Tool 分支。
- 用户取消 Turn 时，支持取消的 Tool 必须传递并响应 `ctx.abortSignal`。
- 普通用户只看到允许列表中的聊天、附件和通用状态，不看到 Tool 名称、参数、结果或内部错误。
- 管理员通过 P4 运行动作索引和 eve 原始流查看完整详情。
- PostgreSQL 不保存完整网页正文、附件正文或 Tool 结果。

## 10. 数据库 Markdown Skills

### 10.1 权威来源与支持范围

- PostgreSQL 是 Skill定义、Markdown内容和版本的唯一权威来源；P5 不使用 `agent/skills/` 或 eve原生动态 Skill。
- Skill只包含名称、描述和 Markdown指令，不支持 TypeScript、脚本、附件、支持文件或其他可执行内容，也不需要 Sandbox。
- 管理员可以在“Agent 能力”页面创建 Skill、基于现有 Skill创建新版本、启用或关闭 Skill，无需重新构建或重启项目。
- 已被 Agent能力版本引用的 Skill版本不可修改或删除；编辑永远创建新版本，历史 Turn继续引用原版本。
- P5 不提供 Skill定义或历史版本删除入口；不再使用的 Skill通过关闭启用状态并保存新能力版本停用，权威定义和版本记录继续保留。
- Skill只增加模型按需加载的指令，不扩大 Tool、身份、附件或外部知识源权限。
- 未来 Agent自行创建 Skill时复用相同数据模型；是否允许直接启用、是否需要管理员审核及可见范围由后续阶段决定，P5 不提供 `create_skill` Tool。

### 10.2 数据模型

新增数据库实体：

| 实体 | 关键内容 |
| --- | --- |
| `skills` | 租户、稳定 Skill ID、名称、当前版本 ID、创建来源、创建者和时间 |
| `skill_versions` | 租户、Skill、递增版本、描述、Markdown正文、创建来源、创建者和时间 |

- 同一租户内 Skill名称唯一，名称变更作为定义元数据变更处理并记录审计。
- `created_source` 至少能区分系统内置、管理员和未来 Agent创建来源；P5 只产生系统内置和管理员来源。
- Skill停用通过新的 Agent能力版本移除其 Skill版本 ID，不删除定义或历史版本；已经锁定的运行中 Turn不受影响。
- Skill版本正文不复制到 Agent能力版本；能力版本只保存精确的 Skill版本 ID集合。

### 10.3 动态 `load_skill`

- 动态解析器在 `turn.started` 根据受信 `agentConfigVersionId` 读取已锁定的 Skill版本集合。
- 至少存在一个启用 Skill时，向模型暴露本项目实现的 `load_skill` Tool，并在 Tool说明和输入 Schema中列出可用名称与描述；没有 Skill时不暴露。
- 模型调用后，服务端再次验证租户、Agent能力版本和 Skill版本 ID，只返回对应 Markdown正文。
- `load_skill` 不接受任意数据库 ID、租户 ID、用户 ID、文件路径或未在锁定集合中的 Skill名称。
- Skill配置在一个 Turn内保持不变；管理员创建、编辑或启停后，从同一会话的下一 Turn生效。
- 返回内容沿用普通 Tool动作事件和审计链路；普通用户看不到 Skill正文和加载详情，管理员可通过 eve原始流查看。

### 10.4 首版 `evidence_research`

P5 迁移创建系统内置 `evidence_research` 的首个数据库版本，并在 P5 默认 Agent能力版本中启用。管理员可以关闭或创建新版本，其指令至少要求 Agent：

- 识别回答是否需要证据，以及当前问题需要何种证据。
- 优先使用当前会话附件、已启用网页 Tool 或未来外部知识 Tool。
- 区分 Tool 结果、用户提供材料和模型自身知识。
- 对无法验证、证据冲突或材料不足的部分明确说明不确定性。
- 保留对来源的可理解引用，不伪造未读取的来源。
- 不因 Skill 指令扩大身份、Tool、附件或知识源访问权限。

## 11. Subagent

### 11.1 采用语义

- 启用 eve 原生根级 `agent` Tool。
- 使用主 Agent 副本，不定义固定专家 Subagent。
- 子 Agent 继承主 Agent 当前 Turn 锁定的指令、身份、Tools 和 Skills，使用独立会话历史与状态。
- eve 原生不向子 Agent 暴露 `agent` 或 `Workflow`，因此保持单层。
- 用户跨主会话最多同时运行 3 个主 Agent Turn；每个主 Agent Turn 最多保留 6 个活动 Subagent。两者分别计数，主 Agent 自身不计入 6 个 Subagent。
- Subagent 完成、失败或取消后立即释放其活动额度，不依赖 Token、动作索引或 UI 等派生审计投影成功。
- 超出 6 个活动 Subagent 的委派不建立可运行的子会话映射；Agent 指令同时约束单个活动委派批次不超过 6 个。
- 子 Agent 完成原始委派后发送完成事件并进入只读状态，用户不能把它当普通聊天会话继续发送消息。

### 11.2 交互与权限

- Subagent 对话继续使用 P4 已完成的父子会话、普通用户安全投影和管理员原始流。
- 普通用户可从父会话时间线进入自己派生的子会话并查看安全对话；不能查看 Tool、推理、内部句柄或原始事件。
- 子 Agent 的 `ask_question` 或授权请求由 eve 代理回根会话，主 Agent 页面负责向用户展示和收集回答。
- 用户不能直接向执行中或已完成的子会话插话。
- 子 Agent 可以读取父主会话的全部附件，但不能访问同一用户其他会话附件。
- 服务端根据 P4 已验证父子关系解析根会话；模型参数中的父会话 ID、用户 ID 或租户 ID一律不作为授权依据。
- 取消父 Turn 时复用 eve 原生取消传播及 P4 状态投影，不建立第二套取消协议。

### 11.3 审计

- `subagent.called`、子 `session.started.invocation` 和完成事件继续由 P4 双向验证并建立关联。
- Tool/Skill动作、Token 和子会话用量继续使用 P4 索引与汇总口径。
- 管理员从会话审计页面进入子会话并读取 eve 原始流。
- 普通用户只接收服务端允许列表投影；子 Agent 不因继承主 Agent 能力而获得更宽的用户可见事件。

## 12. 主 Agent 与能力版本

### 12.1 固定主 Agent

- 每个租户建立一个固定主 Agent 实例，使用稳定内部 ID。
- 主 Agent 不可删除。
- P5 只管理主 Agent 的 Tool 与 Skill 能力；P7 在同一数据模型上扩展显示名、提示词、模型分配、启用状态和其他 Agent 实例。

### 12.2 数据模型

新增 Agent 实例、不可变能力版本和当前指针，至少表达：

| 实体 | 关键内容 |
| --- | --- |
| `agents` | 租户、稳定实例 ID、主 Agent 标识、当前能力版本 ID |
| `agent_config_versions` | 租户、Agent、递增版本、启用动态 Tool ID、启用 Skill版本 ID、创建管理员、创建时间 |
| `conversation_turns.agent_config_version_id` | 当前 Turn 锁定的 Agent 能力版本 |

- 动态 Tool ID与 Skill版本 ID使用规范化、排序后的集合保存，便于稳定比较和审计。固定启用的 `agent`、`ask_question` 和按需出现的 `load_skill` 不写入 Tool开关集合。
- 保存时先与当前版本比较；没有实际变化时返回当前版本，不创建空版本。
- 新版本写入与主 Agent 当前指针切换在同一事务完成。
- 旧版本不可修改或删除，历史 Turn 始终可解释。
- 能力版本与 `model_config_version_id` 分开保存；修改模型不隐式改变 Tool/Skill，修改 Tool/Skill也不创建模型版本。
- 创建或继续 Turn 时同时锁定两个版本。运行中 Turn 使用启动时集合，下一 Turn 才读取新指针。
- 解析器只接受当前代码注册表中的动态 Tool ID和本租户有效 Skill版本 ID；未知或越权引用失败关闭并记录错误。

## 13. 管理页面与 API

### 13.1 导航与页面

新增与“模型管理”“用户管理”“嵌入接入”“会话审计”并列的“Agent 能力”页面。页面显示：

- 固定主 Agent 标识和当前能力版本。
- 固定开启的 `agent`、`ask_question` 及其运行边界，不提供开关。
- 所有可管理动态 Tool的名称、用途、默认值和当前状态。
- 所有数据库 Skill的名称、说明、当前版本、启用状态、来源和更新时间，并提供创建、编辑、启停入口。
- eve 原生 `web_search` 固定禁用，并说明未来由本项目实现独立搜索 Tool。
- 当前持续禁用的终端、Sandbox 和通用文件 Tool，只作为明确边界说明，不提供开关。
- 最近更新时间和管理员。

能力保存只提交完整的动态 Tool ID与 Skill版本 ID集合。服务端根据代码注册表、租户和数据库版本重新校验，不能接受未知 ID、跨租户 Skill、旧版正文替换或被固定禁用的 Tool。

### 13.2 API

| 路由 | 作用 |
| --- | --- |
| `GET /api/admin/agent-capabilities` | 读取主 Agent、注册表、当前能力版本和提供商可用状态 |
| `PUT /api/admin/agent-capabilities` | 创建或复用能力版本并切换当前指针 |
| `GET /api/admin/skills` | 读取本租户 Skill定义、版本摘要和当前启用状态 |
| `POST /api/admin/skills` | 创建纯 Markdown Skill及首个不可变版本 |
| `PUT /api/admin/skills/:id` | 为既有 Skill创建新的不可变 Markdown版本 |
| `POST /api/admin/model-config/test-tool-calling` | 使用未保存表单配置测试完整 Tool Calling 往返 |
| `POST /api/attachments` | 上传或幂等复用一个 `PENDING` 附件 |
| `DELETE /api/attachments/:id` | 删除当前用户尚未绑定的 `PENDING` 附件 |
| `GET /api/attachments/:id` | 鉴权预览或下载附件 |

现有会话创建和继续接口扩展 `attachmentIds`，历史快照扩展安全附件投影。所有写接口继续使用 P2 的本地同源/CSRF规则或嵌入 Bearer 身份规则。

## 14. P6 外部知识源边界

P6 调整为“外部知识源接入”：

- 外部数据库、向量库、文件系统、对象存储、搜索服务或 API 是知识内容、索引和原始知识文件的权威来源。
- 本项目通过统一只读 Tools/Knowledge Gateway 检索和读取，不直接托管外部知识文件。
- 外部知识凭据由管理员在服务端配置和使用，不进入浏览器、Prompt、会话附件或子 Agent 委派文本。
- P6 不建设本地上传、解析、分块、Embedding、索引或同步副本。
- 未来文档转 Markdown 是一个明确暴露、可审计的独立 Tool；具体转换技术、支持格式和资源限制由后续方案决定。
- 用户会话附件仍由本项目本地持久化，不转存到外部知识源，也不自动进入知识库。

## 15. 模块规划

实施时保持现有 Controller、Service、Repository、Domain 和 Eve Adapter 边界，建议按职责拆分：

```text
agent/
  tools/
    todo.ts
    web_fetch.ts
    web_search.ts
    load_skill.ts
    list_conversation_attachments.ts
    read_conversation_attachment.ts
    bash.ts                         持续 disableTool()
    read_file.ts                    持续 disableTool()
    write_file.ts                   持续 disableTool()
    glob.ts                         持续 disableTool()
    grep.ts                         持续 disableTool()

app/
  admin/agent-capabilities/         管理页面
  api/admin/agent-capabilities/     管理 API
  api/admin/model-config/           扩展 Tool Calling 测试
  api/attachments/                  上传、删除、预览和下载 API
  components/chat/                  附件选择、进度、消息卡片和安全历史

src/server/
  agents/                           注册表、能力版本、解析与管理服务
  attachments/                      策略、存储、仓储、绑定、访问与清理
  conversations/                    Turn版本锁定、附件消息投影和 P4 审计复用
  eve/                              UserContent组装、动态 Tool/Skill解析和 Subagent上下文
  models/                           模型能力声明和 Tool Calling测试
  skills/                           Skill定义、不可变版本、管理与锁定版本读取
  db/schema/                        Agent能力版本、Skill版本和附件 Schema
```

`agent` 与 `ask_question` 直接使用 eve 原生固定能力，不建立同名动态 Tool文件，也不保留用于禁用它们的 `disableTool()` 哨兵。`web_search.ts` 继续导出 `disableTool()`；其余列出的业务 Tool由应用按 Turn动态解析。`load_skill.ts` 只负责受控 Tool接口，数据库读取、租户校验和版本校验由 `src/server/skills/` 承担。

具体文件可依据现有模块规模进一步拆分，但不得把附件磁盘 I/O、数据库授权、HTTP 响应和 Eve 内容组装堆叠到单个大文件，也不得复制 P4 已有会话权限、动作审计或父子关系逻辑。

## 16. 环境与迁移

### 16.1 必要环境

- 用户已配置独立 `P5_TEST_DATABASE_URL`。
- 应用数据库和 P5 测试数据库均为 PostgreSQL。
- `BAIGONG_DATA_DIR` 遵循 P0 已确认的数据目录规则；测试使用单独临时数据目录。
- 默认模型及管理员配置的 Base URL/API Key 用于最终 Tool Calling 人工验收。

P5 不需要 Docker、对象存储、OCR、文档转换服务、搜索供应商密钥、Redis、消息队列或额外 Sandbox 运行时。

### 16.2 数据库迁移

使用一个版本化 P5 迁移完成：

- 模型配置版本图片/PDF能力字段。
- 附件表、唯一约束、状态约束、归属索引和清理索引。
- Skill定义、不可变 Skill版本及其租户、来源和版本约束。
- Agent 实例、能力版本、精确 Skill版本引用和当前指针。
- Turn 的 Agent 能力版本外键。
- 为每个现有租户创建系统内置 `evidence_research` 首版。
- 为现有租户回填固定主 Agent、P5 前空动态能力基线版本和 P5 默认能力版本，并把当前指针指向 P5 默认版本。
- 为现有模型版本把图片/PDF能力回填为 `false`。

迁移必须能从已完成 P4 的数据库前向应用，不能要求清空既有会话。每个租户的 P5 前基线版本使用空动态 Tool与空 Skill版本集合，现有历史 Turn统一回填该版本。P5 默认版本的动态 Tool集合包含 `todo`、`list_conversation_attachments` 和 `read_conversation_attachment`，Skill集合包含该租户 `evidence_research` 首版；固定开启的 `agent`、`ask_question` 和固定禁用的 eve原生 `web_search` 均不写入能力版本集合，也不回写历史 Turn。

## 17. 测试与验收

### 17.1 测试隔离

- 未配置 `P5_TEST_DATABASE_URL` 时，P5 数据库和 HTTP 测试立即拒绝运行。
- 测试 URL 与应用 `DATABASE_URL` 相同或数据库名称不以 `_p5_test` 结尾时立即拒绝运行。
- 每次运行生成随机租户、用户、会话、附件、Agent、版本和请求标识。
- 文件测试使用本次运行创建的临时 `BAIGONG_DATA_DIR`，成功或失败后都清理随机数据库记录和临时目录。
- 自动化不访问真实模型凭据、真实外部网页或真实搜索提供商。

### 17.2 自动化覆盖

- P4 数据库前向迁移、默认主 Agent 和默认能力版本回填。
- 模型图片/PDF能力声明、历史版本不变和 Turn 锁定。
- 未配置独立 P5 测试库时失败关闭。
- 附件扩展名、声明类型、单文件、单消息和用户总额度。
- 本地用户、嵌入用户、管理员、跨用户、跨来源和跨租户附件权限。
- 上传 `requestId` 幂等、冲突、并发额度和失败残留清理。
- `PENDING` 删除、24 小时清理、绑定不可变和归档保留。
- 创建/继续消息附件绑定、仅附件消息、失败/取消后保留和历史投影。
- 预览/下载授权、响应头和路径不泄露。
- 动态 Tool默认集合、开关、未知 ID失败关闭、无变化不建版本和下一 Turn生效。
- Skill创建、编辑生成新版本、启停、来源记录、租户隔离和历史版本不可变。
- `load_skill` 只公布并读取当前 Turn锁定的 Skill版本；没有启用 Skill时不暴露该 Tool。
- Skill配置修改从下一 Turn生效，运行中 Turn和历史 Turn继续使用各自锁定的旧版本。
- eve原生 `agent` 与 `ask_question` 始终存在且没有管理员开关；eve原生 `web_search` 始终不可用。
- `bash`、`read_file`、`write_file`、`glob`、`grep` 与 `Workflow` 在实际 Agent 清单中持续不可用。
- 实际 Agent 清单以 `eve:disabled-sandbox` 明确标记根 Agent 已禁用 Sandbox，而不是把“未声明 Sandbox”误认为禁用。
- `todo` 状态、`ask_question` 路由、Tool失败、取消和 P4动作审计。
- 根级 Subagent继承锁定能力、单层限制、父子映射、取消传播和只读完成态。
- 主 Agent与子 Agent可读父主会话附件，但不能读取其他会话附件。
- 普通用户安全投影不包含 Tool详情、附件正文、磁盘路径、eve句柄或原始事件。
- Tool Calling测试使用临时无副作用 Tool，不修改模型或 Agent配置。

### 17.3 自动化门禁

P5 完成前至少运行：

- 数据库迁移检查。
- `npm run typecheck`。
- `npm test`。
- 独立 P5 数据库测试。
- P5 HTTP 验收。
- `npm run build`。

具体 npm script 名称在实现时沿用 P2-P4 的命名规范，并写回本文件的实施状态。

### 17.4 人工验收

必须完成：

- 默认模型“测试工具调用”成功，页面显示最终回复、耗时和 Token。
- 动态 Tool与 Skill开关从下一 Turn生效，运行中 Turn不变化。
- 管理员无需重新构建或重启即可创建 Skill、编辑出新版本并启停；Agent只能通过 `load_skill` 看到和读取当前 Turn锁定版本。
- `todo`、`ask_question`、Subagent、父主会话附件读取和管理员审计。
- 开启 `web_fetch` 后成功读取一个公开 HTTPS 页面，并确认普通用户看不到 Tool详情。
- 上传、进度、失败单独重试、仅附件发送、历史恢复、图片预览、PDF预览/下载和归档保留。

允许延期或记为不适用：

- 没有兼容真实模型时，图片和原生 PDF 的真实模型输入验收可以延期，但其自动化权限、投影和能力失败关闭测试必须通过。
- 嵌入页面完整浏览器验收继续延期至 P9，但嵌入身份的附件自动化隔离必须通过。

默认模型 Tool Calling测试不可延期，因为 P5 后续能力以 `tool_calls` 为基础。

### 17.5 当前自动化实施结果

截至 2026-08-08，项目已接入固定发布包 `eve@0.27.12-baigong.4`，根 Agent 通过 `disableSandbox()` 显式禁用 Sandbox。P5 HTTP 验收确认当前图片只经过一次必要的流式模型请求并以真实 `image_url` 到达提供商；Turn 级动态附件 Tool 按“列表、读取、回答”形成三个必要的流式 Step，读取结果以真实多模态 part 到达提供商。两种路径均未触发首次回复前压缩，未产生 synthetic `message.received`，Tool role 未携带完整 Base64。验收过程中没有安装、预热或启动 Microsandbox、`just-bash` 或其他 Sandbox 后端；测试只保存请求形状的布尔观察和计数，不持久化请求正文或附件内容。

以下门禁已通过：

- `npm run typecheck`
- `npm run test:p5:agent`
- `npm run test:p5:database`：2 个测试文件、8 项测试通过
- `npm run test:p5:http`：当前图片单次流式多模态请求、附件 Tool 多模态回读、无 synthetic 用户事件、无首次回复前压缩、附件上传、仅附件消息、安全历史投影、鉴权预览和绑定后不可变均通过
- `npm test`：34 个测试文件、192 项测试通过
- `npm run db:check`
- `npm run build`
- `git diff --check`

`package.json` 与 `package-lock.json` 均只引用 GitHub Release 中的 `eve-0.27.12-baigong.4.tgz`，不依赖本地 eve 工作区；安装包 SHA-256 为 `598bc5fae0fdb7afbfb2505489e16ca416e305078e109edd0c950ef9916a65ae`。

### 17.6 人工验收结果

2026-08-08，用户确认第 17.4 节全部必须项验收通过：

- 默认模型完整 Tool Calling 测试成功，页面能够显示最终回复、耗时和 Token。
- 动态 Tool 与 Skill 变更从下一 Turn 生效，运行中 Turn 保持锁定版本；管理员能够创建 Skill、编辑生成不可变新版本、启停，并由 Agent 通过 `load_skill` 读取当前 Turn 版本。
- `todo`、`ask_question`、`web_fetch`、Subagent 和管理员审计均可正常使用，普通用户看不到 Tool 参数、结果或内部执行详情。
- 附件上传、进度、失败文件单独重试、仅附件发送、历史恢复、图片预览、PDF 预览与下载、归档保留均符合设计。
- 主 Agent 能够直接识别图片；升级至 `eve@0.27.12-baigong.4` 后，Subagent 能够按权限读取父主会话图片并正确分析，不再把完整 Base64 作为普通 Tool 文本发送给模型。
- Subagent 完成后活动额度正确释放，用户能够继续与主 Agent 交互；父子会话入口、只读完成态和管理员执行详情正常。

嵌入页面完整浏览器验收仍按既定边界延期至 P9，不属于 P5 阻塞项。P5 的代码实施、自动化门禁和必须项人工验收均已完成，可以进入 P6。

## 18. 实施顺序

1. 扩展模型配置版本能力字段和可选 Tool Calling测试，完成对应迁移、服务和管理页面。
2. 建立 Skill Schema、不可变版本、动态 `load_skill`、管理 API和管理页面，并迁移系统内置 `evidence_research` 首版。
3. 建立附件策略、Schema、本地存储、上传幂等、额度、清理和鉴权读取。
4. 扩展聊天请求、Turn预留、用户消息和历史投影，完成图片/PDF UserContent组装与前端附件交互。
5. 建立动态 Tool注册表、固定主 Agent、不可变能力版本和下一 Turn锁定。
6. 固定启用 eve原生 `agent` 与 `ask_question`，固定禁用 eve原生 `web_search`；接入 `todo`、`web_fetch`、`load_skill` 和两个会话附件动态 Tool，并持续验证受限 Tool不可用。
7. 复用 P4父子关系、只读子会话、审计、取消和附件授权，完成根级单层 Subagent集成。
8. 完成 P5独立数据库测试、HTTP验收、全量单元测试、类型检查和构建。
9. 由用户完成真实模型与浏览器人工验收，将结果和延期项写回本文件。

每一部分实施完成后执行针对性检查；用户明确要求完整 Review 时，再按项目 Review 规则进行阶段复审。

## 19. 完成标准

- P5 迁移可从当前 P4 数据库前向应用，现有用户和会话不丢失。
- 会话附件只有一个本地权威副本，权限、额度、幂等、清理、预览和历史恢复符合本文。
- 模型只在明确声明支持时接收图片或 PDF；不支持时前后端均失败关闭。
- 默认模型通过真实完整 Tool Calling往返测试。
- 管理员动态 Tool与 Skill配置控制实际服务端能力集合，并由不可变版本按 Turn锁定。
- PostgreSQL是纯 Markdown Skill的唯一权威来源；管理员创建、编辑和启停无需重新构建或重启，编辑产生不可变新版本。
- `load_skill` 只公布并读取当前 Turn锁定的 Skill版本，没有启用 Skill时不暴露。
- `bash`、`read_file`、`write_file`、`glob`、`grep`、Sandbox和 `Workflow` 均未启用。
- eve原生 `agent` 与 `ask_question` 固定开启；eve原生 `web_search` 固定禁用；`todo`、`web_fetch`、附件 Tool和 `evidence_research` 遵守本文默认值与权限。
- 根级 Subagent保持单层，复用 P4安全投影、审计和只读完成语义，并只能访问父主会话附件。
- PostgreSQL不保存附件正文、完整网页、完整 Tool结果或 eve原始事件。
- 所有自动化门禁通过，必须项人工验收通过，允许延期项有明确记录。
- 实施状态、实际命令结果和人工验收结果已写回本文件后，P5 才可标记为完成并进入 P6。
