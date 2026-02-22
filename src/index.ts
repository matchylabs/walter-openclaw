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
 * Install: openclaw plugins install walter-openclaw
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
import type { ToolResult } from "./types.js";

type PluginLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};

type PluginTool = {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: (result: unknown) => void,
  ) => Promise<ToolResult>;
};

type OpenClawPluginApi = {
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  registerTool: (tool: PluginTool) => void;
};

const plugin = {
  id: "walter",
  name: "Walter",
  description:
    "AI-powered infrastructure management. Talk to a curious raccoon who explores " +
    "your servers, runs commands, reads logs, and figures things out.",

  register(api: OpenClawPluginApi) {
    const config = validateConfig(api.pluginConfig);
    const client = new WalterClient(config.url, config.token);

    api.registerTool(createChatTool(client));
    api.registerTool(createCancelTool(client));
    api.registerTool(createListChatsTool(client));
    api.registerTool(createListTurfsTool(client));
    api.registerTool(createSearchTurfsTool(client));

    api.logger.info(
      `Walter plugin loaded — connected to ${config.url} (5 tools registered)`,
    );
  },
};

export default plugin;
