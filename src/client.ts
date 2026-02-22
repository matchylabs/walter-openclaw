/**
 * WalterClient — speaks JSON-RPC to the Walter MCP endpoint.
 *
 * Reuses the existing /mcp endpoint so no new Walter-side code is needed.
 * The client handles the JSON-RPC protocol and exposes clean async methods.
 */

// ─── Types ──────────────────────────────────────────────────────

export type Chat = {
  id: string;
  name: string | null;
  first_message: string | null;
  last_message: string | null;
  last_activity_at: string | null;
  status: string;
};

export type Turf = {
  turf_id: string;
  name: string;
  type: string;
  status: string;
  os?: string;
  hostname?: string;
  arch?: string;
  version?: string;
};

export type ResponseStatus =
  | { status: "processing"; partial?: string; retry_after_seconds: number }
  | { status: "complete"; response: string }
  | { status: "error"; error: string };

type HttpError = Error & { httpStatus?: number };

type McpToolResult = {
  content: Array<{ type: string; text: string }>;
  isError: boolean;
};

// ─── Constants ──────────────────────────────────────────────────

const PROTOCOL_VERSION = "2025-11-25";
const CLIENT_NAME = "openclaw-walter-plugin";
const CLIENT_VERSION = "0.1.0";

/** Default timeout for individual HTTP requests (30 seconds). */
const DEFAULT_RPC_TIMEOUT_MS = 30_000;

// ─── Validation helpers ─────────────────────────────────────────

function assertObject(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context}: expected object, got ${typeof value}`);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, field: string, context: string): string {
  if (typeof value !== "string") {
    throw new Error(`${context}: expected string for '${field}', got ${typeof value}`);
  }
  return value;
}

function assertArray<T>(
  value: unknown,
  field: string,
  context: string,
  itemValidator?: (item: unknown, index: number) => T,
): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context}: expected array for '${field}', got ${typeof value}`);
  }
  if (itemValidator) {
    return value.map((item, i) => itemValidator(item, i));
  }
  return value as T[];
}

function assertNumber(value: unknown, field: string, context: string): number {
  if (typeof value !== "number") {
    throw new Error(`${context}: expected number for '${field}', got ${typeof value}`);
  }
  return value;
}

function validateChat(raw: unknown): Chat {
  const obj = assertObject(raw, "Chat");
  return {
    id: assertString(obj.id, "id", "Chat"),
    name: typeof obj.name === "string" ? obj.name : null,
    first_message: typeof obj.first_message === "string" ? obj.first_message : null,
    last_message: typeof obj.last_message === "string" ? obj.last_message : null,
    last_activity_at: typeof obj.last_activity_at === "string" ? obj.last_activity_at : null,
    status: assertString(obj.status, "status", "Chat"),
  };
}

function validateTurf(raw: unknown): Turf {
  const obj = assertObject(raw, "Turf");
  return {
    turf_id: assertString(obj.turf_id, "turf_id", "Turf"),
    name: assertString(obj.name, "name", "Turf"),
    type: assertString(obj.type, "type", "Turf"),
    status: assertString(obj.status, "status", "Turf"),
    os: typeof obj.os === "string" ? obj.os : undefined,
    hostname: typeof obj.hostname === "string" ? obj.hostname : undefined,
    arch: typeof obj.arch === "string" ? obj.arch : undefined,
    version: typeof obj.version === "string" ? obj.version : undefined,
  };
}

function validateResponseStatus(raw: unknown): ResponseStatus {
  const obj = assertObject(raw, "ResponseStatus");
  const status = assertString(obj.status, "status", "ResponseStatus");

  switch (status) {
    case "processing":
      return {
        status: "processing",
        partial: typeof obj.partial === "string" ? obj.partial : undefined,
        retry_after_seconds:
          typeof obj.retry_after_seconds === "number" ? obj.retry_after_seconds : 4,
      };
    case "complete":
      return {
        status: "complete",
        response: assertString(obj.response, "response", "ResponseStatus"),
      };
    case "error":
      return {
        status: "error",
        error: assertString(obj.error, "error", "ResponseStatus"),
      };
    default:
      throw new Error(`ResponseStatus: unknown status '${status}'`);
  }
}

// ─── Client ─────────────────────────────────────────────────────

