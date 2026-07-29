import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import type { ReadinessState } from "@/src/server/readiness";

const statusPresentation = {
  ready: { label: "就绪", icon: CheckCircle2 },
  missing: { label: "待配置", icon: CircleDashed },
  unavailable: { label: "不可用", icon: AlertTriangle },
} as const;

export function StatusIndicator({ state }: { readonly state: ReadinessState }) {
  const presentation = statusPresentation[state];
  const Icon = presentation.icon;

  return (
    <span className={`status status-${state}`}>
      <Icon aria-hidden="true" size={15} />
      {presentation.label}
    </span>
  );
}
