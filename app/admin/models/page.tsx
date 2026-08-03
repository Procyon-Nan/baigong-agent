import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApplicationFrame } from "@/app/components/application-frame";
import {
  isAdminPrincipal,
  resolvePrincipal,
} from "@/src/server/authorization";
import { getCurrentModelConfiguration } from "@/src/server/models/service";
import { ModelConfigurationManager } from "./model-configuration-manager";
import styles from "./models.module.css";

export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  const principal = await resolvePrincipal(new Headers(await headers()));
  if (!principal) redirect("/login");
  if (principal.mustChangePassword) redirect("/change-password");
  if (!isAdminPrincipal(principal)) redirect("/settings");

  const configuration = await getCurrentModelConfiguration(principal);

  return (
    <ApplicationFrame
      navigationMode="admin"
      user={{ displayName: principal.displayName, role: principal.role }}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>主 Agent</p>
          <h1>模型配置</h1>
          <p>OpenAI Chat Completions 兼容端点</p>
        </div>
        {configuration ? (
          <span className={styles.version}>版本 {configuration.version}</span>
        ) : null}
      </header>
      <ModelConfigurationManager
        configuration={
          configuration
            ? {
                ...configuration,
                createdAt: configuration.createdAt.toISOString(),
                updatedAt: configuration.updatedAt.toISOString(),
              }
            : null
        }
      />
    </ApplicationFrame>
  );
}
