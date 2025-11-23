/**
 * Minimal TypeScript mock of the public bits of the Claude Agent SDK.
 * The goal is to keep the surface area stable for tests without forking
 * a real Claude Code process. None of the business logic here contacts
 * Anthropic services – everything happens in memory.
 */

// Export web tools for web environment usage
export {
  WEB_TOOLS,
  DocumentReadTool,
  DocumentWriteTool,
  DocumentSearchTool,
  DocumentListTool,
  CodeExecuteTool,
  getWebToolsSystemPrompt,
  getMockDatabase,
  type WebDocument
} from "./web-tools.js";

// Export agentic engine for real agent functionality
export {
  AgenticEngine,
  type AgenticEngineOptions,
  type AgenticLoopResult
} from "./agentic-engine.js";

// Export multi-model engine for multiple LLM providers
export {
  MultiModelEngine,
  type MultiModelEngineOptions,
  type ModelProvider
} from "./multi-model-engine.js";

export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "UserPromptSubmit",
  "SessionStart",
  "SessionEnd",
  "Stop",
  "SubagentStop",
  "PreCompact"
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export const EXIT_REASONS = [
  "clear",
  "logout",
  "prompt_input_exit",
  "other",
  "bypass_permissions_disabled"
] as const;

export class AbortError extends Error {
  constructor(message = "Operation aborted") {
    super(message);
    this.name = "AbortError";
  }
}

export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: unknown };

export interface SchemaLike<TInput = unknown> {
  safeParse?(value: unknown): SafeParseResult<TInput>;
  safeParseAsync?(value: unknown): Promise<SafeParseResult<TInput>>;
  parse?(value: unknown): TInput;
}

async function validateWithSchema<T>(schema: SchemaLike<T> | undefined, value: unknown): Promise<T> {
  if (!schema) {
    return value as T;
  }
  if (schema.safeParseAsync) {
    const result = await schema.safeParseAsync(value);
    if (!result.success) {
      throw new Error(readableSchemaError(result.error));
    }
    return result.data;
  }
  if (schema.safeParse) {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new Error(readableSchemaError(result.error));
    }
    return result.data;
  }
  if (schema.parse) {
    return schema.parse(value);
  }
  return value as T;
}

function readableSchemaError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export type ContentBlock = { type: "text"; text: string } | Record<string, unknown>;

export interface ClaudeUserMessage {
  role: "user";
  content: ContentBlock[];
}

export interface ClaudeAssistantMessage {
  role: "assistant";
  content: ContentBlock[];
}

export interface ClaudeSystemMessage {
  role: "system";
  content: ContentBlock[];
}

export type ClaudeMessage =
  | { type: "user"; message: ClaudeUserMessage; session_id?: string; parent_tool_use_id?: string | null }
  | { type: "assistant"; message: ClaudeAssistantMessage }
  | { type: "system"; message: ClaudeSystemMessage }
  | { type: string; [key: string]: unknown };

export type PromptInput = string | AsyncIterable<ClaudeMessage>;

export interface ToolResultContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  content: ToolResultContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface ToolHandlerContext {
  signal: AbortSignal;
  toolName: string;
}

export type ToolHandler<TInput = unknown> = (
  input: TInput,
  ctx: ToolHandlerContext
) => ToolResult | Promise<ToolResult>;

export interface ToolDefinition<TInput = unknown> {
  name: string;
  title?: string;
  description: string;
  inputSchema?: SchemaLike<TInput>;
  outputSchema?: SchemaLike<unknown>;
  handler: ToolHandler<TInput>;
  annotations?: Record<string, unknown>;
  enabled?: boolean;
}

export function tool<TInput>(
  name: string,
  description: string,
  inputSchemaOrHandler?: SchemaLike<TInput> | ToolHandler<TInput>,
  maybeHandler?: ToolHandler<TInput>
): ToolDefinition<TInput> {
  if (typeof inputSchemaOrHandler === "function") {
    return {
      name,
      description,
      handler: inputSchemaOrHandler,
      enabled: true
    };
  }
  if (!maybeHandler) {
    throw new Error("A handler must be provided when an input schema is supplied.");
  }
  return {
    name,
    description,
    inputSchema: inputSchemaOrHandler,
    handler: maybeHandler,
    enabled: true
  };
}

