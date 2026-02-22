/**
 * walter_search_turfs — Search and filter connected infrastructure.
 */

import type { WalterClient } from "../client.js";

export function createSearchTurfsTool(client: WalterClient) {
  return {
    name: "walter_search_turfs",
    label: "Walter Search Turfs",
    description:
      "Find specific systems by name, type, OS, or status. Useful when you have " +
      "many connected systems and want to narrow down before asking Walter to " +
      "investigate something.",
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
    },

    async execute(_toolCallId: string, params: unknown) {
      const filters = params as {
        name?: string;
        type?: string;
        os?: string;
        status?: string;
      };

      // At least one filter should be provided
      if (!filters.name && !filters.type && !filters.os && !filters.status) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Provide at least one filter (name, type, os, or status). Use walter_list_turfs to see all systems.",
            },
          ],
          details: { error: "no filters provided" },
        };
      }

      try {
        const { turfs, count } = await client.searchTurfs(filters);

        if (count === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No systems matched your search.",
              },
            ],
            details: { turfs: [], count: 0 },
          };
        }

        const lines = turfs.map((turf) => {
          const status = turf.status === "online" ? "🟢" : "⚫";
          const os = turf.os ? ` (${turf.os})` : "";
          return `${status} ${turf.name || turf.hostname || turf.turf_id}${os} — ${turf.type}`;
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `${count} matching system(s):\n\n${lines.join("\n")}`,
            },
          ],
          details: { turfs, count },
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
