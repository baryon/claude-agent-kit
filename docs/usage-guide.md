# Claude Agent Kit 使用指南

## 📦 项目概述

`claude-agent-kit` 是一个围绕 `@anthropic-ai/claude-agent-sdk` 构建的工具集,提供会话管理、消息解析和 WebSocket 编排功能,帮助快速构建 Claude 驱动的 Agent 应用。

**核心价值:**
- 🔄 会话生命周期管理 - 保持本地状态与 Claude 同步
- 📨 消息解析工具 - 规范化 Claude 流式响应
- 🌐 WebSocket 编排 - 支持多客户端实时通信
- 🎯 开箱即用示例 - 加速新 Agent 应用开发

## 🏗️ 项目架构

### 包结构 (Monorepo)

```
claude-agent-kit/
├── packages/
│   ├── messages/          # 消息类型和工具函数
│   ├── server/            # 会话管理核心
│   ├── websocket/         # Node.js WebSocket 处理器
│   └── bun-websocket/     # Bun WebSocket 处理器
└── examples/
    ├── basic-example/     # Bun + React 基础示例
    └── claude-code-web/   # Express + Vite 完整示例
```

### 核心组件架构

```
┌─────────────┐
│   Browser   │ (WebSocket Client)
└──────┬──────┘
       │ { type: "chat", content, attachments }
       ↓
┌─────────────────────┐
│ WebSocketHandler    │ (Transport Layer)
└──────┬──────────────┘
       │
       ↓
┌─────────────────────┐
│  SessionManager     │ (Orchestration)
└──────┬──────────────┘
       │
       ↓
┌─────────────────────┐
│     Session         │ (State Management)
│  - messages[]       │
│  - isBusy/isLoading │
│  - options          │
└──────┬──────────────┘
       │
       ↓
┌────────────────────────────────┐
│ IClaudeAgentSDKClient          │ (Interface)
│  ↳ SimpleClaudeAgentSDKClient  │ (Implementation)
└──────┬─────────────────────────┘
       │
       ↓
┌────────────────────────────────┐
│ @anthropic-ai/claude-agent-sdk │ (Official SDK)
└────────────────────────────────┘
```

## 🔑 核心概念

### 1. **Session** (会话)

**位置:** `packages/server/src/server/session.ts:75`

**职责:** 管理单个 Claude 对话的完整生命周期

**核心状态:**
- `sessionId`: Claude 会话标识符
- `messages`: SDK 消息数组
- `isBusy`: Claude 正在处理请求
- `isLoading`: 正在加载历史消息
- `options`: 会话配置选项

**关键方法:**
```typescript
// 发送用户消息并处理流式响应
async send(prompt: string, attachments?: AttachmentPayload[]): Promise<void>

// 从历史记录恢复会话
async resumeFrom(sessionId: string): Promise<void>

// 订阅/取消订阅客户端
subscribe(client: ISessionClient): void
unsubscribe(client: ISessionClient): void

// 中断当前请求
interrupt(): void

// 设置 SDK 选项
setSDKOptions(options: Partial<SessionSDKOptions>): void
```

**工作流程:**
```typescript
// Session.send() 核心流程
1. 构建 SDKUserMessage
2. 添加到消息列表 → 通知客户端 (message_added)
3. 调用 sdkClient.queryStream() 获取流式响应
4. 处理每个 SDKMessage → 更新状态 → 通知客户端
5. 完成后设置 isBusy = false
```

### 2. **SessionManager** (会话管理器)

**位置:** `packages/server/src/server/session-manager.ts:10`

**职责:** 管理多个 Session 实例,路由客户端请求

**核心方法:**
```typescript
// 创建新会话
createSession(sdkClient: IClaudeAgentSDKClient): Session

// 获取或创建会话
getOrCreateSession(client: ISessionClient): Session

// 发送消息 (自动处理会话创建和订阅)
sendMessage(client: ISessionClient, prompt: string, attachments?: AttachmentPayload[]): void

// 设置 SDK 选项
setSDKOptions(client: ISessionClient, options: Partial<SessionSDKOptions>): void
```

