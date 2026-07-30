import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApplicationFrame } from "@/app/components/application-frame";
import { requirePrincipal } from "@/src/server/authorization";
import { ChangePasswordForm } from "./change-password-form";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  let principal;
  try {
    principal = await requirePrincipal(new Headers(await headers()), {
      allowPasswordChange: true,
    });
  } catch {
    redirect("/login");
  }
  if (principal.source !== "LOCAL") redirect("/");

  return (
    <ApplicationFrame
      navigationMode={principal.role === "ADMIN" ? "admin" : "user"}
      user={{ displayName: principal.displayName, role: principal.role }}
    >
      <header className={styles.header}>
        <span>账号安全</span>
        <h1>修改密码</h1>
        <p>
          {principal.mustChangePassword
            ? "首次登录必须更换临时密码。"
            : "更新当前本地账号的登录密码。"}
        </p>
      </header>
      <ChangePasswordForm />
    </ApplicationFrame>
  );
}