export interface HookCallbackContext {
  signal: AbortSignal;
}

export type HookCallback = (
  input: unknown,
  toolUseId: string | null,
  context: HookCallbackContext
) => Promise<unknown> | unknown;

export interface HookMatcher {
  matcher?: Record<string, unknown>;
  hooks: HookCallback[];
}

export type HookMap = Partial<Record<HookEvent, HookMatcher[]>>;

interface RegisteredTool extends ToolDefinition {
  enabled: boolean;
}

export interface McpToolDescription {
  name: string;
  title?: string;
  description: string;
  annotations?: Record<string, unknown>;
}

export type McpMessage = Record<string, unknown>;

class SdkControlServerTransport {
  private isClosed = false;

  constructor(private readonly sendMcpMessage: (message: McpMessage) => void) {}

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: McpMessage) => void;

  async start(): Promise<void> {
    return Promise.resolve();
  }

  async send(message: McpMessage): Promise<void> {
    if (this.isClosed) {
      throw new Error("Transport is closed");
    }
    this.sendMcpMessage(message);
  }

  async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.onclose?.();
  }
}

export class MockMcpServer {
  private readonly tools = new Map<string, RegisteredTool>();
  private transport?: SdkControlServerTransport;

  constructor(private readonly info: { name: string; version: string }) {}

  async connect(transport: SdkControlServerTransport): Promise<void> {
    this.transport = transport;
    await this.transport.start();
  }

  async close(): Promise<void> {
    await this.transport?.close();
    this.transport = undefined;
  }

  registerTool(def: ToolDefinition): void {
    this.tools.set(def.name, {
      ...def,
      enabled: def.enabled ?? true
    });
  }

  tool<TInput>(
    name: string,
    description: string,
    inputSchemaOrHandler?: SchemaLike<TInput> | ToolHandler<TInput>,
    maybeHandler?: ToolHandler<TInput>
  ): void {
    const definition = tool(name, description, inputSchemaOrHandler as any, maybeHandler as any);
    this.registerTool(definition as any);
  }

  listTools(): McpToolDescription[] {
    return Array.from(this.tools.values())
      .filter((tool) => tool.enabled)
      .map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        annotations: tool.annotations
      }));
  }

  sendToolListChanged(): void {
    this.transport?.send({ method: "notifications/tools/list_changed" }).catch((error) => {
      this.transport?.onerror?.(error instanceof Error ? error : new Error(String(error)));
    });
  }

  async callTool(name: string, args: unknown, ctx: ToolHandlerContext): Promise<ToolResult> {
    const registered = this.tools.get(name);
    if (!registered) {
      throw new Error(`Tool ${name} not found`);
    }
    if (!registered.enabled) {
      throw new Error(`Tool ${name} is disabled`);
    }
    const parsedArgs = await validateWithSchema(registered.inputSchema, args);
    const result = await registered.handler(parsedArgs, ctx);
    if (registered.outputSchema && !result.isError) {
      await validateWithSchema(registered.outputSchema, result.structuredContent);
    }
    return result;
  }
}

export interface CreateSdkMcpServerOptions {
  name: string;
  version?: string;
  tools?: ToolDefinition[];
}

export interface SdkMcpServerRegistration {
  type: "sdk";
  name: string;
  instance: MockMcpServer;
}

export function createSdkMcpServer(options: CreateSdkMcpServerOptions): SdkMcpServerRegistration {
  const server = new MockMcpServer({
    name: options.name,
    version: options.version ?? "1.0.0"
  });
  options.tools?.forEach((toolDef) => server.registerTool(toolDef));
  return {
    type: "sdk",
    name: options.name,
    instance: server
  };
}

export interface QueryOptions {
  abortController?: AbortController;
  allowedTools?: string[];
  disallowedTools?: string[];
  canUseTool?: (
    toolName: string,
    input: unknown,
    context: { signal: AbortSignal; suggestions?: string[] }
  ) => Promise<boolean> | boolean;
  hooks?: HookMap;
  mcpServers?: Record<string, SdkMcpServerRegistration | Record<string, unknown>>;
  model?: string;
  maxThinkingTokens?: number;
  includePartialMessages?: boolean;
}

export interface ControlRequest {
  subtype: string;
  [key: string]: unknown;
}

export interface ControlSuccessResponse {
  subtype: "success";
  response: Record<string, unknown>;
}

