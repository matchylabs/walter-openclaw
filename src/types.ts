export type ToolContent = { type: "text"; text: string };

export type ToolResult = {
  content: ToolContent[];
  isError?: boolean;
  details: Record<string, unknown>;
};

export function toolSuccess(text: string, details: Record<string, unknown> = {}): ToolResult {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

export function toolError(message: string, details: Record<string, unknown> = {}): ToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
    details: { error: message, ...details },
  };
}

/**
 * Internal validation error patterns that leak implementation details.
 * These come from assertObject/assertString/assertArray/assertNumber
 * and should not be shown to the agent.
 */
const INTERNAL_PATTERNS = [
  /: expected (object|string|array|number) for '/,
  /: expected object, got /,
  /: unknown status '/,
];

/**
 * Convert an error into a user-friendly message.
 *
 * Strategy: block known-bad patterns (internal validation messages).
 * Everything else passes through — network errors, HTTP errors, timeouts,
 * and Walter RPC errors are all useful diagnostics for the agent.
 */
export function toUserMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const msg = error.message;

  // Internal validation errors leak implementation details — wrap them
  for (const pattern of INTERNAL_PATTERNS) {
    if (pattern.test(msg)) {
      return "Walter returned an unexpected response. Please try again.";
    }
  }

  // Everything else is user-facing (network, HTTP, RPC, timeouts, cancellation)
  return msg;
}
