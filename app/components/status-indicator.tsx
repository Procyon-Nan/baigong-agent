import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import type { ReadinessState } from "@/src/server/readiness";
import styles from "./status-indicator.module.css";

const statusPresentation = {
  ready: { label: "就绪", icon: CheckCircle2, className: styles.ready },
  missing: { label: "待配置", icon: CircleDashed, className: styles.missing },
  unavailable: { label: "不可用", icon: AlertTriangle, className: styles.unavailable },
} as const;

export function StatusIndicator({ state }: { readonly state: ReadinessState }) {
  const presentation = statusPresentation[state];
  const Icon = presentation.icon;

  return (
    <span className={`${styles.status} ${presentation.className}`}>
      <Icon aria-hidden="true" size={15} />
      {presentation.label}
    </span>
  );
}
