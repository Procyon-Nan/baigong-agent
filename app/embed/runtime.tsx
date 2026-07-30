"use client";

import { LoaderCircle, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

type RuntimeState =
  | { status: "waiting" }
  | { status: "exchanging" }
  | { status: "authenticated"; displayName: string; expiresAt: string }
  | { status: "failed" };

export function EmbedRuntime() {
  const token = useRef<string | null>(null);
  const trustedHostOrigin = useRef<string | null>(null);
  const [state, setState] = useState<RuntimeState>({ status: "waiting" });

  useEffect(() => {
    try {
      if (document.referrer)
        trustedHostOrigin.current = new URL(document.referrer).origin;
    } catch {
      trustedHostOrigin.current = null;
    }
    async function receiveTicket(event: MessageEvent) {
      if (event.source !== window.parent || !isTicketMessage(event.data))
        return;
      if (
        trustedHostOrigin.current &&
        trustedHostOrigin.current !== event.origin
      )
        return;
      setState({ status: "exchanging" });
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (token.current) headers.authorization = `Bearer ${token.current}`;
      try {
        const response = await fetch("/api/embed/exchange", {
          method: "POST",
          headers,
          body: JSON.stringify({
            ticket: event.data.ticket,
            origin: event.origin,
          }),
        });
        const result = (await response.json()) as {
          token?: string;
          expiresAt?: string;
          user?: { displayName?: string };
        };
        if (!response.ok || !result.token || !result.expiresAt)
          throw new Error("exchange failed");
        token.current = result.token;
        trustedHostOrigin.current = event.origin;
        setState({
          status: "authenticated",
          displayName: result.user?.displayName || "嵌入用户",
          expiresAt: result.expiresAt,
        });
        window.parent.postMessage(
          {
            type: "baigong-agent.session",
            status: "authenticated",
            expiresAt: result.expiresAt,
          },
          event.origin,
        );
      } catch {
        token.current = null;
        setState({ status: "failed" });
        window.parent.postMessage(
          { type: "baigong-agent.session", status: "failed" },
          event.origin,
        );
      }
    }

    function revoke() {
      if (!token.current) return;
      void fetch("/api/embed/revoke", {
        method: "POST",
        headers: { authorization: `Bearer ${token.current}` },
        keepalive: true,
      });
      token.current = null;
    }

    window.addEventListener("message", receiveTicket);
    window.addEventListener("pagehide", revoke);
    if (trustedHostOrigin.current) {
      window.parent.postMessage(
        { type: "baigong-agent.ready" },
        trustedHostOrigin.current,
      );
    }
    return () => {
      window.removeEventListener("message", receiveTicket);
      window.removeEventListener("pagehide", revoke);
    };
  }, []);

  if (state.status === "authenticated") {
    return (
      <section className={styles.state}>
        <ShieldCheck
          aria-hidden="true"
          className={styles.successIcon}
          size={28}
        />
        <div>
          <strong>{state.displayName}</strong>
          <span>身份已验证</span>
        </div>
      </section>
    );
  }
  if (state.status === "failed") {
    return (
      <section className={styles.state}>
        <ShieldX aria-hidden="true" className={styles.failureIcon} size={28} />
        <div>
          <strong>无法建立会话</strong>
          <span>等待宿主重新授权</span>
        </div>
      </section>
    );
  }
  return (
    <section className={styles.state}>
      <LoaderCircle aria-hidden="true" className={styles.spinner} size={26} />
      <div>
        <strong>
          {state.status === "exchanging" ? "正在验证" : "等待授权"}
        </strong>
        <span>嵌入会话</span>
      </div>
    </section>
  );
}

function isTicketMessage(
  value: unknown,
): value is { type: "baigong-agent.ticket"; ticket: string } {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return (
    message.type === "baigong-agent.ticket" &&
    typeof message.ticket === "string"
  );
}