export type ControlResponse = ControlSuccessResponse | { subtype: "error"; error: string };

export interface QueryResultMessage {
  type: "result";
  id: string;
  model: string;
  message: ClaudeAssistantMessage;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  metadata: Record<string, unknown>;
}

export interface QueryDoneMessage {
  type: "done";
  reason: string;
}

export type QueryMessage = QueryResultMessage | QueryDoneMessage;

class AsyncMessageStream<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private queue: T[] = [];
  private resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private rejecters: Array<(reason?: unknown) => void> = [];
  private closed = false;
  private failure?: unknown;

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }

  next(): Promise<IteratorResult<T>> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    if (this.queue.length > 0) {
      return Promise.resolve({ value: this.queue.shift()!, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.resolvers.push(resolve);
      this.rejecters.push(reject);
    });
  }

  enqueue(value: T): void {
    if (this.closed || this.failure) {
      return;
    }
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      this.rejecters.shift();
      resolve({ value, done: false });
    } else {
      this.queue.push(value);
    }
  }

  complete(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      this.rejecters.shift();
      resolve({ value: undefined, done: true });
    }
  }

  throw(error: unknown): Promise<IteratorResult<T>> {
    this.fail(error);
    return Promise.reject(error);
  }

  fail(error: unknown): void {
    if (this.failure) {
      return;
    }
    this.failure = error;
    while (this.rejecters.length > 0) {
      const reject = this.rejecters.shift()!;
      this.resolvers.shift();
      reject(error);
    }
  }

  return(): Promise<IteratorResult<T>> {
    this.complete();
    return Promise.resolve({ value: undefined, done: true });
  }
}

class MockConversationEngine {
  private readonly history: string[] = [];

  generateResponse(prompt: string): string {
    this.history.push(prompt);
    const prefix = `Mock response #${this.history.length}`;
    return `${prefix}: ${prompt}`;
  }
}

function approximateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return Math.max(1, Math.ceil(words.length * 1.3));
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function extractPlainText(message: ClaudeMessage): string | undefined {
  if (!("message" in message) || !message.message) {
    return undefined;
  }
  const msg = message as any;
  const blocks = msg.message?.content ?? [];
  const textBlock = blocks.find((block: any) => block.type === "text");
  if (textBlock && typeof textBlock.text === "string") {
    return textBlock.text;
  }
  return undefined;
}

interface RegisteredMcpServer {
  kind: "sdk" | "remote";
  config: SdkMcpServerRegistration | Record<string, unknown>;
}

export interface McpServerStatus {
  name: string;
  type: RegisteredMcpServer["kind"];
  status: "connected" | "configured";
  lastMessage?: McpMessage;
}

/**
 * Built-in CLI tool (like Read, Write, Bash, Skill, etc.)
 * These are registered and implemented in the CLI,
 * SDK only receives the tool list and forwards tool calls
 */
export interface CliToolDefinition {
  name: string;
  description?: string;
  // CLI tools are opaque to SDK - we only know their names
}

export class Query implements AsyncIterable<QueryMessage>, AsyncIterator<QueryMessage> {
  private readonly stream = new AsyncMessageStream<QueryMessage>();
  private readonly abortController: AbortController;
  private readonly engine = new MockConversationEngine();
  private readonly hooks: HookMap;
  private readonly canUseTool?: QueryOptions["canUseTool"];
  private readonly sdkMcpTransports = new Map<string, SdkControlServerTransport>();
  private readonly registeredServers = new Map<string, RegisteredMcpServer>();
  private readonly mcpMessages: Array<{ server: string; message: McpMessage }> = [];
  private currentModel: string;
  private maxThinkingTokens?: number;
  private permissionMode: string = "default";
  private sessionClosed = false;
  private initialized = false;

  /**
   * CLI tools received from the init message
   * These are tools implemented in CLI (Read, Write, Bash, Skill, etc.)
   * SDK only knows their names, not their implementation
   */
  private cliTools: CliToolDefinition[] = [];