### 3. **IClaudeAgentSDKClient** (SDK 客户端接口)

**职责:** 定义与 Claude Agent SDK 交互的标准接口

**实现:** `SimpleClaudeAgentSDKClient` (`packages/server/src/server/simple-cas-client.ts:18`)

```typescript
interface IClaudeAgentSDKClient {
  // 流式查询 Claude
  queryStream(
    prompt: string | AsyncIterable<SDKUserMessage>,
    options?: Partial<SDKOptions>
  ): AsyncIterable<SDKMessage>;

  // 从磁盘加载历史消息
  loadMessages(sessionId: string): Promise<{ messages: SDKMessage[] }>;
}
```

**SimpleClaudeAgentSDKClient 实现:**
```typescript
// 直接调用官方 SDK 的 query() 函数
async *queryStream(prompt, options) {
  for await (const message of query({ prompt, options })) {
    yield message;
  }
}

// 从 .claude/projects/*.jsonl 读取历史记录
async loadMessages(sessionId) {
  const filePath = await locateSessionFile({ projectsRoot, sessionId });
  return { messages: await readSessionMessagesFromDisk(filePath) };
}
```

### 4. **WebSocketHandler** (WebSocket 处理器)

**位置:** `packages/websocket/src/websocket-handler.ts:13`

**职责:** WebSocket 传输层,连接客户端和 SessionManager

**支持的消息类型:**

**入站 (客户端 → 服务器):**
```typescript
{ type: "chat", content: string, attachments?: AttachmentPayload[] }
{ type: "setSDKOptions", options: Partial<SessionSDKOptions> }
{ type: "resume", sessionId: string }
```

**出站 (服务器 → 客户端):**
```typescript
{ type: "message_added", sessionId, message: SDKMessage }
{ type: "messages_updated", sessionId, messages: SDKMessage[] }
{ type: "session_state_changed", sessionId, sessionState: {...} }
{ type: "error", error: string, code?: string }
```

## 📝 如何使用 Claude Agent SDK

### 基础使用 (不使用 WebSocket)

```typescript
import { SessionManager, SimpleClaudeAgentSDKClient } from "@claude-agent-kit/server";

// 1. 创建 SDK 客户端
const sdkClient = new SimpleClaudeAgentSDKClient();

// 2. 创建会话管理器
const sessionManager = new SessionManager();

// 3. 创建会话
const session = sessionManager.createSession(sdkClient);

// 4. 配置选项 (可选)
session.setSDKOptions({
  cwd: "/path/to/workspace",
  thinkingLevel: "default_on",
  allowedTools: ["Task", "Bash", "Read", "Write"],
  maxTurns: 100
});

// 5. 发送消息
await session.send("List the open pull requests in this repo.", undefined);

// 6. 读取响应
for (const message of session.messages) {
  console.log(`[${message.type}]`, message);
}
```

### WebSocket 服务器 (Bun)

```typescript
import { BunWebSocketHandler } from "@claude-agent-kit/bun-websocket";
import { SimpleClaudeAgentSDKClient } from "@claude-agent-kit/server";

const sdkClient = new SimpleClaudeAgentSDKClient();
const wsHandler = new BunWebSocketHandler(sdkClient, {
  cwd: "./agent",
  thinkingLevel: "default_on"
});

Bun.serve({
  port: 3000,
  websocket: {
    open(ws) { wsHandler.onOpen(ws); },
    message(ws, msg) { wsHandler.onMessage(ws, msg); },
    close(ws) { wsHandler.onClose(ws); }
  },
  fetch(req, server) {
    if (new URL(req.url).pathname === "/ws") {
      server.upgrade(req, { data: { sessionId: "" } });
      return;
    }
    return new Response("OK");
  }
});
```

### WebSocket 服务器 (Node.js + ws)

