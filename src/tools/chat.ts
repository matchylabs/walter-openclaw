/**
 * walter_chat — The star tool.
 *
 * Sends a message to Walter and blocks until the response is complete,
 * streaming partial results via onUpdate as Walter works. No polling
 * needed from the agent — just one tool call and wait.
 *
 * If no chat_id is provided, automatically creates a new chat.
 */

import type { WalterClient } from "../client.js";
import type { ToolResult } from "../types.js";
import { toolSuccess, toolError, toUserMessage } from "../types.js";

export function createChatTool(client: WalterClient) {
  return {
    name: "walter_chat",
    label: "Walter Chat",
    description:
      "Talk to Walter — a curious raccoon who's an expert at managing infrastructure. " +
      "Describe what you need in plain language (check disk usage, investigate slow API, " +
      "review nginx config, etc.) and Walter will explore your connected systems to figure " +
      "it out. He typically takes 10-60 seconds because he's running real commands on live " +
      "systems.\n\n" +
      "Omit chat_id to start a fresh conversation. Include it to continue an existing one " +
      "(use walter_list_chats to find previous conversations).",
    parameters: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "What you want Walter to investigate or do",
        },
        chat_id: {
          type: "string",
          description:
            "Chat session ID to continue (e.g. chat_k7xm9pq3). " +
            "Omit to start a new conversation.",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },

    async execute(
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
      onUpdate?: (result: unknown) => void,
    ): Promise<ToolResult> {
      const { message, chat_id: chatIdInput } = params as {
        message: string;
        chat_id?: string;
      };

      if (!message?.trim()) {
        return toolError("message is required");
      }

      try {
        // Auto-create chat if none specified
        const chatId = chatIdInput?.trim() || (await client.createChat(signal));

        // Track the server-resolved chat_id. Updated by sendMessage inside
        // chatStreaming, but we only learn the final value after it returns.
        // During streaming, partials use the input chatId which is correct
        // for user-initiated chats and best-effort for auto-created ones.
        let streamingChatId = chatId;

        const { response, chat_id: finalChatId } = await client.chatStreaming(
          chatId,
          message,
          (partial) => {
            onUpdate?.({
              content: [{ type: "text", text: partial }],
              details: { status: "processing", chat_id: streamingChatId },
            });
          },
          signal,
        );

        streamingChatId = finalChatId;

        return toolSuccess(response, { chat_id: finalChatId, status: "complete" });
      } catch (error) {
        return toolError(toUserMessage(error));
      }
    },
  };
}
