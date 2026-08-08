"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatAttachment } from "./message-state";

const MAX_FILE_BYTES = 20 * 1_024 * 1_024;
const MAX_MESSAGE_BYTES = 50 * 1_024 * 1_024;
const MAX_FILES = 5;

export type AttachmentUpload = {
  readonly localId: string;
  readonly requestId: string;
  readonly file: File;
  readonly progress: number;
  readonly status: "UPLOADING" | "UPLOADED" | "FAILED";
  readonly attachment?: ChatAttachment;
  readonly error?: string;
};

export function useAttachmentUploads(options: {
  readonly authorizationToken?: string;
  readonly supportsImageInput: boolean;
  readonly supportsNativePdfInput: boolean;
  readonly onAuthenticationExpired: () => void;
}) {
  const [uploads, setUploads] = useState<readonly AttachmentUpload[]>([]);
  const requests = useRef(new Map<string, XMLHttpRequest>());

  const startUpload = useCallback(
    (upload: AttachmentUpload) => {
      const request = new XMLHttpRequest();
      requests.current.set(upload.localId, request);
      request.open("POST", "/api/attachments");
      if (options.authorizationToken) {
        request.setRequestHeader(
          "authorization",
          `Bearer ${options.authorizationToken}`,
        );
      }
      request.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        updateUpload(setUploads, upload.localId, {
          progress: Math.min(100, Math.round((event.loaded / event.total) * 100)),
        });
      });
      request.addEventListener("load", () => {
        requests.current.delete(upload.localId);
        if (request.status === 401 || request.status === 403) {
          options.onAuthenticationExpired();
          return;
        }
        const attachment = parseUploadResponse(request.responseText);
        if (request.status < 200 || request.status >= 300 || !attachment) {
          updateUpload(setUploads, upload.localId, {
            status: "FAILED",
            error: parseUploadError(request.responseText),
          });
          return;
        }
        updateUpload(setUploads, upload.localId, {
          status: "UPLOADED",
          progress: 100,
          attachment,
          error: undefined,
        });
      });
      request.addEventListener("error", () => {
        requests.current.delete(upload.localId);
        updateUpload(setUploads, upload.localId, {
          status: "FAILED",
          error: "附件上传失败。",
        });
      });
      const form = new FormData();
      form.set("requestId", upload.requestId);
      form.set("file", upload.file);
      request.send(form);
    },
    [options.authorizationToken, options.onAuthenticationExpired],
  );

  useEffect(() => {
    for (const upload of uploads) {
      if (
        upload.status === "UPLOADING" &&
        !requests.current.has(upload.localId)
      ) {
        startUpload(upload);
      }
    }
  }, [startUpload, uploads]);

  const addFiles = useCallback(
    (files: FileList | readonly File[]) => {
      const selected = Array.from(files);
      setUploads((current) => {
        if (current.length + selected.length > MAX_FILES) {
          return appendValidationFailure(current, "每条消息最多包含 5 个附件。");
        }
        const totalBytes =
          current.reduce((total, upload) => total + upload.file.size, 0) +
          selected.reduce((total, file) => total + file.size, 0);
        if (totalBytes > MAX_MESSAGE_BYTES) {
          return appendValidationFailure(
            current,
            "每条消息的附件总大小不能超过 50 MiB。",
          );
        }
        const created = selected.map((file) => createUpload(file, options));
        return [...current.filter(({ localId }) => localId !== "validation"), ...created];
      });
    },
    [options, startUpload],
  );

  const retry = useCallback(
    (localId: string) => {
      setUploads((current) => {
        const upload = current.find((item) => item.localId === localId);
        if (!upload || upload.status !== "FAILED" || upload.localId === "validation") {
          return current;
        }
        const retrying = {
          ...upload,
          status: "UPLOADING" as const,
          progress: 0,
          error: undefined,
        };
        return current.map((item) => (item.localId === localId ? retrying : item));
      });
    },
    [startUpload],
  );

  const remove = useCallback(
    async (upload: AttachmentUpload) => {
      requests.current.get(upload.localId)?.abort();
      requests.current.delete(upload.localId);
      setUploads((current) =>
        current.filter(({ localId }) => localId !== upload.localId),
      );
      const attachmentId = upload.attachment?.id;
      if (!attachmentId) return;
      await fetch(`/api/attachments/${attachmentId}`, {
        method: "DELETE",
        headers: options.authorizationToken
          ? { authorization: `Bearer ${options.authorizationToken}` }
          : undefined,
      }).catch(() => undefined);
    },
    [options.authorizationToken],
  );

  const clearPending = useCallback(() => {
    for (const upload of uploads) void remove(upload);
  }, [remove, uploads]);

  const consumeUploaded = useCallback(() => {
    requests.current.clear();
    setUploads([]);
  }, []);

  return {
    addFiles,
    clearPending,
    consumeUploaded,
    remove,
    retry,
    uploads,
    uploaded: uploads.flatMap((upload) =>
      upload.status === "UPLOADED" && upload.attachment
        ? [upload.attachment]
        : [],
    ),
    ready: uploads.every((upload) => upload.status === "UPLOADED"),
  } as const;
}

