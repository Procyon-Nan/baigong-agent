import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { closeDatabase } from "@/src/server/db/client";
import {
  createLocalUser,
  hasActiveLocalAdministrator,
} from "@/src/server/users/service";

if (!stdin.isTTY || !stdout.isTTY) {
  throw new Error("admin:bootstrap 必须在交互式终端中运行。");
}

const prompt = createInterface({ input: stdin, output: stdout });
try {
  if (await hasActiveLocalAdministrator()) {
    throw new Error("已存在有效本地管理员，初始化已拒绝。");
  }

  const username = await prompt.question("管理员用户名: ");
  const email = await prompt.question("管理员邮箱: ");
  const displayName = await prompt.question("管理员显示名称: ");
  const result = await createLocalUser({
    username,
    email,
    displayName,
    role: "ADMIN",
  });

  stdout.write(
    `\n管理员已创建。\n用户名: ${result.user.username}\n临时密码: ${result.temporaryPassword}\n`,
  );
  stdout.write("临时密码仅显示本次；首次登录后必须立即修改。\n");
} finally {
  prompt.close();
  await closeDatabase();
}
