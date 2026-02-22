/**
 * walter_cancel — Interrupt Walter if he's going down the wrong path.
 */

import type { WalterClient } from "../client.js";
import type { ToolResult } from "../types.js";
import { toolSuccess, toolError } from "../types.js";

export function createCancelTool(client: WalterClient) {
  return {
    name: "walter_cancel",
    label: "Walter Cancel",
    description:
      "Interrupt Walter if he's taking too long or going in the wrong direction. " +
      "The conversation stays open — send a new message with better direction afterward.",
    parameters: {
      type: "object" as const,
      properties: {
        chat_id: {
          type: "string",
          description: "Chat session ID (e.g. chat_k7xm9pq3)",
        },
      },
      required: ["chat_id"],
      additionalProperties: false,
    },

    async execute(
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<ToolResult> {
      const { chat_id } = params as { chat_id: string };

      if (!chat_id?.trim()) {
        return toolError("chat_id is required");
      }

      try {
        const result = await client.cancelProcessing(chat_id, signal);
        const text =
          result.status === "cancelled"
            ? `Cancelled active operation in ${chat_id}. You can send a new message to redirect Walter.`
            : `Nothing was running in ${chat_id}.`;

        return toolSuccess(text, { chat_id, ...result });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return toolError(msg);
      }
    },
  };
}