  constructor(prompt: PromptInput, options: QueryOptions = {}) {
    this.abortController = options.abortController ?? new AbortController();
    this.hooks = options.hooks ?? {};
    this.canUseTool = options.canUseTool;
    this.currentModel = options.model ?? "mock-3.5-sonnet";
    this.maxThinkingTokens = options.maxThinkingTokens;
    this.wireMcpServers(options.mcpServers);

    // Simulate initialization phase
    void this.initialize().then(() => {
      if (typeof prompt === "string") {
        void this.processPrompt(prompt);
      } else {
        void this.streamInput(prompt);
      }
    });
  }

  private async initialize(): Promise<void> {
    // Simulate the SDK initialization handshake with the CLI process
    // In real SDK, this sends hooks configuration and MCP server list to CLI

    // Step 1: Simulate receiving init message from CLI
    // In real SDK: CLI → SDK (stdout): { type: "system", subtype: "init", tools: [...] }
    this.cliTools = this.simulateCliToolRegistration();

    // Step 2: Send init message to application layer
    // In real SDK: SDK → Application: init message with tools list
    this.stream.enqueue({
      type: "system",
      subtype: "init",
      tools: this.cliTools.map(t => t.name),
      mcpServers: Array.from(this.registeredServers.keys()),
      availableSkills: this.simulateAvailableSkills()
    } as any);

    // Step 3: Trigger session start hooks
    await this.triggerHooks("SessionStart", { initializing: true });
    this.initialized = true;
  }

  /**
   * Simulates web environment tool registration
   * Replaces filesystem tools with database-backed equivalents
   */
  private simulateCliToolRegistration(): CliToolDefinition[] {
    // Web environment tools - replace filesystem tools with database operations
    return [
      { name: "Task", description: "Launch specialized agents for complex tasks" },
      { name: "code_execute", description: "Execute code in sandbox (replaces Bash)" },
      { name: "ExitPlanMode", description: "Exit plan mode" },
      { name: "document_read", description: "Read document from database (replaces Read)" },
      { name: "document_write", description: "Write document to database (replaces Write/Edit)" },
      { name: "document_search", description: "Search documents in database (replaces Grep)" },
      { name: "document_list", description: "List documents (replaces Glob)" },
      { name: "WebFetch", description: "Fetch web content" },
      { name: "TodoWrite", description: "Manage todo lists" },
      { name: "WebSearch", description: "Search the web" },
      { name: "Skill", description: "Execute skills" },
      { name: "SlashCommand", description: "Execute slash commands" },
      { name: "AskUserQuestion", description: "Ask user questions" }
    ];
  }

  /**
   * Simulates available skills loaded from ~/.claude/skills/
   * In real SDK, this comes from CLI's init message
   */
  private simulateAvailableSkills(): Array<{ name: string; description: string }> {
    return [
      { name: "algorithmic-art", description: "Creating algorithmic art using p5.js" },
      { name: "canvas-design", description: "Create beautiful visual art" },
      { name: "xlsx", description: "Spreadsheet creation and editing" },
      { name: "pdf", description: "PDF manipulation" }
    ];
  }

  private wireMcpServers(servers: QueryOptions["mcpServers"]): void {
    if (!servers) {
      return;
    }
    for (const [name, config] of Object.entries(servers)) {
      if (config && (config as SdkMcpServerRegistration).type === "sdk" && "instance" in (config as SdkMcpServerRegistration)) {
        const typed = config as SdkMcpServerRegistration;
        const transport = new SdkControlServerTransport((message) => this.handleMcpMessage(name, message));
        this.sdkMcpTransports.set(name, transport);
        typed.instance.connect(transport);
        this.registeredServers.set(name, { kind: "sdk", config: typed });
      } else {
        this.registeredServers.set(name, { kind: "remote", config });
      }
    }
  }

  private handleMcpMessage(server: string, message: McpMessage): void {
    this.mcpMessages.push({ server, message });
  }

  private async processPrompt(text: string): Promise<void> {
    if (this.sessionClosed) {
      return;
    }
    await this.triggerHooks("SessionStart", { prompt: text });
    await this.triggerHooks("UserPromptSubmit", { prompt: text });
    if (this.canUseTool) {
      const permitted = await this.canUseTool("mock-tool", { prompt: text }, {
        signal: this.abortController.signal,
        suggestions: []
      });
      if (!permitted) {
        this.pushResult(`Permission denied to use mock-tool for input: ${text}`);
        return;
      }
    }
    this.pushResult(text);
  }

