"use client";

import { KeyRound, Pencil, Plus, Power, RotateCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "../admin.module.css";

type ClientRow = {
  id: string;
  name: string;
  clientId: string;
  status: "ACTIVE" | "DISABLED";
  allowedOrigins: string[];
  createdAt: string;
  updatedAt: string;
};

export function IntegrationsManager({
  clients,
}: {
  readonly clients: ClientRow[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");

  async function request(path: string, init: RequestInit) {
    setPending(path);
    setError("");
    const response = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });
    const result = (await response.json()) as {
      error?: { message?: string };
      clientSecret?: string;
    };
    setPending("");
    if (!response.ok) {
      setError(result.error?.message || "操作失败。");
      return null;
    }
    router.refresh();
    return result;
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await request("/api/admin/integrations", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        allowedOrigins: String(form.get("allowedOrigins") || "")
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean),
      }),
    });
    if (result?.clientSecret) {
      setSecret(result.clientSecret);
      event.currentTarget.reset();
    }
  }

  return (
    <div className={styles.layout}>
      <section className={styles.tablePanel} aria-label="嵌入客户端列表">
        {clients.length === 0 ? (
          <p className={styles.empty}>暂无嵌入客户端</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>客户端</th>
                <th>状态</th>
                <th>允许 Origin</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td className={styles.identity}>
                    <strong>{client.name}</strong>
                    <small>{client.clientId}</small>
                  </td>
                  <td>
                    <span
                      className={`${styles.badge} ${client.status === "DISABLED" ? styles.mutedBadge : ""}`}
                    >
                      {client.status}
                    </span>
                  </td>
                  <td className={styles.origins}>
                    {client.allowedOrigins.join(" · ")}
                  </td>
                  <td>{new Date(client.updatedAt).toLocaleString("zh-CN")}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        aria-label={
                          client.status === "ACTIVE"
                            ? "停用客户端"
                            : "启用客户端"
                        }
                        className={styles.iconButton}
                        disabled={Boolean(pending)}
                        onClick={() =>
                          request(`/api/admin/integrations/${client.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              status:
                                client.status === "ACTIVE"
                                  ? "DISABLED"
                                  : "ACTIVE",
                            }),
                          })
                        }
                        title={
                          client.status === "ACTIVE"
                            ? "停用客户端"
                            : "启用客户端"
                        }
                        type="button"
                      >
                        <Power size={15} />
                      </button>
                      <button
                        aria-label="轮换客户端密钥"
                        className={styles.iconButton}
                        disabled={Boolean(pending)}
                        onClick={async () => {
                          const result = await request(
                            `/api/admin/integrations/${client.id}/rotate-secret`,
                            { method: "POST" },
                          );
                          if (result?.clientSecret)
                            setSecret(result.clientSecret);
                        }}
                        title="轮换客户端密钥"
                        type="button"
                      >
                        <RotateCw size={15} />
                      </button>
                      <button
                        aria-label="修改允许 Origin"
                        className={styles.iconButton}
                        disabled={Boolean(pending)}
                        onClick={() => {
                          const value = window.prompt(
                            "允许 Origin（每行一个）",
                            client.allowedOrigins.join("\n"),
                          );
                          if (value !== null)
                            void request(
                              `/api/admin/integrations/${client.id}`,
                              {
                                method: "PATCH",
                                body: JSON.stringify({
                                  allowedOrigins: value
                                    .split(/\r?\n/)
                                    .map((origin) => origin.trim())
                                    .filter(Boolean),
                                }),
                              },
                            );
                        }}
                        title="修改允许 Origin"
                        type="button"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        aria-label="删除客户端"
                        className={styles.iconButton}
                        disabled={Boolean(pending)}
                        onClick={() =>
                          request(`/api/admin/integrations/${client.id}`, {
                            method: "DELETE",
                          })
                        }
                        title="删除客户端"
                        type="button"
                      >
                        <Trash2 size={15} />
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
        <h2>创建嵌入客户端</h2>
        <form className={styles.form} onSubmit={create}>
          <label>
            <span>客户端名称</span>
            <input name="name" required />
          </label>
          <label>
            <span>允许 Origin（每行一个）</span>
            <textarea
              name="allowedOrigins"
              placeholder="http://localhost:4100"
              required
            />
          </label>
          <button
            className={styles.primaryButton}
            disabled={Boolean(pending)}
            type="submit"
          >
            <Plus size={16} />
            <span>创建客户端</span>
          </button>
        </form>
        {secret ? (
          <p className={styles.notice}>
            <KeyRound aria-hidden="true" size={14} /> 客户端密钥（仅显示一次）：
            {secret}
          </p>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </aside>
    </div>
  );
}
