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
 * Convert an error into a user-friendly message.
 * Walter RPC errors and HTTP errors are already user-facing.
 * Internal validation errors (from assertObject/assertString/etc.) are
 * implementation details — wrap them so the agent sees a clean message.
 */
export function toUserMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  // Errors from rpc() / notify() are already user-facing
  if (
    error.message.startsWith("Walter ") ||
    error.message.startsWith("Request was cancelled") ||
    error.message.startsWith("Aborted")
  ) {
    return error.message;
  }

  // Internal validation errors leak implementation details — wrap them
  return "Walter returned an unexpected response. Please try again.";
}