  private pushResult(sourceText: string): void {
    const assistantText = this.engine.generateResponse(sourceText);
    const result: QueryResultMessage = {
      type: "result",
      id: randomId(),
      model: this.currentModel,
      message: {
        role: "assistant",
        content: [{ type: "text", text: assistantText }]
      },
      usage: {
        input_tokens: approximateTokens(sourceText),
        output_tokens: approximateTokens(assistantText)
      },
      metadata: {
        sourceText,
        maxThinkingTokens: this.maxThinkingTokens
      }
    };
    this.stream.enqueue(result);
    this.stream.enqueue({ type: "done", reason: "completed" });
  }

  async streamInput(stream: AsyncIterable<ClaudeMessage>): Promise<void> {
    try {
      for await (const message of stream) {
        if (this.abortController.signal.aborted) {
          throw new AbortError();
        }
        const text = extractPlainText(message);
        if (text) {
          await this.processPrompt(text);
        }
      }
    } catch (error) {
      if (error instanceof AbortError) {
        this.stream.fail(error);
      } else {
        throw error;
      }
    }
  }

  private async triggerHooks(event: HookEvent, payload: unknown): Promise<void> {
    const matchers = this.hooks[event] ?? [];
    const executions = matchers.flatMap((matcher) => matcher.hooks);
    await Promise.all(
      executions.map((hook) =>
        Promise.resolve(hook(payload, null, { signal: this.abortController.signal })).catch((error) => {
          // Hooks should never crash the mock stream, so we log and keep going.
          console.warn(`[MockQuery] Hook for ${event} failed`, error);
        })
      )
    );
  }

  async interrupt(): Promise<ControlResponse> {
    this.abortController.abort();
    this.sessionClosed = true;
    await this.triggerHooks("Stop", { reason: "interrupt" });
    return this.request({ subtype: "interrupt" });
  }

  async resume(): Promise<ControlResponse> {
    return this.request({ subtype: "resume" });
  }

  async setPermissionMode(mode: string): Promise<ControlResponse> {
    return this.request({ subtype: "set_permission_mode", mode });
  }

  async setModel(model: string): Promise<ControlResponse> {
    this.currentModel = model;
    return this.request({ subtype: "set_model", model });
  }

  async setMaxThinkingTokens(tokens: number): Promise<ControlResponse> {
    this.maxThinkingTokens = tokens;
    return this.request({ subtype: "set_max_thinking_tokens", max_thinking_tokens: tokens });
  }

  request(request: ControlRequest): Promise<ControlResponse> {
    const response: ControlSuccessResponse = {
      subtype: "success",
      response: {
        acknowledged: request.subtype,
        at: new Date().toISOString(),
        request
      }
    };
    return Promise.resolve(response);
  }

  supportedCommands(): Promise<string[]> {
    return Promise.resolve(["interrupt", "resume", "set_model", "set_permission_mode"]);
  }

  supportedModels(): Promise<string[]> {
    return Promise.resolve([this.currentModel, "mock-3.5-sonnet", "mock-opus"]);
  }

  async mcpServerStatus(): Promise<McpServerStatus[]> {
    return Array.from(this.registeredServers.entries()).map(([name, entry]) => ({
      name,
      type: entry.kind,
      status: entry.kind === "sdk" ? "connected" : "configured",
      lastMessage: [...this.mcpMessages].reverse().find((msg) => msg.server === name)?.message
    }));
  }

  async accountInfo(): Promise<Record<string, unknown>> {
    return {
      account: "mock",
      quota_used: 0,
      quota_limit: Infinity
    };
  }

  close(): void {
    if (this.sessionClosed) {
      return;
    }
    this.sessionClosed = true;
    this.stream.complete();
    void this.triggerHooks("SessionEnd", { reason: "close" });
  }

  next(): Promise<IteratorResult<QueryMessage>> {
    return this.stream.next();
  }

  return(): Promise<IteratorResult<QueryMessage>> {
    this.close();
    return this.stream.return();
  }

  throw(error: unknown): Promise<IteratorResult<QueryMessage>> {
    this.stream.fail(error);
    return Promise.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<QueryMessage> {
    return this.stream[Symbol.asyncIterator]();
  }
}

export interface QueryArgs {
  prompt: PromptInput;
  options?: QueryOptions;
}

export function query({ prompt, options }: QueryArgs): Query {
  return new Query(prompt, options);
}
