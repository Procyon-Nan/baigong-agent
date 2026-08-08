import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ApplicationFrame } from "@/app/components/application-frame";
import { MarkdownContent } from "@/app/components/chat/markdown-content";
import {
  isAdminPrincipal,
  resolvePrincipal,
} from "@/src/server/authorization";
import {
  getAdminConversationAuditDetails,
  getAdminConversationExecutionIndex,
} from "@/src/server/conversations/service";
import { parseConversationId } from "@/src/server/http/p3-conversation-schemas";
import {
  parseAdminConversationDetailQuery,
  parseAdminConversationExecutionQuery,
} from "@/src/server/http/p4-admin-conversation-schemas";
import { AuditControls } from "./audit-controls";
import adminStyles from "../../admin.module.css";
import styles from "../conversations.module.css";

export const dynamic = "force-dynamic";

type PageProps = {
  readonly params: Promise<{ conversationId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

export default async function AdminConversationDetailPage({
  params,
  searchParams,
}: PageProps) {
  const principal = await resolvePrincipal(new Headers(await headers()));
  if (!principal) redirect("/login");
  if (principal.mustChangePassword) redirect("/change-password");
  if (!isAdminPrincipal(principal)) redirect("/settings");

  const conversationId = parseConversationId((await params).conversationId);
  const rawSearchParams = toSearchParams(await searchParams);
  const detailQuery = parseAdminConversationDetailQuery(
    onlyQuery(rawSearchParams, "historyCursor", "cursor"),
  );
  const executionQuery = parseAdminConversationExecutionQuery(
    onlyQuery(rawSearchParams, "actionCursor", "cursor"),
  );
  const [details, execution] = await Promise.all([
    getAdminConversationAuditDetails(principal, conversationId, detailQuery),
    getAdminConversationExecutionIndex(principal, conversationId, executionQuery),
  ]);

  return (
    <ApplicationFrame
      contentWidth="wide"
      navigationMode="admin"
      user={{ displayName: principal.displayName, role: principal.role }}
    >
      <div className={styles.detailLayout}>
        <main className={styles.detailMain}>
          <header className={styles.detailHeader}>
            <div>
              <p className={adminStyles.eyebrow}>只读会话审计</p>
              <h1>{details.conversation.title}</h1>
              <p>{details.conversation.id}</p>
            </div>
            <AuditControls
              activeTurnId={details.conversation.activeTurn?.id ?? null}
              archived={details.conversation.archivedAt !== null}
              conversationId={details.conversation.id}
              isMain={details.conversation.kind === "MAIN"}
            />
          </header>

          <section className={styles.section}>
            <h2>会话信息</h2>
            <dl className={styles.metaGrid}>
              <Meta label="所有者" value={details.owner.displayName} />
              <Meta label="身份" value={`${details.owner.identifier} · ${details.owner.source}`} />
              <Meta label="类型" value={details.conversation.kind === "MAIN" ? "主会话" : "Subagent 会话"} />
              <Meta label="状态" value={statusLabel(details.conversation.status)} />
              <Meta label="最后活动" value={formatDate(details.conversation.updatedAt)} />
              <Meta label="eve 游标" value={details.lastEveCursor?.toString() ?? "-"} />
              <Meta label="归档" value={details.conversation.archivedAt ? formatDate(details.conversation.archivedAt) : "未归档"} />
              <Meta label="创建时间" value={formatDate(details.conversation.createdAt)} />
              <Meta label="链接状态" value={details.conversation.linkStatus} />
            </dl>
            {details.conversation.parentConversationId ? (
              <p>
                <Link
                  className={styles.secondaryButton}
                  href={`/admin/conversations/${details.conversation.parentConversationId}`}
                >
                  查看父会话
                </Link>
              </p>
            ) : null}
          </section>

          <section className={styles.section}>
            <h2>安全消息历史</h2>
            {details.messages.items.length === 0 ? (
              <p className={styles.empty}>暂无已持久化消息。</p>
            ) : (
              <ol className={styles.messageList}>
                {details.messages.items.map((message) => (
                  <li className={styles.message} key={message.id}>
                    <div className={styles.messageHeader}>
                      <strong>{roleLabel(message.role)}</strong>
                      <span>
                        #{message.sequence} · {message.status} · {formatDate(message.createdAt)}
                      </span>
                    </div>
                    <div className={styles.messageBody}>
                      <MarkdownContent markdown={message.body} />
                      {message.attachments.length > 0 ? (
                        <div className={styles.messageAttachments}>
                          {message.attachments.map((attachment) => (
                            <article
                              className={styles.messageAttachment}
                              key={attachment.id}
                            >
                              <div>
                                <strong>{attachment.displayName}</strong>
                                <small>
                                  {attachment.mediaType} · {formatFileSize(attachment.sizeBytes)}
                                </small>
                              </div>
                              <span>
                                <a
                                  href={attachment.previewUrl}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  预览
                                </a>
                                <a href={attachment.downloadUrl}>下载</a>
                              </span>
                            </article>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {details.messages.nextCursor ? (
              <div className={styles.pager}>
                <Link
                  className={styles.secondaryButton}
                  href={detailCursorHref(
                    details.conversation.id,
                    "historyCursor",
                    details.messages.nextCursor,
                    rawSearchParams.get("actionCursor"),
                  )}
                >
                  查看更早消息
                </Link>
              </div>
            ) : null}
          </section>

          <section className={styles.section}>
            <h2>Subagent 树</h2>
            {details.subagents.length === 0 ? (
              <p className={styles.empty}>暂无 Subagent 会话。</p>
            ) : (
              <ul className={styles.subagentList}>
                {details.subagents.map((subagent) => (
                  <li
                    className={styles.subagentItem}
                    key={subagent.conversationId}
                    style={{ marginInlineStart: `${(subagent.depth - 1) * 16}px` }}
                  >
                    <div>
                      {subagent.linkStatus === "VERIFIED" ? (
                        <Link href={`/admin/conversations/${subagent.conversationId}`}>
                          <strong>{subagent.name}</strong>
                        </Link>
                      ) : (
                        <strong>{subagent.name}</strong>
                      )}
                      <small>{subagent.conversationId}</small>
                    </div>
                    <span className={styles.statusBadge}>
                      {statusLabel(subagent.status)} · {subagent.linkStatus}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.section}>
            <h2>动作索引</h2>
            {execution.actions.items.length === 0 ? (
              <p className={styles.empty}>暂无 Tool、终端或运行动作。</p>
            ) : (
              <table className={styles.executionTable}>
                <thead>
                  <tr>
                    <th>动作</th>
                    <th>类型</th>
                    <th>状态</th>
                    <th>步骤</th>
                    <th>原始流范围</th>
                  </tr>
                </thead>
                <tbody>
                  {execution.actions.items.map((action) => (
                    <tr key={action.id}>
                      <td>{action.actionName}</td>
                      <td>{action.actionType}</td>
                      <td>{action.status}</td>
                      <td>{action.stepIndex}</td>
                      <td>
                        {action.rawDetails.available
                          ? `${action.rawDetails.startIndex}–${action.rawDetails.endIndex ?? "进行中"}`
                          : "不可用"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {execution.actions.nextCursor ? (
              <div className={styles.pager}>
                <Link
                  className={styles.secondaryButton}
                  href={detailCursorHref(
                    details.conversation.id,
                    "actionCursor",
                    execution.actions.nextCursor,
                    rawSearchParams.get("historyCursor"),
                  )}
                >
                  查看更早动作
                </Link>
              </div>
            ) : null}
          </section>
        </main>

        <aside className={styles.detailMain}>
          <section className={styles.section}>
            <h2>Token 汇总</h2>
            {details.tokenUsage ? (
              <div className={styles.usageGrid}>
                <Usage label="输入" value={details.tokenUsage.total.inputTokens} />
                <Usage label="输出" value={details.tokenUsage.total.outputTokens} />
                <Usage label="合计" value={details.tokenUsage.total.totalTokens} />
                <Usage label="直接步骤" value={details.tokenUsage.direct.stepCount} />
                <Usage label="Subagent 步骤" value={details.tokenUsage.subagents.stepCount} />
                <Usage label="上下文窗口" value={details.tokenUsage.currentContext.contextWindowTokens} />
              </div>
            ) : (
              <p className={styles.empty}>暂无用量数据。</p>
            )}
          </section>
          <section className={styles.section}>
            <h2>权限边界</h2>
            <p className={styles.muted}>
              此页面只允许查看安全历史、执行索引和原始事件流。管理员不能代用户发送消息、重试回复、重命名会话或修改历史。
            </p>
          </section>
        </aside>
      </div>
    </ApplicationFrame>
  );
}

function Meta({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Usage({ label, value }: { readonly label: string; readonly value: number | null }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value?.toLocaleString("zh-CN") ?? "-"}</strong>
    </div>
  );
}

function onlyQuery(
  source: URLSearchParams,
  sourceKey: string,
  targetKey: string,
): URLSearchParams {
  const result = new URLSearchParams();
  for (const value of source.getAll(sourceKey)) result.append(targetKey, value);
  return result;
}

function toSearchParams(
  value: Readonly<Record<string, string | string[] | undefined>>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") params.set(key, raw);
    else if (Array.isArray(raw)) {
      for (const item of raw) params.append(key, item);
    }
  }
  return params;
}

function detailCursorHref(
  conversationId: string,
  key: "historyCursor" | "actionCursor",
  cursor: string,
  otherCursor: string | null,
): string {
  const params = new URLSearchParams({ [key]: cursor });
  if (otherCursor) {
    params.set(key === "historyCursor" ? "actionCursor" : "historyCursor", otherCursor);
  }
  return `/admin/conversations/${conversationId}?${params.toString()}`;
}

function roleLabel(role: string): string {
  if (role === "USER") return "用户";
  if (role === "ASSISTANT") return "Agent";
  return "Subagent 委派";
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    STARTING: "启动中",
    RUNNING: "生成中",
    CANCELLING: "取消中",
    WAITING: "等待输入",
    TERMINAL_FAILED: "已失败",
    TERMINAL_COMPLETED: "已完成",
  };
  return labels[status] ?? status;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("zh-CN");
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1_024) return `${sizeBytes} B`;
  if (sizeBytes < 1_024 * 1_024) return `${(sizeBytes / 1_024).toFixed(1)} KiB`;
  return `${(sizeBytes / (1_024 * 1_024)).toFixed(1)} MiB`;
}