```typescript
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { WebSocketHandler } from '@claude-agent-kit/websocket';
import { SimpleClaudeAgentSDKClient } from '@claude-agent-kit/server';

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const sdkClient = new SimpleClaudeAgentSDKClient();
const wsHandler = new WebSocketHandler(sdkClient, {
  thinkingLevel: 'default_on'
});

wss.on('connection', (ws) => {
  void wsHandler.onOpen(ws);
  ws.on('message', (data) => wsHandler.onMessage(ws, String(data)));
  ws.on('close', () => wsHandler.onClose(ws));
});

httpServer.listen(3000);
```

### 客户端 (浏览器)

```typescript
const ws = new WebSocket("ws://localhost:3000/ws");

ws.onopen = () => {
  // 发送聊天消息
  ws.send(JSON.stringify({
    type: "chat",
    content: "Hello, Claude!"
  }));
};

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);

  switch (msg.type) {
    case "message_added":
      console.log("新消息:", msg.message);
      break;
    case "messages_updated":
      console.log("消息列表更新:", msg.messages);
      break;
    case "session_state_changed":
      console.log("状态变化:", msg.sessionState);
      break;
  }
};

// 恢复历史会话
ws.send(JSON.stringify({
  type: "resume",
  sessionId: "your-session-id"
}));

// 更新配置
ws.send(JSON.stringify({
  type: "setSDKOptions",
  options: { cwd: "/new/path" }
}));
```

## ⚙️ 配置选项

### SessionSDKOptions

```typescript
{
  // 工作目录
  cwd?: string,

  // 思考级别: "default_on" | "default_off"
  thinkingLevel?: "default_on" | "default_off",

  // 允许的工具列表
  allowedTools?: string[],

  // MCP 服务器配置
  mcpServers?: Record<string, unknown>,

  // Hook 配置
  hooks?: Record<string, unknown>,

  // 最大轮次
  maxTurns?: number,

  // 附加系统提示
  appendSystemPrompt?: string
}
```

### 默认配置

```typescript
const DEFAULT_SESSION_OPTIONS = {
  maxTurns: 100,
  allowedTools: [
    "Task", "Bash", "Glob", "Grep", "LS", "ExitPlanMode",
    "Read", "Edit", "MultiEdit", "Write", "NotebookEdit",
    "WebFetch", "TodoWrite", "WebSearch", "BashOutput", "KillBash"
  ],
  mcpServers: {},
  hooks: {},
  thinkingLevel: "default_on"
};
```

## 🔄 消息流转

### 1. 聊天流程

```
User → Browser
  │ { type: "chat", content: "Hello" }
  ↓
WebSocketHandler.onMessage()
  │ 解析 JSON
  ↓
SessionManager.sendMessage()
  │ 获取或创建会话
  ↓
Session.send()
  │ 1. 构建 SDKUserMessage
  │ 2. addNewMessage() → 通知客户端 message_added
  │ 3. sdkClient.queryStream() → 流式调用官方 SDK
  ↓
for await (message of stream)
  │ processIncomingMessage()
  │ - 更新 sessionId
  │ - addNewMessage() → 通知客户端 message_added
  │ - 更新 isBusy 状态 → 通知客户端 session_state_changed
  ↓
Browser 收到多个事件
  - message_added (用户消息)
  - message_added (系统消息)
  - message_added (助手消息)
  - session_state_changed (isBusy: true/false)
```

### 2. 恢复会话流程

```
User → Browser
  │ { type: "resume", sessionId: "abc123" }
  ↓
WebSocketHandler.handleResumeMessage()
  │ 1. 更新 client.sessionId
  │ 2. 订阅到对应 Session
  ↓
Session.resumeFrom()
  │ 1. setLoadingState(true) → 通知客户端
  │ 2. sdkClient.loadMessages(sessionId)
  │    - 查找 .claude/projects/abc123.jsonl
  │    - 解析 JSONL 文件
  │ 3. setMessages(messages) → 通知客户端 messages_updated
  ↓
Browser 收到事件
  - session_state_changed (isLoading: true)
  - messages_updated (完整历史记录)
  - session_state_changed (isLoading: false)
```

