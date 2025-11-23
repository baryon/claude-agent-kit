/**
 * Type definitions for the Mock Claude Agent SDK
 */

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

export interface McpToolDescription {
  name: string;
  title?: string;
  description: string;
  annotations?: Record<string, unknown>;
}

export type McpMessage = Record<string, unknown>;

export interface McpServerStatus {
  name: string;
  type: "sdk" | "remote";
  status: "connected" | "configured";
  lastMessage?: McpMessage;
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

// Extended message types for agentic loop
export interface QueryUserMessage {
  type: "user";
  content: string;
}

export interface QueryAssistantMessage {
  type: "assistant";
  content: any[];  // ContentBlock[] from Anthropic
}

export interface QueryToolResultMessage {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

export interface QueryErrorMessage {
  type: "error";
  error: string;
}

export interface QueryDoneMessageExtended {
  type: "done";
  reason: string;
  numTurns?: number;
  totalTokens?: {
    input: number;
    output: number;
  };
}

export type QueryMessage =
  | QueryResultMessage
  | QueryDoneMessage
  | QueryUserMessage
  | QueryAssistantMessage
  | QueryToolResultMessage
  | QueryErrorMessage
  | QueryDoneMessageExtended;

export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: unknown };

export interface SchemaLike<TInput = unknown> {
  safeParse?(value: unknown): SafeParseResult<TInput>;
  safeParseAsync?(value: unknown): Promise<SafeParseResult<TInput>>;
  parse?(value: unknown): TInput;
}

export interface SdkMcpServerRegistration {
  type: "sdk";
  name: string;
  instance: any; // MockMcpServer, but avoiding circular dependency
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
