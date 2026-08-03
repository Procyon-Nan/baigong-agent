import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApplicationFrame } from "@/app/components/application-frame";
import { ChatWorkspace } from "@/app/components/chat/chat-workspace";
import { resolvePrincipal } from "@/src/server/authorization";
import { getCurrentModelClientSettings } from "@/src/server/models/service";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const principal = await resolvePrincipal(new Headers(await headers()));
  if (!principal) redirect("/login");
  if (principal.mustChangePassword) redirect("/change-password");

  const modelSettings = await getCurrentModelClientSettings(
    principal.tenantId,
  );

  return (
    <ApplicationFrame
      navigationMode={principal.role === "ADMIN" ? "admin" : "user"}
      user={{ displayName: principal.displayName, role: principal.role }}
    >
      <div className={styles.chatPage}>
        <ChatWorkspace
          displayName={principal.displayName}
          enableExecutionDetails={principal.role === "ADMIN"}
          contextWindowTokens={modelSettings.contextWindowTokens}
          modelAvailable={modelSettings.available}
        />
      </div>
    </ApplicationFrame>
  );
}
