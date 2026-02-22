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
    },

    async execute(
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
      onUpdate?: (result: unknown) => void,
    ) {
      const { message, chat_id: chatIdInput } = params as {
        message: string;
        chat_id?: string;
      };

      if (!message?.trim()) {
        return {
          content: [{ type: "text" as const, text: "Error: message is required" }],
          details: { error: "message is required" },
        };
      }

      try {
        // Auto-create chat if none specified
        const chatId = chatIdInput?.trim() || (await client.createChat());

        const { response, chat_id: resolvedChatId } = await client.chatStreaming(
          chatId,
          message,
          (partial) => {
            // Stream partial results back to OpenClaw via onUpdate
            onUpdate?.({
              content: [{ type: "text", text: partial }],
              details: { status: "processing", chat_id: resolvedChatId },
            });
          },
          signal,
        );

        return {
          content: [{ type: "text" as const, text: response }],
          details: { chat_id: resolvedChatId, status: "complete" },
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${errMsg}` }],
          details: { error: errMsg },
        };
      }
    },
  };
}
