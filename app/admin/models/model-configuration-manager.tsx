"use client";

import {
  CircleAlert,
  FlaskConical,
  KeyRound,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useAdminRequest } from "@/app/admin/use-admin-request";
import { MarkdownContent } from "@/app/components/chat/markdown-content";
import styles from "./models.module.css";

type ModelConfiguration = {
  readonly status: "CONFIGURED";
  readonly id: string;
  readonly version: number;
  readonly providerDisplayName: string;
  readonly baseUrl: string;
  readonly modelName: string;
  readonly contextWindowTokens: number | null;
  readonly hasApiKey: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type ConnectionTestResult = {
  readonly output: string;
  readonly durationMs: number;
  readonly usage: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
  };
};

type FormState = {
  readonly providerDisplayName: string;
  readonly baseUrl: string;
  readonly modelName: string;
  readonly contextWindowTokens: string;
  readonly apiKey: string;
  readonly clearApiKey: boolean;
};

const emptyForm: FormState = {
  providerDisplayName: "",
  baseUrl: "",
  modelName: "",
  contextWindowTokens: "",
  apiKey: "",
  clearApiKey: false,
};

export function ModelConfigurationManager({
  configuration,
}: {
  readonly configuration: ModelConfiguration | null;
}) {
  const { error, pending, request } = useAdminRequest();
  const [form, setForm] = useState(() => formFromConfiguration(configuration));
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(
    null,
  );

  useEffect(() => {
    setForm(formFromConfiguration(configuration));
  }, [configuration]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTestResult(null);
    await request("/api/admin/model-config", {
      method: "PUT",
      body: JSON.stringify(requestBody(form)),
    });
  }

  async function testConnection() {
    setTestResult(null);
    const result = await request<{ readonly result: ConnectionTestResult }>(
      "/api/admin/model-config/test",
      {
        method: "POST",
        body: JSON.stringify(requestBody(form)),
      },
      { refresh: false },
    );
    if (result) setTestResult(result.result);
  }

  async function removeConfiguration() {
    if (!window.confirm("删除当前模型配置？")) return;
    setTestResult(null);
    const result = await request<{ readonly deleted: boolean }>(
      "/api/admin/model-config",
      { method: "DELETE" },
    );
    if (result?.deleted) setForm(emptyForm);
  }

  const isPending = Boolean(pending);
  const insecureHttp = form.baseUrl.trim().toLowerCase().startsWith("http:");

  return (
    <div className={styles.layout}>
      <form className={styles.formPanel} onSubmit={save}>
        <div className={styles.formGrid}>
          <label>
            <span>提供商名称</span>
            <input
              maxLength={120}
              onChange={(event) =>
                setForm({ ...form, providerDisplayName: event.target.value })
              }
              required
              value={form.providerDisplayName}
            />
          </label>
          <label>
            <span>模型名称</span>
            <input
              maxLength={255}
              onChange={(event) =>
                setForm({ ...form, modelName: event.target.value })
              }
              required
              value={form.modelName}
            />
          </label>
          <label className={styles.wideField}>
            <span>Base URL</span>
            <input
              inputMode="url"
              maxLength={2048}
              onChange={(event) =>
                setForm({ ...form, baseUrl: event.target.value })
              }
              required
              value={form.baseUrl}
            />
          </label>
          {insecureHttp ? (
            <p className={styles.httpNotice}>
              <CircleAlert aria-hidden="true" size={15} />
              HTTP 连接不会提供传输加密
            </p>
          ) : null}
          <label>
            <span>最大上下文窗口 Token</span>
            <input
              inputMode="numeric"
              min={1}
              onChange={(event) =>
                setForm({ ...form, contextWindowTokens: event.target.value })
              }
              placeholder="未配置"
              type="number"
              value={form.contextWindowTokens}
            />
          </label>
          <label>
            <span>
              API Key
              {configuration?.hasApiKey ? (
                <small className={styles.savedCredential}>已保存</small>
              ) : null}
            </span>
            <input
              autoComplete="new-password"
              disabled={form.clearApiKey}
              maxLength={16384}
              onChange={(event) =>
                setForm({ ...form, apiKey: event.target.value })
              }
              placeholder={configuration?.hasApiKey ? "保持不变" : "可选"}
              type="password"
              value={form.apiKey}
            />
          </label>
        </div>

        {configuration?.hasApiKey ? (
          <label className={styles.checkboxLabel}>
            <input
              checked={form.clearApiKey}
              onChange={(event) =>
                setForm({
                  ...form,
                  apiKey: "",
                  clearApiKey: event.target.checked,
                })
              }
              type="checkbox"
            />
            <span>清除已保存的 API Key</span>
          </label>
        ) : null}

        <div className={styles.actions}>
          <button
            className={styles.primaryButton}
            disabled={isPending}
            type="submit"
          >
            <Save aria-hidden="true" size={16} />
            保存配置
          </button>
          <button
            className={styles.secondaryButton}
            disabled={isPending}
            onClick={testConnection}
            type="button"
          >
            <FlaskConical aria-hidden="true" size={16} />
            测试连接
          </button>
          {configuration ? (
            <button
              aria-label="删除模型配置"
              className={styles.dangerButton}
              disabled={isPending}
              onClick={removeConfiguration}
              title="删除模型配置"
              type="button"
            >
              <Trash2 aria-hidden="true" size={16} />
            </button>
          ) : null}
        </div>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>

      <aside className={styles.testPanel} aria-live="polite">
        <div className={styles.testHeading}>
          <KeyRound aria-hidden="true" size={17} />
          <h2>连接测试</h2>
        </div>
        {testResult ? (
          <>
            <div className={styles.testMeta}>
              <span>{testResult.durationMs} ms</span>
              <span>{formatUsage(testResult.usage)}</span>
            </div>
            <div className={styles.testOutput}>
              <MarkdownContent markdown={testResult.output} />
            </div>
          </>
        ) : (
          <p className={styles.emptyTest}>尚未执行</p>
        )}
      </aside>
    </div>
  );
}

function formFromConfiguration(
  configuration: ModelConfiguration | null,
): FormState {
  if (!configuration) return emptyForm;
  return {
    providerDisplayName: configuration.providerDisplayName,
    baseUrl: configuration.baseUrl,
    modelName: configuration.modelName,
    contextWindowTokens: configuration.contextWindowTokens?.toString() ?? "",
    apiKey: "",
    clearApiKey: false,
  };
}

function requestBody(form: FormState) {
  return {
    providerDisplayName: form.providerDisplayName,
    baseUrl: form.baseUrl,
    modelName: form.modelName,
    contextWindowTokens: form.contextWindowTokens
      ? Number(form.contextWindowTokens)
      : null,
    ...(form.clearApiKey
      ? { apiKey: null }
      : form.apiKey
        ? { apiKey: form.apiKey }
        : {}),
  };
}

function formatUsage(usage: ConnectionTestResult["usage"]): string {
  const parts = [
    usage.inputTokens === undefined ? null : `输入 ${usage.inputTokens}`,
    usage.outputTokens === undefined ? null : `输出 ${usage.outputTokens}`,
    usage.totalTokens === undefined ? null : `合计 ${usage.totalTokens}`,
  ].filter((value): value is string => value !== null);
  return parts.length > 0 ? `${parts.join(" · ")} Token` : "Token 未报告";
}