function createUpload(
  file: File,
  capabilities: {
    readonly supportsImageInput: boolean;
    readonly supportsNativePdfInput: boolean;
  },
): AttachmentUpload {
  const localId = crypto.randomUUID();
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const expectedMediaType = new Map([
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".webp", "image/webp"],
    [".pdf", "application/pdf"],
  ]).get(extension);
  let error: string | undefined;
  if (!expectedMediaType || file.type !== expectedMediaType) {
    error = "仅支持 PNG、JPEG、WebP 和 PDF，且文件类型必须与扩展名一致。";
  } else if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    error = "单个附件必须大于 0 且不超过 20 MiB。";
  } else if (file.type.startsWith("image/") && !capabilities.supportsImageInput) {
    error = "当前模型不支持图片输入。";
  } else if (file.type === "application/pdf" && !capabilities.supportsNativePdfInput) {
    error = "当前模型不支持原生 PDF 输入。";
  }
  return {
    localId,
    requestId: crypto.randomUUID(),
    file,
    progress: 0,
    status: error ? "FAILED" : "UPLOADING",
    error,
  };
}

function appendValidationFailure(
  uploads: readonly AttachmentUpload[],
  error: string,
): readonly AttachmentUpload[] {
  const validation: AttachmentUpload = {
    localId: "validation",
    requestId: "validation",
    file: new File([], "附件"),
    progress: 0,
    status: "FAILED",
    error,
  };
  return [...uploads.filter(({ localId }) => localId !== "validation"), validation];
}

function updateUpload(
  setUploads: React.Dispatch<React.SetStateAction<readonly AttachmentUpload[]>>,
  localId: string,
  patch: Partial<AttachmentUpload>,
): void {
  setUploads((current) =>
    current.map((upload) =>
      upload.localId === localId ? { ...upload, ...patch } : upload,
    ),
  );
}

function parseUploadResponse(value: string): ChatAttachment | null {
  try {
    const parsed = JSON.parse(value) as { attachment?: Partial<ChatAttachment> };
    const attachment = parsed.attachment;
    return attachment &&
      typeof attachment.id === "string" &&
      typeof attachment.displayName === "string" &&
      typeof attachment.mediaType === "string" &&
      typeof attachment.sizeBytes === "number" &&
      typeof attachment.previewUrl === "string" &&
      typeof attachment.downloadUrl === "string"
      ? (attachment as ChatAttachment)
      : null;
  } catch {
    return null;
  }
}

function parseUploadError(value: string): string {
  try {
    const parsed = JSON.parse(value) as { error?: { message?: unknown } };
    return typeof parsed.error?.message === "string"
      ? parsed.error.message
      : "附件上传失败。";
  } catch {
    return "附件上传失败。";
  }
}
