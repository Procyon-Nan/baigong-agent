import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApplicationFrame } from "@/app/components/application-frame";
import { resolvePrincipal } from "@/src/server/authorization";
import { listUsers } from "@/src/server/users/service";
import { UsersManager } from "./users-manager";
import styles from "../admin.module.css";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const principal = await resolvePrincipal(new Headers(await headers()));
  if (!principal) redirect("/login");
  if (principal.mustChangePassword) redirect("/change-password");
  if (principal.role !== "ADMIN" || principal.source !== "LOCAL")
    redirect("/settings");
  const users = await listUsers(principal.tenantId);

  return (
    <ApplicationFrame
      navigationMode="admin"
      user={{ displayName: principal.displayName, role: principal.role }}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>访问控制</p>
          <h1>用户</h1>
          <p>管理本地账号与嵌入影子用户。</p>
        </div>
      </header>
      <UsersManager
        users={users.map((user) => ({
          ...user,
          createdAt: user.createdAt.toISOString(),
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        }))}
      />
    </ApplicationFrame>
  );
}
