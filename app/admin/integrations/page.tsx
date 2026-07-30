import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApplicationFrame } from "@/app/components/application-frame";
import {
  isAdminPrincipal,
  resolvePrincipal,
} from "@/src/server/authorization";
import { listEmbeddedClients } from "@/src/server/integrations/service";
import { IntegrationsManager } from "./integrations-manager";
import styles from "../admin.module.css";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const principal = await resolvePrincipal(new Headers(await headers()));
  if (!principal) redirect("/login");
  if (principal.mustChangePassword) redirect("/change-password");
  if (!isAdminPrincipal(principal)) redirect("/settings");
  const clients = await listEmbeddedClients(principal);

  return (
    <ApplicationFrame
      navigationMode="admin"
      user={{ displayName: principal.displayName, role: principal.role }}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>宿主接入</p>
          <h1>嵌入接入</h1>
          <p>管理通用嵌入客户端及其精确允许 Origin。</p>
        </div>
      </header>
      <IntegrationsManager
        clients={clients.map((client) => ({
          ...client,
          createdAt: client.createdAt.toISOString(),
          updatedAt: client.updatedAt.toISOString(),
        }))}
      />
    </ApplicationFrame>
  );
}
