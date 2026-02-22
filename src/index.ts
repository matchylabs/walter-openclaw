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
import type { ClientLogger } from "./client.js";
import { CONFIG_SCHEMA, PLUGIN_VERSION, validateConfig } from "./config.js";
import { createCancelTool } from "./tools/cancel.js";
import { createChatTool } from "./tools/chat.js";
import { createListChatsTool } from "./tools/list-chats.js";
import { createListTurfsTool } from "./tools/list-turfs.js";
import { createSearchTurfsTool } from "./tools/search-turfs.js";
import type { ToolResult } from "./types.js";

type PluginLogger = ClientLogger;

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

type ToolOptions = {
  optional?: boolean;
};

type OpenClawPluginApi = {
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  registerTool: (tool: PluginTool, options?: ToolOptions) => void;
};

const plugin = {
  id: "walter",
  name: "Walter",
  description:
    "AI-powered infrastructure management. Talk to a curious raccoon who explores " +
    "your servers, runs commands, reads logs, and figures things out.",
  configSchema: CONFIG_SCHEMA,

  register(api: OpenClawPluginApi) {
    let config;
    try {
      config = validateConfig(api.pluginConfig);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      api.logger.error(`Walter plugin disabled: ${msg}`);
      return;
    }

    const client = new WalterClient(config.url, config.token, PLUGIN_VERSION, api.logger);

    // Tools are optional because they require a valid API token to function.
    const opts: ToolOptions = { optional: true };

    api.registerTool(createChatTool(client), opts);
    api.registerTool(createCancelTool(client), opts);
    api.registerTool(createListChatsTool(client), opts);
    api.registerTool(createListTurfsTool(client), opts);
    api.registerTool(createSearchTurfsTool(client), opts);

    api.logger.info(
      `Walter plugin loaded — connected to ${config.url} (5 tools registered)`,
    );
  },
};

export default plugin;
