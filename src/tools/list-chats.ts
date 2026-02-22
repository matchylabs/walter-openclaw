/**
 * walter_list_chats — List existing conversations with Walter.
 */

import type { WalterClient } from "../client.js";

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
    },

    async execute(_toolCallId: string, _params: unknown) {
      try {
        const chats = await client.listChats();

        if (chats.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No existing conversations. Use walter_chat to start one.",
              },
            ],
            details: { chats: [], count: 0 },
          };
        }

        const lines = chats.map((chat) => {
          const title = chat.name || chat.first_message || "(untitled)";
          const date = chat.last_activity_at || "";
          const dateStr = date ? ` (${date})` : "";
          const statusStr = chat.status === "active" ? " 🟢" : "";
          return `- ${chat.id}: ${title}${dateStr}${statusStr}`;
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `${chats.length} conversation(s):\n\n${lines.join("\n")}`,
            },
          ],
          details: { chats, count: chats.length },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          details: { error: msg },
        };
      }
    },
  };
}
