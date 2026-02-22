/**
 * Walter OpenClaw Plugin
 *
 * Connects OpenClaw to Walter for AI-powered infrastructure management.
 * Registers 5 tools that talk to Walter's existing MCP endpoint via JSON-RPC.
 *
 * The star tool is walter_chat — it sends a message, blocks until Walter
 * finishes (streaming partial results via onUpdate), and returns the
 * complete response. No polling needed from the agent.
 *
 * Install: openclaw plugin install walter-openclaw
 *
 * Configuration (in openclaw.json):
 *   "plugins": {
 *     "entries": {
 *       "walter": {
 *         "config": {
 *           "token": "your-api-token"
 *         }
 *       }
 *     }
 *   }
 */

import { WalterClient } from "./client.js";
import { validateConfig } from "./config.js";
import { createCancelTool } from "./tools/cancel.js";
import { createChatTool } from "./tools/chat.js";
import { createListChatsTool } from "./tools/list-chats.js";
import { createListTurfsTool } from "./tools/list-turfs.js";
import { createSearchTurfsTool } from "./tools/search-turfs.js";

// OpenClaw plugin types — we define the minimal shapes we need rather than
// importing from openclaw/plugin-sdk (which would add a heavyweight dependency).
type PluginLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};

type OpenClawPluginApi = {
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  registerTool: (tool: unknown, opts?: { name?: string; names?: string[] }) => void;
};

const plugin = {
  id: "walter",
  name: "Walter",
  description:
    "AI-powered infrastructure management. Talk to a curious raccoon who explores " +
    "your servers, runs commands, reads logs, and figures things out.",

  register(api: OpenClawPluginApi) {
    // Validate configuration
    const config = validateConfig(api.pluginConfig);

    // Create the client that speaks JSON-RPC to Walter's MCP endpoint
    const client = new WalterClient(config.url, config.token);

    // Register all 5 tools
    const chatTool = createChatTool(client);
    const cancelTool = createCancelTool(client);
    const listChatsTool = createListChatsTool(client);
    const listTurfsTool = createListTurfsTool(client);
    const searchTurfsTool = createSearchTurfsTool(client);

    api.registerTool(chatTool, { name: "walter_chat" });
    api.registerTool(cancelTool, { name: "walter_cancel" });
    api.registerTool(listChatsTool, { name: "walter_list_chats" });
    api.registerTool(listTurfsTool, { name: "walter_list_turfs" });
    api.registerTool(searchTurfsTool, { name: "walter_search_turfs" });

    api.logger.info(
      `Walter plugin loaded — connected to ${config.url} (5 tools registered)`,
    );
  },
};

export default plugin;
