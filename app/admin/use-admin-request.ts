"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clientErrorMessage, requestJson } from "@/app/lib/api-client";

export function useAdminRequest() {
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");

  async function request<T>(
    path: string,
    init: RequestInit,
  ): Promise<T | null> {
    setPending(path);
    setError("");
    try {
      const result = await requestJson<T>(path, init);
      router.refresh();
      return result;
    } catch (reason) {
      setError(clientErrorMessage(reason));
      return null;
    } finally {
      setPending("");
    }
  }

  return { error, pending, request } as const;
}
