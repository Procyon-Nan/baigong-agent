import { KeyRound, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApplicationFrame } from "@/app/components/application-frame";
import { resolvePrincipal } from "@/src/server/authorization";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const principal = await resolvePrincipal(new Headers(await headers()));
  if (!principal) redirect("/login");
  if (principal.mustChangePassword) redirect("/change-password");

  return (
    <ApplicationFrame
      navigationMode={principal.role === "ADMIN" ? "admin" : "user"}
      user={{ displayName: principal.displayName, role: principal.role }}
    >
      <header className={styles.header}>
        <span>个人设置</span>
        <h1>账号</h1>
      </header>
      <section className={styles.details}>
        <div>
          <UserRound aria-hidden="true" size={18} />
          <span>
            <small>显示名称</small>
            <strong>{principal.displayName}</strong>
          </span>
        </div>
        <div>
          <ShieldCheck aria-hidden="true" size={18} />
          <span>
            <small>身份与角色</small>
            <strong>
              {principal.source} · {principal.role}
            </strong>
          </span>
        </div>
      </section>
      {principal.source === "LOCAL" ? (
        <Link className={styles.action} href="/change-password">
          <KeyRound aria-hidden="true" size={17} />
          <span>修改密码</span>
        </Link>
      ) : null}
    </ApplicationFrame>
  );
}
