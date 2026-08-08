"use client";

import {
  BadgeCheck,
  CircleAlert,
  FlaskConical,
  KeyRound,
  Save,
  Trash2,
  Wrench,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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
  readonly supportsImageInput: boolean;
  readonly supportsNativePdfInput: boolean;
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

type ToolCallingTestResult = ConnectionTestResult & {
  readonly verified: true;
  readonly toolName: string;
};

type FormState = {
  readonly providerDisplayName: string;
  readonly baseUrl: string;
  readonly modelName: string;
  readonly contextWindowTokens: string;
  readonly supportsImageInput: boolean;
  readonly supportsNativePdfInput: boolean;
  readonly apiKey: string;
  readonly clearApiKey: boolean;
};

const emptyForm: FormState = {
  providerDisplayName: "",
  baseUrl: "",
  modelName: "",
  contextWindowTokens: "",
  supportsImageInput: false,
  supportsNativePdfInput: false,
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
  const [toolCallingTestResult, setToolCallingTestResult] =
    useState<ToolCallingTestResult | null>(null);

  useEffect(() => {
    setForm(formFromConfiguration(configuration));
  }, [configuration]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTestResult(null);
    setToolCallingTestResult(null);
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

  async function testToolCalling() {
    setToolCallingTestResult(null);
    const result = await request<{ readonly result: ToolCallingTestResult }>(
      "/api/admin/model-config/test-tool-calling",
      {
        method: "POST",
        body: JSON.stringify(requestBody(form)),
      },
      { refresh: false },
    );
    if (result) setToolCallingTestResult(result.result);
  }

  async function removeConfiguration() {
    if (!window.confirm("删除当前模型配置？")) return;
    setTestResult(null);
    setToolCallingTestResult(null);
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

        <fieldset className={styles.capabilityFieldset}>
          <legend>模型输入能力</legend>
          <p>能力由管理员根据提供商文档声明，系统不会根据模型名称推断。</p>
          <label className={styles.checkboxLabel}>
            <input
              checked={form.supportsImageInput}
              onChange={(event) =>
                setForm({
                  ...form,
                  supportsImageInput: event.target.checked,
                })
              }
              type="checkbox"
            />
            <span>支持 PNG、JPEG 和 WebP 图片输入</span>
          </label>
          <label className={styles.checkboxLabel}>
            <input
              checked={form.supportsNativePdfInput}
              onChange={(event) =>
                setForm({
                  ...form,
                  supportsNativePdfInput: event.target.checked,
                })
              }
              type="checkbox"
            />
            <span>支持原生 PDF 输入</span>
          </label>
        </fieldset>

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
          <button
            className={styles.secondaryButton}
            disabled={isPending}
            onClick={testToolCalling}
            type="button"
          >
            <Wrench aria-hidden="true" size={16} />
            测试工具调用
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

      <div className={styles.testPanels} aria-live="polite">
        <TestResultPanel
          icon={<KeyRound aria-hidden="true" size={17} />}
          result={testResult}
          title="连接测试"
        />
        <TestResultPanel
          icon={<Wrench aria-hidden="true" size={17} />}
          result={toolCallingTestResult}
          title="工具调用测试"
        />
      </div>
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
    supportsImageInput: configuration.supportsImageInput,
    supportsNativePdfInput: configuration.supportsNativePdfInput,
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
    supportsImageInput: form.supportsImageInput,
    supportsNativePdfInput: form.supportsNativePdfInput,
    ...(form.clearApiKey
      ? { apiKey: null }
      : form.apiKey
        ? { apiKey: form.apiKey }
        : {}),
  };
}

function TestResultPanel({
  icon,
  result,
  title,
}: {
  readonly icon: ReactNode;
  readonly result: ConnectionTestResult | null;
  readonly title: string;
}) {
  return (
    <section className={styles.testPanel}>
      <div className={styles.testHeading}>
        {icon}
        <h2>{title}</h2>
      </div>
      {result ? (
        <>
          <div className={styles.testSuccess}>
            <BadgeCheck aria-hidden="true" size={14} />
            测试成功
          </div>
          <div className={styles.testMeta}>
            <span>{result.durationMs} ms</span>
            <span>{formatUsage(result.usage)}</span>
          </div>
          <div className={styles.testOutput}>
            <MarkdownContent markdown={result.output} />
          </div>
        </>
      ) : (
        <p className={styles.emptyTest}>尚未执行</p>
      )}
    </section>
  );
}

function formatUsage(usage: ConnectionTestResult["usage"]): string {
  const parts = [
    usage.inputTokens === undefined ? null : `输入 ${usage.inputTokens}`,
    usage.outputTokens === undefined ? null : `输出 ${usage.outputTokens}`,
    usage.totalTokens === undefined ? null : `合计 ${usage.totalTokens}`,
  ].filter((value): value is string => value !== null);
  return parts.length > 0 ? `${parts.join(" · ")} Token` : "Token 未报告";
}
