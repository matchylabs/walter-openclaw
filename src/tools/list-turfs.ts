/**
 * walter_list_turfs — List connected infrastructure.
 */

import type { WalterClient } from "../client.js";
import type { ToolResult } from "../types.js";
import { toolSuccess, toolError, toUserMessage } from "../types.js";

export function createListTurfsTool(client: WalterClient) {
  return {
    name: "walter_list_turfs",
    label: "Walter List Turfs",
    description:
      "See all systems Walter has access to — servers, cloud accounts, databases — " +
      "and whether they're currently online. Use this for an overview of your " +
      "infrastructure. To filter by name, type, OS, or status, use walter_search_turfs instead.",
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
        const turfs = await client.listTurfs(signal);

        if (turfs.length === 0) {
          return toolSuccess(
            "No systems connected. Set up a turf in Walter first.",
            { turfs: [], count: 0 },
          );
        }

        const lines = turfs.map((turf) => {
          const status = turf.status === "online" ? "[online]" : "[offline]";
          const os = turf.os ? ` (${turf.os})` : "";
          return `${status} ${turf.name || turf.hostname || turf.turf_id}${os} — ${turf.type}`;
        });

        return toolSuccess(
          `${turfs.length} connected system(s):\n\n${lines.join("\n")}`,
          { turfs, count: turfs.length },
        );
      } catch (error) {
        return toolError(toUserMessage(error));
      }
    },
  };
}
