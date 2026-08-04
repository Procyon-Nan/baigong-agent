import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ApplicationFrame } from "@/app/components/application-frame";
import {
  isAdminPrincipal,
  resolvePrincipal,
} from "@/src/server/authorization";
import {
  listAdminConversations,
} from "@/src/server/conversations/service";
import { parseAdminConversationListQuery } from "@/src/server/http/p4-admin-conversation-schemas";
import { listUsers } from "@/src/server/users/service";
import adminStyles from "../admin.module.css";
import styles from "./conversations.module.css";

export const dynamic = "force-dynamic";

type PageProps = {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

export default async function AdminConversationsPage({
  searchParams,
}: PageProps) {
  const principal = await resolvePrincipal(new Headers(await headers()));
  if (!principal) redirect("/login");
  if (principal.mustChangePassword) redirect("/change-password");
  if (!isAdminPrincipal(principal)) redirect("/settings");

  const query = parseAdminConversationListQuery(
    toSearchParams(await searchParams),
  );
  const [page, users] = await Promise.all([
    listAdminConversations(principal, {
      ownerUserId: query.userId,
      ownerSource: query.source,
      status: query.status,
      archived: query.archived,
      cursor: query.cursor,
    }),
    listUsers(principal),
  ]);

  return (
    <ApplicationFrame
      contentWidth="wide"
      navigationMode="admin"
      user={{ displayName: principal.displayName, role: principal.role }}
    >
      <div className={styles.page}>
        <header className={adminStyles.header}>
          <div>
            <p className={adminStyles.eyebrow}>运行观察</p>
            <h1>会话审计</h1>
            <p>查看本租户用户会话的安全历史和执行索引。</p>
          </div>
        </header>
        <form className={styles.filters} method="get">
          <label>
            用户
            <select defaultValue={query.userId ?? ""} name="userId">
              <option value="">全部用户</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}（{user.source}）
                </option>
              ))}
            </select>
          </label>
          <label>
            身份来源
            <select defaultValue={query.source ?? ""} name="source">
              <option value="">全部来源</option>
              <option value="LOCAL">本地</option>
              <option value="EMBEDDED">嵌入</option>
            </select>
          </label>
          <label>
            状态
            <select defaultValue={query.status ?? ""} name="status">
              <option value="">全部状态</option>
              <option value="WAITING">等待输入</option>
              <option value="RUNNING">生成中</option>
              <option value="TERMINAL_COMPLETED">已完成</option>
              <option value="TERMINAL_FAILED">已失败</option>
              <option value="CANCELLING">取消中</option>
              <option value="STARTING">启动中</option>
            </select>
          </label>
          <label>
            归档
            <select defaultValue={query.archived} name="archived">
              <option value="all">全部</option>
              <option value="active">未归档</option>
              <option value="archived">已归档</option>
            </select>
          </label>
          <button className={styles.filterButton} type="submit">
            筛选
          </button>
        </form>
        <section className={styles.tablePanel} aria-label="会话审计列表">
          {page.items.length === 0 ? (
            <p className={styles.empty}>暂无匹配会话。</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>会话</th>
                  <th>所有者</th>
                  <th>状态</th>
                  <th>最后活动</th>
                  <th>归档</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((conversation) => (
                  <tr key={conversation.id}>
                    <td>
                      <Link
                        className={styles.conversationLink}
                        href={`/admin/conversations/${conversation.id}`}
                      >
                        <strong>{conversation.title}</strong>
                        <small>{conversation.id}</small>
                      </Link>
                    </td>
                    <td className={styles.owner}>
                      <strong>{conversation.owner.displayName}</strong>
                      <small>
                        {conversation.owner.identifier} · {conversation.owner.source}
                      </small>
                    </td>
                    <td>
                      <span className={styles.statusBadge}>
                        {statusLabel(conversation.status)}
                      </span>
                    </td>
                    <td className={styles.muted}>
                      {formatDate(conversation.updatedAt)}
                    </td>
                    <td>
                      <span
                        className={`${styles.badge} ${conversation.archivedAt ? styles.mutedBadge : ""}`}
                      >
                        {conversation.archivedAt ? "已归档" : "未归档"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {page.nextCursor ? (
            <div className={styles.pager}>
              <Link
                className={styles.secondaryButton}
                href={withCursor(query, page.nextCursor)}
              >
                下一页
              </Link>
            </div>
          ) : null}
        </section>
      </div>
    </ApplicationFrame>
  );
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

function withCursor(
  query: {
    readonly userId?: string;
    readonly source?: string;
    readonly status?: string;
    readonly archived: string;
  },
  cursor: string,
): string {
  const params = new URLSearchParams();
  if (query.userId) params.set("userId", query.userId);
  if (query.source) params.set("source", query.source);
  if (query.status) params.set("status", query.status);
  params.set("archived", query.archived);
  params.set("cursor", cursor);
  return `/admin/conversations?${params.toString()}`;
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
