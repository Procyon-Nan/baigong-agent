"use client";

import { KeyRound, Plus, Power, RefreshCw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAdminRequest } from "@/app/admin/use-admin-request";
import styles from "../admin.module.css";

type UserRow = {
  id: string;
  username: string | null;
  email: string | null;
  displayName: string;
  source: "LOCAL" | "EMBEDDED";
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED";
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export function UsersManager({ users }: { readonly users: UserRow[] }) {
  const { error, pending, request } = useAdminRequest();
  const [notice, setNotice] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await request<{ temporaryPassword?: string }>(
      "/api/admin/users",
      {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form)),
      },
    );
    if (result?.temporaryPassword) {
      setNotice(`临时密码（仅显示一次）：${result.temporaryPassword}`);
      event.currentTarget.reset();
    }
  }

  return (
    <>
      <div className={styles.layout}>
        <section className={styles.tablePanel} aria-label="用户列表">
          {users.length === 0 ? (
            <p className={styles.empty}>暂无用户</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>来源</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>最后登录</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className={styles.identity}>
                      <strong>{user.displayName}</strong>
                      <small>{user.username || user.email || user.id}</small>
                    </td>
                    <td>
                      <span
                        className={`${styles.badge} ${user.source === "EMBEDDED" ? styles.mutedBadge : ""}`}
                      >
                        {user.source}
                      </span>
                    </td>
                    <td>
                      {user.source === "LOCAL" ? (
                        <select
                          aria-label={`修改 ${user.displayName} 的角色`}
                          className={styles.select}
                          defaultValue={user.role}
                          disabled={Boolean(pending)}
                          onChange={(event) =>
                            request(`/api/admin/users/${user.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({
                                role: event.target.value,
                              }),
                            })
                          }
                        >
                          <option value="USER">USER</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      ) : (
                        "USER"
                      )}
                    </td>
                    <td>{user.status}</td>
                    <td>
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleString("zh-CN")
                        : "-"}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <button
                          aria-label={
                            user.status === "ACTIVE" ? "禁用用户" : "启用用户"
                          }
                          className={styles.iconButton}
                          disabled={Boolean(pending)}
                          onClick={() =>
                            request(`/api/admin/users/${user.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({
                                status:
                                  user.status === "ACTIVE"
                                    ? "DISABLED"
                                    : "ACTIVE",
                              }),
                            })
                          }
                          title={
                            user.status === "ACTIVE" ? "禁用用户" : "启用用户"
                          }
                          type="button"
                        >
                          <Power size={15} />
                        </button>
                        {user.source === "LOCAL" ? (
                          <button
                            aria-label="重置密码"
                            className={styles.iconButton}
                            disabled={Boolean(pending)}
                            onClick={async () => {
                              const result = await request<{
                                temporaryPassword?: string;
                              }>(
                                `/api/admin/users/${user.id}/reset-password`,
                                { method: "POST" },
                              );
                              if (result?.temporaryPassword)
                                setNotice(
                                  `临时密码（仅显示一次）：${result.temporaryPassword}`,
                                );
                            }}
                            title="重置密码"
                            type="button"
                          >
                            <KeyRound size={15} />
                          </button>
                        ) : null}
                        <button
                          aria-label="撤销全部会话"
                          className={styles.iconButton}
                          disabled={Boolean(pending)}
                          onClick={() =>
                            request(
                              `/api/admin/users/${user.id}/revoke-sessions`,
                              { method: "POST" },
                            )
                          }
                          title="撤销全部会话"
                          type="button"
                        >
                          <RefreshCw size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <aside className={styles.formPanel}>
          <h2>创建本地用户</h2>
          <form className={styles.form} onSubmit={create}>
            <label>
              <span>用户名</span>
              <input name="username" required />
            </label>
            <label>
              <span>邮箱</span>
              <input name="email" required type="email" />
            </label>
            <label>
              <span>显示名称</span>
              <input name="displayName" required />
            </label>
            <label>
              <span>角色</span>
              <select defaultValue="USER" name="role">
                <option value="USER">普通用户</option>
                <option value="ADMIN">管理员</option>
              </select>
            </label>
            <button
              className={styles.primaryButton}
              disabled={Boolean(pending)}
              type="submit"
            >
              <Plus size={16} />
              <span>创建用户</span>
            </button>
          </form>
          {notice ? <p className={styles.notice}>{notice}</p> : null}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </aside>
      </div>
    </>
  );
}
