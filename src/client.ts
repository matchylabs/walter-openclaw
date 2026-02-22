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

export type ClientLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

/** No-op logger for when no logger is provided. */
const SILENT_LOGGER: ClientLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ─── Constants ──────────────────────────────────────────────────

const PROTOCOL_VERSION = "2025-11-25";
const CLIENT_NAME = "openclaw-walter-plugin";

/** Timeout for individual HTTP requests (30 seconds). */
const RPC_TIMEOUT_MS = 30_000;

/** Default seconds between polls when server doesn't specify. */
const DEFAULT_RETRY_AFTER_SECONDS = 4;

/** Maximum JSON-RPC request ID before wrapping. */
const MAX_REQUEST_ID = 1_000_000;

// ─── Validation helpers ─────────────────────────────────────────

function assertObject(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    throw new Error(`${context}: expected object, got ${value === null ? "null" : typeof value}`);
  }
  if (Array.isArray(value)) {
    throw new Error(`${context}: expected object, got array`);
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
  itemValidator: (item: unknown, index: number) => T,
): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context}: expected array for '${field}', got ${typeof value}`);
  }
  return value.map((item, i) => itemValidator(item, i));
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
          typeof obj.retry_after_seconds === "number"
            ? obj.retry_after_seconds
            : DEFAULT_RETRY_AFTER_SECONDS,
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
  private readonly url: string;
  private readonly token: string;
  private readonly version: string;
  private readonly log: ClientLogger;
  private sessionId: string | null = null;
  private requestId = 0;
  private initPromise: Promise<void> | null = null;

  constructor(url: string, token: string, version: string, logger?: ClientLogger) {
    if (!url || typeof url !== "string") {
      throw new Error("WalterClient: url is required");
    }
    if (!token || typeof token !== "string") {
      throw new Error("WalterClient: token is required");
    }
    this.url = url;
    this.token = token;
    this.version = version;
    this.log = logger ?? SILENT_LOGGER;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
      "User-Agent": `${CLIENT_NAME}/${this.version}`,
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    return headers;
  }

  /**
   * Build a fetch signal that enforces BOTH a per-request timeout AND
   * respects the caller's cancellation signal.
   */
  private buildSignal(callerSignal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(RPC_TIMEOUT_MS);
    if (!callerSignal) return timeout;
    return AbortSignal.any([callerSignal, timeout]);
  }

  private captureSessionId(response: Response): void {
    const newSessionId = response.headers.get("mcp-session-id");
    if (newSessionId) {
      this.sessionId = newSessionId;
    }
  }

  /** Next JSON-RPC request ID, wrapping at MAX_REQUEST_ID. */
  private nextRequestId(): number {
    this.requestId = (this.requestId % MAX_REQUEST_ID) + 1;
    return this.requestId;
  }

  /**
   * Safely parse a JSON response body. Wraps SyntaxError from non-JSON
   * responses (broken proxies, WAFs, CDN error pages) into a clear message.
   */
  private async parseResponseJson(response: Response, context: string): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      const snippet = await response.text().catch(() => "(unreadable)");
      throw new Error(
        `Walter API returned non-JSON response for ${context} ` +
          `(${response.status} ${response.statusText}): ${snippet.slice(0, 100)}`,
      );
    }
  }

  /**
   * Send a JSON-RPC request to the Walter MCP endpoint.
   */
  private async rpc(
    method: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    const id = this.nextRequestId();

    this.log.info(`[walter] rpc ${method} (id=${id})`);

    const response = await fetch(`${this.url}/mcp`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: this.buildSignal(signal),
    });

    this.captureSessionId(response);

    if (!response.ok) {
      this.log.error(`[walter] rpc ${method} failed: ${response.status} ${response.statusText}`);
      const error: HttpError = new Error(
        `Walter API error: ${response.status} ${response.statusText}`,
      );
      error.httpStatus = response.status;
      throw error;
    }

    const body = assertObject(
      await this.parseResponseJson(response, `rpc(${method})`),
      `rpc(${method}) response`,
    );

    if (body.error) {
      const errObj = assertObject(body.error, `rpc(${method}) error`);
      const message = typeof errObj.message === "string" ? errObj.message : "Unknown RPC error";
      this.log.error(`[walter] rpc ${method} RPC error: ${message}`);
      throw new Error(`Walter RPC error: ${message}`);
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
    this.log.info(`[walter] notify ${method}`);

    const response = await fetch(`${this.url}/mcp`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
      signal: this.buildSignal(signal),
    });

    this.captureSessionId(response);

    if (!response.ok) {
      this.log.error(
        `[walter] notify ${method} failed: ${response.status} ${response.statusText}`,
      );
      throw new Error(
        `Walter notification '${method}' failed: ${response.status} ${response.statusText}`,
      );
    }
  }

  private resetSession(): void {
    this.log.info("[walter] resetting session");
    this.initPromise = null;
    this.sessionId = null;
    this.requestId = 0;
  }

  /**
   * Check if an error indicates the session is stale and should be re-initialized.
   * Only 404 (session not found) triggers re-init.
   * 401/403 are auth errors — retrying with the same token is pointless.
   */
  private isSessionError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return (error as HttpError).httpStatus === 404;
  }

  /**
   * Ensure the MCP session is initialized.
   *
   * Uses a shared promise so concurrent callers don't double-initialize.
   * The init itself uses its own timeout (not the caller's signal) so
   * one caller's cancellation can't poison the shared promise.
   */
  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize().catch((err) => {
        this.initPromise = null;
        throw err;
      });
    }
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    this.log.info("[walter] initializing MCP session");

    await this.rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: CLIENT_NAME, version: this.version },
    });

    await this.notify("notifications/initialized");

    this.log.info("[walter] MCP session initialized");
  }

  /**
   * Call an MCP tool by name with arguments.
   * Retries once on session errors (404) by re-initializing.
   */
  private async callTool(
    name: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<Array<{ type: string; text: string }>> {
    await this.ensureInitialized();

    try {
      return await this.callToolInner(name, args, signal);
    } catch (error) {
      if (this.isSessionError(error)) {
        this.log.warn(`[walter] session error calling ${name}, re-initializing`);
        this.resetSession();
        await this.ensureInitialized();
        return this.callToolInner(name, args, signal);
      }
      throw error;
    }
  }

  private async callToolInner(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Array<{ type: string; text: string }>> {
    const raw = await this.rpc("tools/call", { name, arguments: args }, signal);
    const result = assertObject(raw, `tools/call(${name})`);

    const content = assertArray(
      result.content,
      "content",
      `tools/call(${name})`,
      (item) => {
        const c = assertObject(item, `tools/call(${name}).content[]`);
        const type = assertString(c.type, "type", `tools/call(${name}).content[]`);

        if (type !== "text") {
          this.log.warn(`[walter] tools/call(${name}) returned non-text content type: ${type}`);
        }

        return {
          type,
          text: assertString(c.text, "text", `tools/call(${name}).content[]`),
        };
      },
    );

    if (result.isError === true) {
      throw new Error(content[0]?.text ?? "Unknown tool error");
    }

    return content;
  }

  private extractText(content: Array<{ type: string; text: string }>): string {
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }

  /**
   * Extract and parse JSON from an MCP tool result.
   * Throws if the content is not valid JSON.
   */
  private parseJson(content: Array<{ type: string; text: string }>): unknown {
    const text = this.extractText(content);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        `Walter returned non-JSON response (${text.length} chars)`,
      );
    }
  }

  // ─── Public API ───────────────────────────────────────────────

  async createChat(signal?: AbortSignal): Promise<string> {
    const content = await this.callTool("start_chat", {}, signal);
    const data = assertObject(this.parseJson(content), "createChat");
    return assertString(data.chat_id, "chat_id", "createChat");
  }

  async listChats(signal?: AbortSignal): Promise<Chat[]> {
    const content = await this.callTool("list_chats", {}, signal);
    const data = assertObject(this.parseJson(content), "listChats");
    return assertArray(data.chats, "chats", "listChats", validateChat);
  }

  async sendMessage(
    chatId: string,
    message: string,
    signal?: AbortSignal,
  ): Promise<{ request_id: string; chat_id: string }> {
    const content = await this.callTool("send_message", { chat_id: chatId, message }, signal);
    const data = assertObject(this.parseJson(content), "sendMessage");
    return {
      request_id: assertString(data.request_id, "request_id", "sendMessage"),
      chat_id: assertString(data.chat_id, "chat_id", "sendMessage"),
    };
  }

  async getResponse(requestId: string, signal?: AbortSignal): Promise<ResponseStatus> {
    const content = await this.callTool("get_response", { request_id: requestId }, signal);
    return validateResponseStatus(this.parseJson(content));
  }

  async cancelProcessing(
    chatId: string,
    signal?: AbortSignal,
  ): Promise<{ status: string; message?: string }> {
    const content = await this.callTool("cancel", { chat_id: chatId }, signal);
    const data = assertObject(this.parseJson(content), "cancelProcessing");
    return {
      status: assertString(data.status, "status", "cancelProcessing"),
      message: typeof data.message === "string" ? data.message : undefined,
    };
  }

  async listTurfs(signal?: AbortSignal): Promise<Turf[]> {
    const content = await this.callTool("list_turfs", {}, signal);
    const data = assertObject(this.parseJson(content), "listTurfs");
    return assertArray(data.turfs, "turfs", "listTurfs", validateTurf);
  }

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

    const content = await this.callTool("search_turfs", args, signal);
    const data = assertObject(this.parseJson(content), "searchTurfs");
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
   * Uses exponential backoff on transient errors (2s, 4s, 8s).
   */
  async chatStreaming(
    chatId: string,
    message: string,
    onPartial?: (partial: string) => void,
    signal?: AbortSignal,
  ): Promise<{ response: string; chat_id: string }> {
    const { request_id, chat_id } = await this.sendMessage(chatId, message, signal);

    const maxPollMs = 5 * 60 * 1000;
    const pollDeadline = Date.now() + maxPollMs;

    await delay(2000, signal);

    let lastPartial = "";
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    while (!signal?.aborted && Date.now() < pollDeadline) {
      let status: ResponseStatus;

      try {
        status = await this.getResponse(request_id, signal);
        consecutiveErrors = 0;
      } catch (error) {
        consecutiveErrors++;
        const errMsg = error instanceof Error ? error.message : String(error);
        this.log.warn(
          `[walter] poll error ${consecutiveErrors}/${maxConsecutiveErrors}: ${errMsg}`,
        );
        if (consecutiveErrors >= maxConsecutiveErrors) throw error;
        // Exponential backoff: 2s, 4s, 8s
        await delay(2000 * Math.pow(2, consecutiveErrors - 1), signal);
        continue;
      }

      switch (status.status) {
        case "processing":
          if (status.partial && status.partial !== lastPartial) {
            lastPartial = status.partial;
            onPartial?.(status.partial);
          }
          await delay(status.retry_after_seconds * 1000, signal);
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
 * Rejects with a proper AbortError (DOMException) for signal compatibility.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
