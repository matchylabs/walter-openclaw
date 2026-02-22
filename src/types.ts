
export type ToolContent = { type: "text"; text: string };

export type ToolResult = {
  content: ToolContent[];
  isError?: boolean;
  details?: Record<string, unknown>;
};

export function toolSuccess(text: string, details?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text }],
    ...(details ? { details } : {}),
  };
}

export function toolError(message: string, details?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
    details: { error: message, ...details },
  };
}
