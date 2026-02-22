/**
 * WalterClient — speaks JSON-RPC to the Walter MCP endpoint.
 *
 * Reuses the existing /mcp endpoint so no new Walter-side code is needed.
 * The client handles the JSON-RPC protocol and exposes clean async methods.
 */

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

export class WalterClient {
  private url: string;
  private token: string;
  private sessionId: string | null = null;
  private requestId = 0;
  private initialized = false;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  /**
   * Send a JSON-RPC request to the Walter MCP endpoint.
   */
  private async rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.requestId;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
    };

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const response = await fetch(`${this.url}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
    });

    // Capture session ID from response headers
    const newSessionId = response.headers.get("mcp-session-id");
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    if (!response.ok) {
      throw new Error(`Walter API error: ${response.status} ${response.statusText}`);
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
   * Ensure the MCP session is initialized.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    await this.rpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "openclaw-walter-plugin", version: "0.1.0" },
    });

    // Send initialized notification (no id = notification)
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    await fetch(`${this.url}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });

    this.initialized = true;
  }

  /**
   * Call an MCP tool by name with arguments.
   */
  private async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }> {
    await this.ensureInitialized();

    const result = (await this.rpc("tools/call", { name, arguments: args })) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };

    if (result.isError) {
      const errorText = result.content?.[0]?.text ?? "Unknown error";
      throw new Error(errorText);
    }

    return result;
  }

  /**
   * Extract text content from an MCP tool result.
   */
  private extractText(result: {
    content: Array<{ type: string; text: string }>;
  }): string {
    return result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }

  /**
   * Extract parsed JSON from an MCP tool result.
   */
  private extractJson(result: {
    content: Array<{ type: string; text: string }>;
  }): unknown {
    const text = this.extractText(result);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // ─── Public API ───────────────────────────────────────────────

  /**
   * Create a new chat session. Returns the chat_id.
   */
  async createChat(): Promise<string> {
    const result = await this.callTool("start_chat");
    const data = this.extractJson(result) as { chat_id: string };
    return data.chat_id;
  }

  /**
   * List the user's chat sessions.
   */
  async listChats(): Promise<Chat[]> {
    const result = await this.callTool("list_chats");
    const data = this.extractJson(result) as { chats: Chat[] };
    return data.chats;
  }

  /**
   * Send a message to a chat. Returns the request_id for polling.
   */
  async sendMessage(
    chatId: string,
    message: string,
  ): Promise<{ request_id: string; chat_id: string }> {
    const result = await this.callTool("send_message", { chat_id: chatId, message });
    return this.extractJson(result) as { request_id: string; chat_id: string };
  }

  /**
   * Poll for a response to a previously sent message.
   */
  async getResponse(requestId: string): Promise<ResponseStatus> {
    const result = await this.callTool("get_response", { request_id: requestId });
    return this.extractJson(result) as ResponseStatus;
  }

  /**
   * Cancel active processing in a chat.
   */
  async cancelProcessing(chatId: string): Promise<{ status: string; message?: string }> {
    const result = await this.callTool("cancel", { chat_id: chatId });
    return this.extractJson(result) as { status: string; message?: string };
  }

  /**
   * List all connected turfs.
   */
  async listTurfs(): Promise<Turf[]> {
    const result = await this.callTool("list_turfs");
    const data = this.extractJson(result) as { turfs: Turf[] };
    return data.turfs;
  }

  /**
   * Search turfs by name, type, OS, or status.
   */
  async searchTurfs(filters: {
    name?: string;
    type?: string;
    os?: string;
    status?: string;
  }): Promise<{ turfs: Turf[]; count: number }> {
    const args: Record<string, unknown> = {};
    if (filters.name) args.name = filters.name;
    if (filters.type) args.type = filters.type;
    if (filters.os) args.os = filters.os;
    if (filters.status) args.status = filters.status;

    const result = await this.callTool("search_turfs", args);
    return this.extractJson(result) as { turfs: Turf[]; count: number };
  }

  /**
   * Send a message and wait for the complete response, with streaming partial updates.
   *
   * This is the star method — it merges send_message + get_response into a single
   * blocking call that streams partial results via the onPartial callback.
   */
  async chatStreaming(
    chatId: string,
    message: string,
    onPartial?: (partial: string) => void,
    signal?: AbortSignal,
  ): Promise<{ response: string; chat_id: string }> {
    const { request_id, chat_id } = await this.sendMessage(chatId, message);

    // Safety timeout — don't poll forever (5 minutes)
    const maxPollMs = 5 * 60 * 1000;
    const pollDeadline = Date.now() + maxPollMs;

    // Initial delay — Walter needs a moment to start working
    await this.delay(2000, signal);

    let lastPartial = "";

    // Poll loop
    while (!signal?.aborted && Date.now() < pollDeadline) {
      const status = await this.getResponse(request_id);

      switch (status.status) {
        case "processing":
          // Stream partial results if they've changed
          if (status.partial && status.partial !== lastPartial) {
            lastPartial = status.partial;
            onPartial?.(status.partial);
          }
          await this.delay((status.retry_after_seconds ?? 4) * 1000, signal);
          break;

        case "complete":
          return { response: status.response, chat_id };

        case "error":
          throw new Error(`Walter error: ${status.error}`);
      }
    }

    throw new Error(signal?.aborted ? "Request was cancelled" : "Walter response timed out after 5 minutes");
  }

  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Aborted"));
        return;
      }

      const timer = setTimeout(resolve, ms);

      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("Aborted"));
        },
        { once: true },
      );
    });
  }
}
