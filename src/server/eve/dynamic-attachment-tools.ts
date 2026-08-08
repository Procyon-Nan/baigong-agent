import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import {
  listToolReadableAttachments,
  readToolAttachment,
  type AttachmentToolAuthority,
} from "@/src/server/attachments/tool-access";

export function createConversationAttachmentTools(
  authority: AttachmentToolAuthority,
) {
  return {
    list: defineTool({
      description:
        "列出当前根会话中用户已经发送且允许读取的图片和 PDF 附件。",
      inputSchema: z.object({}),
      async execute() {
        return { attachments: await listToolReadableAttachments(authority) };
      },
    }),
    read: defineTool({
      description:
        "读取当前根会话中的一个已授权附件，并把附件内容提供给模型。附件 ID 必须来自 list_conversation_attachments。",
      inputSchema: z.object({ attachmentId: z.uuid() }),
      async execute({ attachmentId }, context) {
        return readToolAttachment(
          authority,
          attachmentId,
          context.abortSignal,
        );
      },
      toModelOutput(output) {
        return toolOutput.content([
          toolOutputPart.text(
            `会话附件 ${output.displayName}（${output.mediaType}，${output.sizeBytes} 字节）：`,
          ),
          toolOutputPart.file(output.base64, { mediaType: output.mediaType }),
        ]);
      },
    }),
  };
}