## 🎯 关键特性

### 1. **多客户端支持**
- 一个 Session 可以被多个 WebSocket 客户端订阅
- 状态更新会广播给所有订阅客户端
- 实现位置: `packages/server/src/server/session.ts:94`

### 2. **状态持久化**
- Claude SDK 自动保存消息到 `.claude/projects/*.jsonl`
- `loadMessages()` 可从磁盘恢复历史会话
- 实现位置: `packages/server/src/utils/session-files.ts`

### 3. **流式响应**
- 使用 `async generator` 流式处理 Claude 响应
- 实时更新客户端,无需等待完整响应
- 实现位置: `packages/server/src/server/session.ts:374`

### 4. **中断机制**
- 使用 `AbortController` 支持中断请求
- 实现位置: `packages/server/src/server/session.ts:89`, `:202`

### 5. **消息规范化**
- `convertSDKMessages()` 将 SDK 原始消息转换为 UI 友好格式
- `coalesceReadMessages()` 合并连续的 Read 操作
- 实现位置: `packages/messages/src/messages/messages.ts:21`

## 🚀 运行示例

### 基础示例 (Bun)

```bash
pnpm install
export ANTHROPIC_API_KEY=your-key-here
cd examples/basic-example
bun run dev
# 打开 http://localhost:3000
```

### Web 示例 (Express + Vite)

```bash
pnpm install
export ANTHROPIC_API_KEY=your-key-here
cd examples/claude-code-web
pnpm dev
# 打开 http://localhost:5173
```

## 📊 扩展性

### 自定义 SDK 客户端

实现 `IClaudeAgentSDKClient` 接口添加日志、重试等功能:

```typescript
class CustomSDKClient implements IClaudeAgentSDKClient {
  async *queryStream(prompt, options) {
    console.log("开始查询:", prompt);
    for await (const message of query({ prompt, options })) {
      console.log("收到消息:", message.type);
      yield message;
    }
  }

  async loadMessages(sessionId) {
    // 自定义加载逻辑 (例如从数据库)
  }
}
```

### 自定义传输层

实现 `ISessionClient` 接口支持 HTTP SSE、Socket.IO 等:

```typescript
interface ISessionClient {
  sessionId?: string;
  sdkClient: IClaudeAgentSDKClient;
  receiveSessionMessage(event: string, message: OutcomingMessage): void;
}
```

## 📚 API 参考

### Session

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `send` | `prompt: string, attachments?: AttachmentPayload[]` | `Promise<void>` | 发送用户消息并处理流式响应 |
| `resumeFrom` | `sessionId: string` | `Promise<void>` | 从历史记录恢复会话 |
| `subscribe` | `client: ISessionClient` | `void` | 订阅客户端到会话 |
| `unsubscribe` | `client: ISessionClient` | `void` | 取消订阅客户端 |
| `interrupt` | - | `void` | 中断当前请求 |
| `setSDKOptions` | `options: Partial<SessionSDKOptions>` | `void` | 设置 SDK 选项 |

### SessionManager

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `createSession` | `sdkClient: IClaudeAgentSDKClient` | `Session` | 创建新会话 |
| `getOrCreateSession` | `client: ISessionClient` | `Session` | 获取或创建会话 |
| `sendMessage` | `client: ISessionClient, prompt: string, attachments?: AttachmentPayload[]` | `void` | 发送消息 |
| `setSDKOptions` | `client: ISessionClient, options: Partial<SessionSDKOptions>` | `void` | 设置 SDK 选项 |

## 总结

`claude-agent-kit` 提供了完整的 Claude Agent 应用开发框架:

1. **Session**: 管理单个对话的状态和生命周期
2. **SessionManager**: 编排多个会话和客户端
3. **WebSocketHandler**: 提供实时通信能力
4. **SimpleClaudeAgentSDKClient**: 封装官方 SDK 调用

通过这些组件,可以快速构建生产级的 Claude Agent 应用,支持会话恢复、实时流式响应、多客户端协作等高级特性。
