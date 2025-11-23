# Claude Agent SDK 完整实现原理

## 目录

1. [架构概述](#架构概述)
2. [核心组件详解](#核心组件详解)
3. [消息流转机制](#消息流转机制)
4. [控制流程](#控制流程)
5. [MCP 集成机制](#mcp-集成机制)
6. [Hook 系统](#hook-系统)
7. [Mock SDK 实现对比](#mock-sdk-实现对比)

---

## 架构概述

Claude Agent SDK 采用 **进程间通信 (IPC)** 架构,通过 stdin/stdout 与 Claude CLI 子进程交互:

```
┌────────────────────────────────────────────────────┐
│                  User Application                  │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │            query({ prompt, options })         │ │
│  └───────────────────┬──────────────────────────┘ │
│                      │                             │
│  ┌───────────────────▼──────────────────────────┐ │
│  │              Query Instance                   │ │
│  │  - Async Iterator Interface                  │ │
│  │  - Control Methods (interrupt, setModel...)  │ │
│  │  - Hook Management                           │ │
│  │  - MCP Server Coordination                   │ │
│  └───────────────────┬──────────────────────────┘ │
│                      │                             │
└──────────────────────┼─────────────────────────────┘
                       │
     ┌─────────────────▼─────────────────┐
     │    ProcessTransport               │
     │  ┌─────────────┐  ┌─────────────┐ │
     │  │   stdin     │  │   stdout    │ │
     │  └──────┬──────┘  └──────▲──────┘ │
     └─────────┼─────────────────┼────────┘
               │ JSON Lines      │ JSON Lines
               ▼                 │
     ┌─────────────────────────────────────┐
     │     Claude CLI Process              │
     │  - Message Router                   │
     │  - Tool Execution Engine            │
     │  - Claude API Client                │
     │  - MCP Server Manager               │
     │  - Permission System                │
     └─────────────────────────────────────┘
```

### 关键设计原则

1. **流式通信**: 所有消息通过 JSON Lines (一行一个 JSON 对象) 传输
2. **双向控制**: SDK 可以向 CLI 发送控制请求,CLI 也可以回调 SDK
3. **异步迭代**: 暴露 AsyncIterator 接口供用户消费消息流
4. **状态管理**: CLI 维护会话状态,SDK 负责协调和转发

---

## 核心组件详解

### 1. ProcessTransport

**位置**: `sdk.mjs:6357-6794`

**职责**: 管理与 Claude CLI 子进程的生命周期和通信

**关键实现**:

```javascript
class ProcessTransport {
  constructor(options) {
    this.abortController = options.abortController || createAbortController();
    this.initialize();
  }

  initialize() {
    // 1. 构建 CLI 参数
    const args = [
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose"
    ];

    // 2. 添加模型、系统提示、工具配置等
    if (options.model) args.push("--model", options.model);
    if (options.allowedTools.length > 0) {
      args.push("--allowedTools", options.allowedTools.join(","));
    }

    // 3. 处理权限模式
    if (options.canUseTool) {
      args.push("--permission-prompt-tool", "stdio");
    }

    // 4. MCP 服务器配置
    if (options.mcpServers) {
      args.push("--mcp-config", JSON.stringify({ mcpServers }));
    }

    // 5. 启动子进程
    this.child = spawn(executable, [pathToClaudeCodeExecutable, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // 6. 设置流监听
    this.setupStreamHandlers();
  }

  setupStreamHandlers() {
    // stdout: 逐行解析 JSON 消息
    this.child.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          const message = JSON.parse(line);
          this.messageQueue.enqueue(message);
        }
      }
    });

    // stderr: 错误日志或调试输出
    this.child.stderr.on('data', (chunk) => {
      if (options.stderr) {
        options.stderr(chunk.toString());
      }
    });

    // exit: 清理资源
    this.child.on('exit', (code, signal) => {
      this.handleExit(code, signal);
    });
  }

  async write(data) {
    // 向 CLI stdin 写入消息
    this.child.stdin.write(data);
  }

  endInput() {
    // 关闭 stdin,通知 CLI 不再有输入
    this.child.stdin.end();
  }

  close() {
    // 发送 SIGTERM,必要时 SIGKILL
    if (!this.child.killed) {
      this.child.kill('SIGTERM');
      setTimeout(() => {
        if (!this.child.killed) {
          this.child.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  async *readMessages() {
    // 异步生成器,从消息队列读取
    while (!this.closed) {
      const message = await this.messageQueue.dequeue();
      yield message;
    }
  }
}
```

**参数映射表**:

| SDK Option | CLI Argument | 说明 |
|-----------|--------------|------|
| `model` | `--model` | 模型名称 |
| `customSystemPrompt` | `--system-prompt` | 替换默认系统提示 |
| `appendSystemPrompt` | `--append-system-prompt` | 追加系统提示 |
| `maxThinkingTokens` | `--max-thinking-tokens` | 最大思考令牌数 |
| `maxTurns` | `--max-turns` | 最大对话轮次 |
| `allowedTools` | `--allowedTools` | 工具白名单 |
| `disallowedTools` | `--disallowedTools` | 工具黑名单 |
| `mcpServers` | `--mcp-config` | MCP 服务器配置 JSON |
| `canUseTool` | `--permission-prompt-tool stdio` | 启用权限回调 |
| `permissionMode` | `--permission-mode` | 权限模式 |
| `resume` | `--resume <session-id>` | 恢复会话 |
| `cwd` | `cwd` (spawn option) | 工作目录 |

### 2. Query 类

**位置**: `sdk.mjs:7490-7839`

**职责**: 封装会话逻辑,提供 AsyncIterator 接口和控制方法

**核心状态机**:

```
初始化阶段
    ↓
┌─────────────────────────────┐
│  constructor()              │
│  - 创建 Transport           │
│  - 初始化 MCP 连接          │
│  - 启动消息读取循环          │
│  - 发送初始化控制请求        │
└─────────────┬───────────────┘
              ↓
┌─────────────────────────────┐
│  readMessages() 循环         │
│  ┌─────────────────────────┐│
│  │ for await (message) {   ││
│  │   switch(message.type){ ││
│  │     case "control_*"    ││
│  │     case "result"       ││
│  │     case "system"       ││
│  │     ...                 ││
│  │   }                     ││
│  │ }                       ││
│  └─────────────────────────┘│
└─────────────┬───────────────┘
              ↓
    用户通过 for await 消费消息
              ↓
┌─────────────────────────────┐
│  cleanup()                  │
│  - 关闭 transport           │
│  - 清理待处理响应            │
│  - 断开 MCP 连接            │
└─────────────────────────────┘
```

**关键方法实现**:

```javascript
class Query {
  constructor(transport, isSingleUserTurn, canUseTool, hooks, abortController, sdkMcpServers) {
    this.transport = transport;
    this.canUseTool = canUseTool;
    this.hooks = hooks;
    this.pendingControlResponses = new Map();

    // 连接 SDK MCP 服务器
    for (const [name, server] of sdkMcpServers) {
      const transport = new SdkControlServerTransport(
        (msg) => this.sendMcpServerMessageToCli(name, msg)
      );
      this.sdkMcpTransports.set(name, transport);
      server.connect(transport);
    }

    // 启动消息读取
    this.sdkMessages = this.readSdkMessages();
    this.readMessages();

    // 异步初始化
    this.initialization = this.initialize();
  }

  async readMessages() {
    try {
      for await (const message of this.transport.readMessages()) {
        // 1. 控制响应 - 解决待处理的 Promise
        if (message.type === "control_response") {
          const handler = this.pendingControlResponses.get(message.response.request_id);
          if (handler) {
            handler(message.response);
          }
          continue;
        }

        // 2. 控制请求 - CLI 向 SDK 请求回调
        if (message.type === "control_request") {
          await this.handleControlRequest(message);
          continue;
        }

        // 3. 取消请求 - 中止正在执行的回调
        if (message.type === "control_cancel_request") {
          this.handleControlCancelRequest(message);
          continue;
        }

        // 4. Keep-alive 消息 - 忽略
        if (message.type === "keep_alive") {
          continue;
        }

        // 5. Result 消息 - 单轮对话结束 stdin
        if (message.type === "result") {
          if (this.isSingleUserTurn) {
            this.transport.endInput();
          }
        }

        // 6. 其他消息 - 转发给用户
        this.inputStream.enqueue(message);
      }
    } catch (error) {
      this.cleanup(error);
    }
  }

  async handleControlRequest(request) {
    const controller = new AbortController();
    this.cancelControllers.set(request.request_id, controller);

    try {
      const response = await this.processControlRequest(request, controller.signal);

      // 发送成功响应
      await this.transport.write(JSON.stringify({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: request.request_id,
          response
        }
      }) + '\n');
    } catch (error) {
      // 发送错误响应
      await this.transport.write(JSON.stringify({
        type: "control_response",
        response: {
          subtype: "error",
          request_id: request.request_id,
          error: error.message
        }
      }) + '\n');
    } finally {
      this.cancelControllers.delete(request.request_id);
    }
  }

  async processControlRequest(request, signal) {
    switch (request.request.subtype) {
      case "can_use_tool":
        // 权限回调
        return this.canUseTool(
          request.request.tool_name,
          request.request.input,
          { signal, suggestions: request.request.permission_suggestions }
        );

      case "hook_callback":
        // Hook 回调
        return this.handleHookCallbacks(
          request.request.callback_id,
          request.request.input,
          request.request.tool_use_id,
          signal
        );

      case "mcp_message":
        // MCP 消息转发
        const transport = this.sdkMcpTransports.get(request.request.server_name);
        if (transport.onmessage) {
          transport.onmessage(request.request.message);
        }
        return { mcp_response: { jsonrpc: "2.0", result: {}, id: 0 } };

      default:
        throw new Error("Unsupported control request");
    }
  }

  async request(request) {
    // SDK → CLI 控制请求
    const requestId = Math.random().toString(36).substring(2, 15);

    return new Promise((resolve, reject) => {
      this.pendingControlResponses.set(requestId, (response) => {
        if (response.subtype === "success") {
          resolve(response);
        } else {
          reject(new Error(response.error));
        }
      });

      this.transport.write(JSON.stringify({
        request_id: requestId,
        type: "control_request",
        request
      }) + '\n');
    });
  }

  async* readSdkMessages() {
    // 异步迭代器入口
    for await (const message of this.inputStream) {
      yield message;
    }
  }

  // AsyncIterator 接口
  [Symbol.asyncIterator]() {
    return this.sdkMessages;
  }

  async interrupt() {
    await this.request({ subtype: "interrupt" });
  }

  async setModel(model) {
    await this.request({ subtype: "set_model", model });
  }
}
```

### 3. Stream 类

**职责**: 实现内部消息队列,支持生产者-消费者模式

```javascript
class Stream {
  constructor() {
    this.queue = [];
    this.waiters = [];
    this.done = false;
    this.error = null;
  }

  enqueue(value) {
    if (this.done || this.error) return;

    if (this.waiters.length > 0) {
      const resolve = this.waiters.shift();
      resolve({ value, done: false });
    } else {
      this.queue.push(value);
    }
  }

  async next() {
    if (this.error) {
      throw this.error;
    }

    if (this.queue.length > 0) {
      return { value: this.queue.shift(), done: false };
    }

    if (this.done) {
      return { value: undefined, done: true };
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  complete() {
    this.done = true;
    for (const resolve of this.waiters) {
      resolve({ value: undefined, done: true });
    }
    this.waiters = [];
  }

  fail(error) {
    this.error = error;
    for (const resolve of this.waiters) {
      resolve({ value: undefined, done: true });
    }
    this.waiters = [];
  }
}
```

---

## 消息流转机制

### 消息类型体系

```typescript
// 用户发送的消息
type SDKUserMessage = {
  type: "user";
  uuid: string;
  session_id: string;
  parent_tool_use_id: string | null;
  message: {
    role: "user";
    content: ContentBlock[];
  };
};

// CLI 返回的消息
type SDKSystemMessage = {
  type: "system";
  subtype: "init" | "session_start" | "busy" | "ready" | ...;
  // ... 子类型特定字段
};

type SDKResultMessage = {
  type: "result";
  id: string;
  model: string;
  message: {
    role: "assistant";
    content: ContentBlock[];
  };
  usage: { input_tokens: number; output_tokens: number };
};

type SDKDoneMessage = {
  type: "done";
  reason: "completed" | "max_turns" | "interrupted" | ...;
};

// 控制消息 (双向)
type ControlRequest = {
  type: "control_request";
  request_id: string;
  request: {
    subtype: "interrupt" | "set_model" | "can_use_tool" | ...;
    // ... 子类型特定字段
  };
};

type ControlResponse = {
  type: "control_response";
  response: {
    subtype: "success" | "error";
    request_id: string;
    response?: any;
    error?: string;
  };
};
```

### 完整对话流程

```
1. 初始化阶段
   ─────────────────────────────────────────
   SDK                          CLI
    │                            │
    │  control_request:          │
    │  { subtype: "initialize",  │
    │    hooks: {...},          │
    │    sdkMcpServers: [...] }  │
    ├───────────────────────────>│
    │                            │ 加载配置
    │                            │ 注册 hooks
    │                            │ 连接 MCP
    │                            │
    │  control_response:         │
    │  { commands: [...],        │
    │    models: [...],          │
    │    account: {...} }        │
    │<───────────────────────────┤
    │                            │

2. 用户输入阶段
   ─────────────────────────────────────────
   SDK                          CLI
    │                            │
    │  user_message:             │
    │  { type: "user",           │
    │    message: { ... } }      │
    ├───────────────────────────>│
    │                            │
    │  system_message:           │
    │  { type: "system",         │
    │    subtype: "session_start"│
    │<───────────────────────────┤
    │                            │
    │  system_message:           │
    │  { subtype: "init" }       │
    │<───────────────────────────┤
    │                            │

3. 权限检查阶段 (如果配置了 canUseTool)
   ─────────────────────────────────────────
   SDK                          CLI
    │                            │
    │  control_request:          │
    │  { subtype: "can_use_tool",│
    │    tool_name: "Bash",      │
    │    input: { ... },         │
    │    permission_suggestions  │
    │<───────────────────────────┤
    │                            │
    │  在 SDK 执行 canUseTool()   │
    │  返回 true/false            │
    │                            │
    │  control_response:         │
    │  { subtype: "success",     │
    │    response: true }        │
    ├───────────────────────────>│
    │                            │ 继续执行工具
    │                            │ 或拒绝执行

4. Hook 回调阶段
   ─────────────────────────────────────────
   SDK                          CLI
    │                            │
    │  control_request:          │
    │  { subtype: "hook_callback"│
    │    callback_id: "hook_0",  │
    │    input: { ... },         │
    │    tool_use_id: "..." }    │
    │<───────────────────────────┤
    │                            │
    │  执行注册的 hook 函数        │
    │  const result = await      │
    │    hook(input, toolUseId)  │
    │                            │
    │  control_response:         │
    │  { subtype: "success",     │
    │    response: result }      │
    ├───────────────────────────>│
    │                            │

5. 助手响应阶段
   ─────────────────────────────────────────
   SDK                          CLI
    │                            │
    │  assistant_message:        │
    │  { type: "assistant",      │
    │    content: [              │
    │      { type: "thinking" }, │
    │      { type: "tool_use" }  │
    │    ] }                     │
    │<───────────────────────────┤
    │                            │
    │  result_message:           │
    │  { type: "result",         │
    │    model: "...",           │
    │    usage: { ... } }        │
    │<───────────────────────────┤
    │                            │
    │  done_message:             │
    │  { type: "done",           │
    │    reason: "completed" }   │
    │<───────────────────────────┤
    │                            │
    │  关闭 stream                │

6. 中断流程 (用户调用 interrupt())
   ─────────────────────────────────────────
   SDK                          CLI
    │                            │
    │  control_request:          │
    │  { subtype: "interrupt" }  │
    ├───────────────────────────>│
    │                            │ 中止当前操作
    │                            │ 发送 done
    │                            │
    │  done_message:             │
    │  { type: "done",           │
    │    reason: "interrupted" } │
    │<───────────────────────────┤
    │                            │
```

---

## 控制流程

### 1. SDK → CLI 控制请求

```typescript
// 所有控制方法都通过 request() 实现
async function request(request: ControlRequest) {
  const requestId = randomId();

  // 注册响应处理器
  const promise = new Promise((resolve, reject) => {
    pendingControlResponses.set(requestId, (response) => {
      if (response.subtype === "success") {
        resolve(response.response);
      } else {
        reject(new Error(response.error));
      }
    });
  });

  // 发送请求
  await transport.write(JSON.stringify({
    type: "control_request",
    request_id: requestId,
    request
  }) + '\n');

  return promise;
}

// 示例: 中断
async interrupt() {
  await request({ subtype: "interrupt" });
}

// 示例: 切换模型
async setModel(model: string) {
  await request({ subtype: "set_model", model });
}

// 示例: 查询 MCP 服务器状态
async mcpServerStatus() {
  const response = await request({ subtype: "mcp_status" });
  return response.mcpServers;
}
```

### 2. CLI → SDK 控制请求

```typescript
async function handleControlRequest(request: ControlRequest) {
  const controller = new AbortController();
  cancelControllers.set(request.request_id, controller);

  try {
    let response;

    switch (request.request.subtype) {
      case "can_use_tool":
        // 权限检查回调
        response = await canUseTool(
          request.request.tool_name,
          request.request.input,
          {
            signal: controller.signal,
            suggestions: request.request.permission_suggestions
          }
        );
        break;

      case "hook_callback":
        // Hook 执行
        const callback = hookCallbacks.get(request.request.callback_id);
        response = await callback(
          request.request.input,
          request.request.tool_use_id,
          { signal: controller.signal }
        );
        break;

      case "mcp_message":
        // MCP 消息转发到 SDK MCP 服务器
        const transport = sdkMcpTransports.get(request.request.server_name);
        transport.onmessage(request.request.message);
        response = { mcp_response: { jsonrpc: "2.0", result: {}, id: 0 } };
        break;
    }

    // 发送成功响应
    await transport.write(JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: request.request_id,
        response
      }
    }) + '\n');

  } catch (error) {
    // 发送错误响应
    await transport.write(JSON.stringify({
      type: "control_response",
      response: {
        subtype: "error",
        request_id: request.request_id,
        error: error.message
      }
    }) + '\n');
  } finally {
    cancelControllers.delete(request.request_id);
  }
}
```

### 3. 取消控制请求

```typescript
// CLI 发送取消请求
{
  type: "control_cancel_request",
  request_id: "abc123"
}

// SDK 处理取消
function handleControlCancelRequest(request) {
  const controller = cancelControllers.get(request.request_id);
  if (controller) {
    controller.abort(); // 触发 AbortSignal
    cancelControllers.delete(request.request_id);
  }
}
```

---

## MCP 集成机制

### MCP 服务器类型

1. **SDK MCP Server** (`type: "sdk"`):
   - 在 SDK 进程中运行
   - 通过 `SdkControlServerTransport` 与 CLI 通信
   - 工具调用在 SDK 进程执行

2. **Remote MCP Server** (普通配置对象):
   - 独立进程或远程服务
   - CLI 直接管理连接
   - SDK 只提供配置

### SDK MCP Server 实现

```typescript
// 1. 创建 MCP 服务器
const server = createSdkMcpServer({
  name: "my-tools",
  version: "1.0.0",
  tools: [
    tool("greet", "Greet someone", z.object({ name: z.string() }), async (input) => {
      return {
        content: [{ type: "text", text: `Hello, ${input.name}!` }]
      };
    })
  ]
});

// 2. 传递给 query
const instance = query({
  prompt: "Say hello to Alice",
  options: {
    mcpServers: {
      "my-tools": server  // SDK 服务器
    }
  }
});

// 3. CLI 调用工具时的流程
//    CLI → control_request: mcp_message
//    SDK → 转发给 server.callTool()
//    SDK → control_response: mcp_response
//    CLI → 继续处理
```

### SdkControlServerTransport

```typescript
class SdkControlServerTransport {
  constructor(sendMcpMessage) {
    this.sendMcpMessage = sendMcpMessage;
  }

  // SDK → CLI
  async send(message) {
    // 如果消息有 id,需要等待响应
    if (message.id) {
      const key = `${serverName}:${message.id}`;
      return new Promise((resolve) => {
        pendingMcpResponses.set(key, { resolve });
        this.sendMcpMessage(message);
      });
    } else {
      // 通知类消息,不等待响应
      this.sendMcpMessage(message);
    }
  }

  // CLI → SDK
  onmessage = (message) => {
    // 由 Query.processControlRequest 设置
  };
}
```

### MCP 消息流转

```
1. SDK MCP Server 发送消息
   ───────────────────────────────────────────
   MCP Server              SDK                 CLI
       │                    │                   │
       │  server.sendToolListChanged()         │
       │  ─────────────────>│                   │
       │                    │                   │
       │                    │  SDK → CLI 消息    │
       │                    │  封装为:           │
       │                    │  { method:        │
       │                    │    "notifications/│
       │                    │     tools/        │
       │                    │     list_changed" │
       │                    ├──────────────────>│
       │                    │                   │
       │                    │                   │ 重新获取工具列表

2. CLI 调用 SDK MCP 工具
   ───────────────────────────────────────────
   CLI                    SDK              MCP Server
    │                      │                   │
    │  control_request:    │                   │
    │  { subtype:          │                   │
    │    "mcp_message",    │                   │
    │    server_name,      │                   │
    │    message: {        │                   │
    │      method:         │                   │
    │        "tools/call", │                   │
    │      params: {...}   │                   │
    │    }                 │                   │
    ├─────────────────────>│                   │
    │                      │                   │
    │                      │  调用工具           │
    │                      ├──────────────────>│
    │                      │                   │
    │                      │  返回结果           │
    │                      │<──────────────────┤
    │                      │                   │
    │  control_response:   │                   │
    │  { mcp_response }    │                   │
    │<─────────────────────┤                   │
    │                      │                   │
```

---

## Hook 系统

### Hook 事件类型

```typescript
const HOOK_EVENTS = [
  "PreToolUse",        // 工具使用前
  "PostToolUse",       // 工具使用后
  "Notification",      // 通知消息
  "UserPromptSubmit",  // 用户提交输入
  "SessionStart",      // 会话开始
  "SessionEnd",        // 会话结束
  "Stop",              // 停止
  "SubagentStop",      // 子代理停止
  "PreCompact"         // 压缩前
] as const;
```

### Hook 注册和触发

```typescript
// 1. 用户注册 Hook
const hooks = {
  PreToolUse: [{
    matcher: { tool: "Bash" },  // 可选匹配器
    hooks: [
      async (input, toolUseId, context) => {
        console.log("About to run Bash:", input);
        // 可返回值修改输入
        return input;
      }
    ]
  }],
  PostToolUse: [{
    hooks: [
      async (result, toolUseId, context) => {
        console.log("Tool result:", result);
      }
    ]
  }]
};

// 2. Query 初始化时转换 Hook
async function initialize() {
  const convertedHooks = {};

  for (const [event, matchers] of Object.entries(hooks)) {
    convertedHooks[event] = matchers.map((matcher) => {
      const callbackIds = [];

      // 为每个 hook 函数生成唯一 ID
      for (const callback of matcher.hooks) {
        const callbackId = `hook_${nextCallbackId++}`;
        hookCallbacks.set(callbackId, callback);
        callbackIds.push(callbackId);
      }

      return {
        matcher: matcher.matcher,
        hookCallbackIds: callbackIds
      };
    });
  }

  // 发送给 CLI
  await request({
    subtype: "initialize",
    hooks: convertedHooks
  });
}

// 3. CLI 触发 Hook 时回调 SDK
// CLI → SDK
{
  type: "control_request",
  request: {
    subtype: "hook_callback",
    callback_id: "hook_0",
    input: { ... },
    tool_use_id: "toolu_abc123"
  }
}

// 4. SDK 执行 Hook 并返回结果
async function handleHookCallbacks(callbackId, input, toolUseId, signal) {
  const callback = hookCallbacks.get(callbackId);
  return await callback(input, toolUseId, { signal });
}
```

---

## Mock SDK 实现对比

### 核心差异

| 特性 | 官方 SDK | Mock SDK |
|-----|---------|---------|
| **架构** | 子进程通信 (IPC) | 内存模拟 |
| **CLI 依赖** | 必需 (spawn Claude CLI) | 不需要 |
| **网络请求** | 通过 CLI 访问 Anthropic API | 无网络请求 |
| **消息生成** | Claude 模型生成 | 确定性模拟引擎 |
| **工具执行** | 真实文件系统/进程操作 | 模拟返回 |
| **性能** | 启动慢 (~1-2秒) | 即时 |
| **适用场景** | 生产环境 | 测试/开发 |

### Mock 实现简化

```typescript
// 官方 SDK: 通过 ProcessTransport spawn 子进程
const transport = new ProcessTransport(options);
const query = new Query(transport, ...);

// Mock SDK: 直接模拟消息流
class Query {
  constructor(prompt, options) {
    // 跳过子进程,直接生成响应
    if (typeof prompt === "string") {
      this.processPrompt(prompt);
    }
  }

  private processPrompt(text: string) {
    // 模拟 Hook 触发
    await this.triggerHooks("UserPromptSubmit", { prompt: text });

    // 模拟响应生成
    const response = this.engine.generateResponse(text);

    // 直接 enqueue 消息
    this.stream.enqueue({
      type: "result",
      model: "mock-3.5-sonnet",
      message: {
        role: "assistant",
        content: [{ type: "text", text: response }]
      },
      usage: { input_tokens: 10, output_tokens: 20 }
    });

    this.stream.enqueue({ type: "done", reason: "completed" });
  }
}
```

### 保留的兼容性

Mock SDK 保持与官方 SDK 相同的:

1. **类型签名**: `Query`, `tool()`, `createSdkMcpServer()` 等接口一致
2. **AsyncIterator**: 相同的消息消费方式
3. **控制方法**: `interrupt()`, `setModel()` 等返回相同结构
4. **Hook 系统**: 支持所有 Hook 事件和回调
5. **MCP 集成**: SDK MCP Server 完整模拟

### 增强的测试能力

```typescript
// 确定性响应
const query1 = query({ prompt: "Hello" });
// 总是返回 "Mock response #1: Hello"

// Hook 验证
const hookCalled = [];
const query2 = query({
  prompt: "Test",
  options: {
    hooks: {
      UserPromptSubmit: [{
        hooks: [async (input) => {
          hookCalled.push(input);
        }]
      }]
    }
  }
});

// MCP 工具验证
const server = createSdkMcpServer({
  name: "test",
  tools: [
    tool("add", "Add numbers", z.object({ a: z.number(), b: z.number() }),
      async (input) => {
        return { content: [{ type: "text", text: String(input.a + input.b) }] };
      }
    )
  ]
});
```

---

## 总结

Claude Agent SDK 的核心设计:

1. **进程隔离**: 通过子进程实现安全沙箱和资源管理
2. **双向控制**: SDK 和 CLI 都可以发起控制请求,实现灵活的回调机制
3. **流式架构**: 基于 AsyncIterator 的流式 API,支持实时消息消费
4. **插件系统**: 通过 Hooks 和 MCP 提供强大的扩展能力
5. **状态管理**: CLI 维护完整会话状态,SDK 负责协调和转发

Mock SDK 通过内存模拟实现相同的接口,为测试和开发提供轻量级替代方案。
