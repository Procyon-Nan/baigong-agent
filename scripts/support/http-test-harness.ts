import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";

export type TestApplication = {
  readonly process: ChildProcess;
  readonly output: string[];
  readonly phase: "P3" | "P4";
};

export function startTestApplication(
  port: number,
  phase: TestApplication["phase"],
): TestApplication {
  const output: string[] = [];
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk: Buffer) => {
      output.push(chunk.toString("utf8"));
      if (output.length > 100) output.shift();
    });
  }
  return { process: child, output, phase };
}

export async function waitForTestApplication(
  origin: string,
  application: TestApplication,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (application.process.exitCode !== null) {
      throw new Error(
        `${application.phase} 测试应用提前退出（${application.process.exitCode}）。\n${application.output.join("")}`,
      );
    }
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.status === 200) return;
    } catch {
      // The development server has not bound the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `${application.phase} 测试应用启动超时。\n${application.output.join("")}`,
  );
}

export async function stopTestApplication(
  application: TestApplication,
): Promise<void> {
  const child = application.process;
  if (child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), 5_000);
    timer.unref();
  });
  const outcome = await Promise.race([exited, timeout]);
  if (timer) clearTimeout(timer);
  if (outcome === "timeout") {
    const killed = once(child, "exit");
    child.kill("SIGKILL");
    await killed;
  }
}

export async function availableTestPort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("无法分配本地测试端口。");
  }
  const closed = once(server, "close");
  server.close();
  await closed;
  return address.port;
}

export async function readFirstStreamChunk(
  response: Response,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("管理员原始事件流没有响应体。");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("读取管理员原始事件流超时。")),
        5_000,
      );
    });
    const first = await Promise.race([reader.read(), timeout]);
    if (first.done || first.value.length === 0) {
      throw new Error("管理员原始事件流为空。");
    }
    return new TextDecoder().decode(first.value);
  } finally {
    if (timer) clearTimeout(timer);
    await reader.cancel();
  }
}

export async function runCleanupStep(
  operation: () => void | Promise<void>,
  failures: unknown[],
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    failures.push(error);
  }
}
