/**
 * Plugin configuration types and validation.
 */

const DEFAULT_URL = "https://walterops.com";

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

  const url =
    typeof config.url === "string" && config.url.trim()
      ? config.url.trim().replace(/\/+$/, "")
      : DEFAULT_URL;

  return {
    url,
    token: config.token.trim(),
  };
}
