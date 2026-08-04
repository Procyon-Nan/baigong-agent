"use client";

import { Archive, Radio, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAdminRequest } from "@/app/admin/use-admin-request";
import { ExecutionDetails } from "@/app/components/chat/execution-details";
import styles from "../conversations.module.css";

export function AuditControls({
  activeTurnId,
  archived,
  conversationId,
  isMain,
}: {
  readonly activeTurnId: string | null;
  readonly archived: boolean;
  readonly conversationId: string;
  readonly isMain: boolean;
}) {
  const router = useRouter();
  const { error, pending, request } = useAdminRequest();
  const [showEvents, setShowEvents] = useState(false);

  return (
    <div className={styles.controlStack}>
      <div className={styles.headerActions}>
        <button
          className={styles.secondaryButton}
          onClick={() => setShowEvents((visible) => !visible)}
          type="button"
        >
          <Radio aria-hidden="true" size={14} />
          {showEvents ? "隐藏原始流" : "查看原始流"}
        </button>
        {activeTurnId ? (
          <button
            className={styles.dangerButton}
            disabled={Boolean(pending)}
            onClick={() =>
              request(
                `/api/admin/conversations/${conversationId}/cancel`,
                {
                  method: "POST",
                  body: JSON.stringify({ turnId: activeTurnId }),
                },
              )
            }
            type="button"
          >
            <Square aria-hidden="true" size={13} />
            取消当前回复
          </button>
        ) : null}
        {isMain && !archived ? (
          <button
            className={styles.secondaryButton}
            disabled={Boolean(pending)}
            onClick={() =>
              request(
                `/api/admin/conversations/${conversationId}/archive`,
                { method: "POST" },
              )
            }
            type="button"
          >
            <Archive aria-hidden="true" size={14} />
            归档
          </button>
        ) : null}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {showEvents ? (
        <div className={styles.rawEventOverlay}>
          <ExecutionDetails
            conversationId={conversationId}
            onAuthenticationExpired={() => router.replace("/login")}
            onClose={() => setShowEvents(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
