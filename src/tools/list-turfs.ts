/**
 * walter_list_turfs — List connected infrastructure.
 */

import type { WalterClient } from "../client.js";

export function createListTurfsTool(client: WalterClient) {
  return {
    name: "walter_list_turfs",
    label: "Walter List Turfs",
    description:
      "See what systems Walter has access to. Lists all connected infrastructure " +
      "(servers, cloud accounts) and whether they're currently online. Useful for " +
      "orienting yourself before asking Walter to investigate something.",
    parameters: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },

    async execute(_toolCallId: string, _params: unknown) {
      try {
        const turfs = await client.listTurfs();

        if (turfs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No systems connected. Set up a turf in Walter first.",
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
              text: `${turfs.length} connected system(s):\n\n${lines.join("\n")}`,
            },
          ],
          details: { turfs, count: turfs.length },
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
