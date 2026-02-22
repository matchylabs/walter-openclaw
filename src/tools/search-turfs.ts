/**
 * walter_search_turfs — Search and filter connected infrastructure.
 */

import type { WalterClient } from "../client.js";
import type { ToolResult } from "../types.js";
import { toolSuccess, toolError, toUserMessage } from "../types.js";

export function createSearchTurfsTool(client: WalterClient) {
  return {
    name: "walter_search_turfs",
    label: "Walter Search Turfs",
    description:
      "Filter connected systems by name, type, OS, or status. Useful when you have " +
      "many systems and need to narrow down. Requires at least one filter — use " +
      "walter_list_turfs to see everything.",
    parameters: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Partial name match (case-insensitive)",
        },
        type: {
          type: "string",
          enum: ["server", "aws", "gcp"],
          description: "System type",
        },
        os: {
          type: "string",
          description: "Operating system: linux, darwin, windows",
        },
        status: {
          type: "string",
          enum: ["online", "offline"],
          description: "Connection status",
        },
      },
      required: [] as string[],
      additionalProperties: false,
    },

    async execute(
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<ToolResult> {
      const filters = params as {
        name?: string;
        type?: string;
        os?: string;
        status?: string;
      };

      const hasFilter =
        filters.name !== undefined ||
        filters.type !== undefined ||
        filters.os !== undefined ||
        filters.status !== undefined;

      if (!hasFilter) {
        return toolError(
          "Provide at least one filter (name, type, os, or status). Use walter_list_turfs to see all systems.",
        );
      }

      try {
        const { turfs, count } = await client.searchTurfs(filters, signal);

        if (count === 0) {
          return toolSuccess("No systems matched your search.", { turfs: [], count: 0 });
        }

        const lines = turfs.map((turf) => {
          const status = turf.status === "online" ? "[online]" : "[offline]";
          const os = turf.os ? ` (${turf.os})` : "";
          return `${status} ${turf.name || turf.hostname || turf.turf_id}${os} — ${turf.type}`;
        });

        return toolSuccess(
          `${count} matching system(s):\n\n${lines.join("\n")}`,
          { turfs, count },
        );
      } catch (error) {
        return toolError(toUserMessage(error));
      }
    },
  };
}
