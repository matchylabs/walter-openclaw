import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_URL = "https://walterops.com";

function loadManifest(): { version: string; configSchema: Record<string, unknown> } {
  const dir = dirname(fileURLToPath(import.meta.url));
  const manifestPath = join(dir, "..", "openclaw.plugin.json");
  const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
  return { version: raw.version, configSchema: raw.configSchema };
}

const manifest = loadManifest();

export const PLUGIN_VERSION: string = manifest.version;
export const CONFIG_SCHEMA: Record<string, unknown> = manifest.configSchema;

export type WalterPluginConfig = {
  url: string;
  token: string;
};

export function validateConfig(raw: unknown): WalterPluginConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(
      "Walter plugin requires configuration. Add to openclaw.json:\n" +
        '  "plugins": { "entries": { "walter": { "config": { "token": "..." } } } }',
    );
  }

  const config = raw as Record<string, unknown>;

  if (typeof config.token !== "string" || !config.token.trim()) {
    throw new Error("Walter plugin config requires 'token' (your Walter API token)");
  }

  let url = DEFAULT_URL;
  if (typeof config.url === "string" && config.url.trim()) {
    const trimmed = config.url.trim().replace(/\/+$/, "");
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("must use http or https");
      }
      url = trimmed;
    } catch (e) {
      const detail = e instanceof Error ? e.message : "invalid format";
      throw new Error(`Walter plugin config 'url' is not a valid URL: ${detail}`);
    }
  }

  return {
    url,
    token: config.token.trim(),
  };
}
