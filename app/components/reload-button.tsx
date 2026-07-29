"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function ReloadButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      aria-label="重新检查系统状态"
      className="icon-button"
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
      title="重新检查系统状态"
      type="button"
    >
      <RefreshCw aria-hidden="true" className={isPending ? "spin" : undefined} size={17} />
    </button>
  );
}
