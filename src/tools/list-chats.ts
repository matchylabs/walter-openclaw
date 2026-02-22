/**
 * walter_list_chats — List existing conversations with Walter.
 */

import type { WalterClient } from "../client.js";
import type { ToolResult } from "../types.js";
import { toolSuccess, toolError } from "../types.js";

export function createListChatsTool(client: WalterClient) {
  return {
    name: "walter_list_chats",
    label: "Walter List Chats",
    description:
      "List your existing conversations with Walter. Use this to find a previous " +
      "conversation to continue rather than starting a new one. Returns chat IDs, " +
      "titles, and timestamps.",
    parameters: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
      additionalProperties: false,
    },

    async execute(
      _toolCallId: string,
      _params: unknown,
      signal?: AbortSignal,
    ): Promise<ToolResult> {
      try {
        const chats = await client.listChats(signal);

        if (chats.length === 0) {
          return toolSuccess(
            "No existing conversations. Use walter_chat to start one.",
            { chats: [], count: 0 },
          );
        }

        const lines = chats.map((chat) => {
          const title = chat.name || chat.first_message || "(untitled)";
          const date = chat.last_activity_at || "";
          const dateStr = date ? ` (${date})` : "";
          const statusIndicator = chat.status === "active" ? " [active]" : "";
          return `- ${chat.id}: ${title}${dateStr}${statusIndicator}`;
        });

        return toolSuccess(
          `${chats.length} conversation(s):\n\n${lines.join("\n")}`,
          { chats, count: chats.length },
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return toolError(msg);
      }
    },
  };
}