export class WalterClient {
  private url: string;
  private token: string;
  private sessionId: string | null = null;
  private requestId = 0;
  private initPromise: Promise<void> | null = null;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  /**
   * Send a JSON-RPC request to the Walter MCP endpoint.
   *
   * @param method   JSON-RPC method name
   * @param params   Method parameters
   * @param signal   Optional abort signal for cancellation + timeout
   */
  private async rpc(
    method: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    const id = ++this.requestId;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
    };

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    // Create a timeout abort if no external signal, or combine with external signal
    const fetchSignal = signal ?? AbortSignal.timeout(DEFAULT_RPC_TIMEOUT_MS);

    const response = await fetch(`${this.url}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
      signal: fetchSignal,
    });

    // Capture session ID from response headers
    const newSessionId = response.headers.get("mcp-session-id");
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    if (!response.ok) {
      const error: HttpError = new Error(
        `Walter API error: ${response.status} ${response.statusText}`,
      );
      error.httpStatus = response.status;
      throw error;
    }

    const body = (await response.json()) as {
      result?: unknown;
      error?: { message: string; code?: number };
    };

    if (body.error) {
      throw new Error(`Walter RPC error: ${body.error.message}`);
    }

    return body.result;
  }

  /**
   * Send a JSON-RPC notification (no id, no response expected).
   */
  private async notify(
    method: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
    };

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const fetchSignal = signal ?? AbortSignal.timeout(DEFAULT_RPC_TIMEOUT_MS);

    const response = await fetch(`${this.url}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        ...(Object.keys(params).length > 0 ? { params } : {}),
      }),
      signal: fetchSignal,
    });

    if (!response.ok) {
      throw new Error(
        `Walter notification '${method}' failed: ${response.status} ${response.statusText}`,
      );
    }
  }

  /**
   * Reset session state so the next call re-initializes.
   */
  private resetSession(): void {
    this.initPromise = null;
    this.sessionId = null;
  }

  /**
   * Check if an error looks like a session/auth failure that a retry might fix.
   */
  private isSessionError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const status = (error as HttpError).httpStatus;
    return status === 401 || status === 403 || status === 404;
  }

  /**
   * Ensure the MCP session is initialized.
   * Uses a shared promise to prevent concurrent initialization races.
   */
  private ensureInitialized(signal?: AbortSignal): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize(signal).catch((err) => {
        // Reset so next call retries initialization
        this.initPromise = null;
        throw err;
      });
    }
    return this.initPromise;
  }

  private async doInitialize(signal?: AbortSignal): Promise<void> {
    await this.rpc(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
      },
      signal,
    );

    await this.notify("notifications/initialized", {}, signal);
  }

  /**
   * Call an MCP tool by name with arguments.
   * Retries once on session errors by re-initializing.
   */
  private async callTool(
    name: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<McpToolResult> {
    await this.ensureInitialized(signal);

    try {
      return await this.callToolInner(name, args, signal);
    } catch (error) {
      if (this.isSessionError(error)) {
        this.resetSession();
        await this.ensureInitialized(signal);
        return this.callToolInner(name, args, signal);
      }
      throw error;
    }
  }

  private async callToolInner(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpToolResult> {
    const raw = await this.rpc("tools/call", { name, arguments: args }, signal);
    const result = assertObject(raw, `tools/call(${name})`);

    const content = assertArray(
      result.content,
      "content",
      `tools/call(${name})`,
      (item) => {
        const c = assertObject(item, `tools/call(${name}).content[]`);
        return {
          type: assertString(c.type, "type", `tools/call(${name}).content[]`),
          text: assertString(c.text, "text", `tools/call(${name}).content[]`),
        };
      },
    );

    const isError = result.isError === true;

    if (isError) {
      const errorText = content[0]?.text ?? "Unknown error";
      throw new Error(errorText);
    }

    return { content, isError };
  }

  /**
   * Extract text content from an MCP tool result.
   */
  private extractText(result: McpToolResult): string {
    return result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }

  /**
   * Extract and parse JSON from an MCP tool result.
   * Throws if the content is not valid JSON.
   */
  private parseJson(result: McpToolResult): unknown {
    const text = this.extractText(result);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        `Expected JSON from Walter, got: ${text.length > 200 ? text.slice(0, 200) + "…" : text}`,
      );
    }
  }

  // ─── Public API ───────────────────────────────────────────────

  /**
   * Create a new chat session. Returns the chat_id.
   */
  async createChat(signal?: AbortSignal): Promise<string> {
    const result = await this.callTool("start_chat", {}, signal);
    const data = assertObject(this.parseJson(result), "createChat");
    return assertString(data.chat_id, "chat_id", "createChat");
  }

  /**
   * List the user's chat sessions.
   */
  async listChats(signal?: AbortSignal): Promise<Chat[]> {
    const result = await this.callTool("list_chats", {}, signal);
    const data = assertObject(this.parseJson(result), "listChats");
    return assertArray(data.chats, "chats", "listChats", validateChat);
  }

  /**
   * Send a message to a chat. Returns the request_id for polling.
   */
  async sendMessage(
    chatId: string,
    message: string,
    signal?: AbortSignal,
  ): Promise<{ request_id: string; chat_id: string }> {
    const result = await this.callTool("send_message", { chat_id: chatId, message }, signal);
    const data = assertObject(this.parseJson(result), "sendMessage");
    return {
      request_id: assertString(data.request_id, "request_id", "sendMessage"),
      chat_id: assertString(data.chat_id, "chat_id", "sendMessage"),
    };
  }

  /**
   * Poll for a response to a previously sent message.
   */
  async getResponse(requestId: string, signal?: AbortSignal): Promise<ResponseStatus> {
    const result = await this.callTool("get_response", { request_id: requestId }, signal);
    return validateResponseStatus(this.parseJson(result));
  }

  /**
   * Cancel active processing in a chat.
   */
  async cancelProcessing(
    chatId: string,
    signal?: AbortSignal,
  ): Promise<{ status: string; message?: string }> {
    const result = await this.callTool("cancel", { chat_id: chatId }, signal);
    const data = assertObject(this.parseJson(result), "cancelProcessing");
    return {
      status: assertString(data.status, "status", "cancelProcessing"),
      message: typeof data.message === "string" ? data.message : undefined,
    };
  }

  /**
   * List all connected turfs.
   */
  async listTurfs(signal?: AbortSignal): Promise<Turf[]> {
    const result = await this.callTool("list_turfs", {}, signal);
    const data = assertObject(this.parseJson(result), "listTurfs");
    return assertArray(data.turfs, "turfs", "listTurfs", validateTurf);
  }

  /**
   * Search turfs by name, type, OS, or status.
   */
  async searchTurfs(
    filters: {
      name?: string;
      type?: string;
      os?: string;
      status?: string;
    },
    signal?: AbortSignal,
  ): Promise<{ turfs: Turf[]; count: number }> {
    const args: Record<string, unknown> = {};
    if (filters.name !== undefined) args.name = filters.name;
    if (filters.type !== undefined) args.type = filters.type;
    if (filters.os !== undefined) args.os = filters.os;
    if (filters.status !== undefined) args.status = filters.status;

    const result = await this.callTool("search_turfs", args, signal);
    const data = assertObject(this.parseJson(result), "searchTurfs");
    return {
      turfs: assertArray(data.turfs, "turfs", "searchTurfs", validateTurf),
      count: assertNumber(data.count, "count", "searchTurfs"),
    };
  }

  /**
   * Send a message and wait for the complete response, with streaming partial updates.
   *
   * This is the star method — it merges send_message + get_response into a single
   * blocking call that streams partial results via the onPartial callback.
   * Tolerates up to 3 consecutive transient poll errors before giving up.
   */
  async chatStreaming(
    chatId: string,
    message: string,
    onPartial?: (partial: string) => void,
    signal?: AbortSignal,
  ): Promise<{ response: string; chat_id: string }> {
    const { request_id, chat_id } = await this.sendMessage(chatId, message, signal);

    // Safety timeout — don't poll forever (5 minutes)
    const maxPollMs = 5 * 60 * 1000;
    const pollDeadline = Date.now() + maxPollMs;

    // Initial delay — Walter needs a moment to start working
    await delay(2000, signal);

    let lastPartial = "";
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    // Poll loop
    while (!signal?.aborted && Date.now() < pollDeadline) {
      let status: ResponseStatus;

      try {
        status = await this.getResponse(request_id, signal);
        consecutiveErrors = 0;
      } catch (error) {
        consecutiveErrors++;
        if (consecutiveErrors >= maxConsecutiveErrors) throw error;
        await delay(2000, signal);
        continue;
      }

      switch (status.status) {
        case "processing":
          // Stream partial results if they've changed
          if (status.partial && status.partial !== lastPartial) {
            lastPartial = status.partial;
            onPartial?.(status.partial);
          }
          await delay((status.retry_after_seconds ?? 4) * 1000, signal);
          break;

        case "complete":
          return { response: status.response, chat_id };

        case "error":
          throw new Error(`Walter error: ${status.error}`);
      }
    }

    throw new Error(
      signal?.aborted ? "Request was cancelled" : "Walter response timed out after 5 minutes",
    );
  }
}

// ─── Utilities ──────────────────────────────────────────────────

/**
 * Delay that properly cleans up its abort listener when the timer fires.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
