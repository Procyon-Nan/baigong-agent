import "dotenv/config";

import { cleanupExpiredPendingAttachments } from "@/src/server/attachments/cleanup";
import { closeDatabase } from "@/src/server/db/client";

try {
  const result = await cleanupExpiredPendingAttachments();
  console.info(
    `附件清理完成：过期附件 ${result.deletedAttachments} 个，临时文件 ${result.removedTemporary} 个，回收区文件 ${result.reconciledTrash} 个。`,
  );
} finally {
  await closeDatabase();
}
