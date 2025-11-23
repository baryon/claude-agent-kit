# Mock SDK 架构说明

## 文件结构

```
mock-sdk/
└── src/
    ├── index.ts              # 主入口,导出所有公共 API
    ├── types.ts              # TypeScript 类型定义
    ├── errors.ts             # 错误类
    ├── schema-utils.ts       # Schema 验证工具
    ├── stream.ts             # AsyncMessageStream 实现
    ├── cli-tools.ts          # CLI 工具注册模拟
    ├── mcp-server.ts         # MCP 服务器实现
    ├── query.ts              # Query 类实现
    └── utils.ts              # 工具函数
```

## 模块职责

### types.ts
- 所有 TypeScript 类型定义
- 接口: `ToolDefinition`, `HookMap`, `QueryOptions`, `ClaudeMessage` 等
- 类型: `HookEvent`, `PromptInput`, `QueryMessage` 等
- `CliToolDefinition`: CLI 工具定义(SDK 不知道实现)

### errors.ts
- 错误类定义
- `AbortError`: 操作中止错误

### schema-utils.ts
- Schema 验证工具
- `validateWithSchema()`: 使用 Zod 或其他 schema 验证输入

### stream.ts
- `AsyncMessageStream<T>`: 异步消息流实现
- 支持生产者-消费者模式
- 实现 `AsyncIterable` 和 `AsyncIterator`

### cli-tools.ts
- **模拟 CLI 工具注册**
- `getBuiltinCliTools()`: 返回内置 CLI 工具列表
- `getAvailableSkills()`: 返回可用的 skills
- `getAvailableSlashCommands()`: 返回可用的 slash commands

**关键点**: 这些工具的实现代码在 CLI 中,SDK 只知道工具名称

### mcp-server.ts
- `MockMcpServer`: MCP 服务器实现
- `SdkControlServerTransport`: SDK 控制服务器传输层
- `createSdkMcpServer()`: 创建 SDK MCP 服务器

### query.ts
- `Query` 类: 核心查询实现
- 处理与 CLI 的通信
- 管理工具调用和转发
- 处理 hooks 和权限

### utils.ts
- 工具函数
- `approximateTokens()`: 估算 token 数量
- `randomId()`: 生成随机 ID
- `extractPlainText()`: 提取纯文本

## CLI 工具架构

### SDK 不实现工具,只转发

```typescript
// SDK 只知道工具名称,不知道实现
interface CliToolDefinition {
  name: string;
  description?: string;
  // 没有 handler, inputSchema, call 等字段
  // 这些都在 CLI 中
}
```

### 初始化流程

```
1. SDK 启动 CLI 子进程
   spawn("node", ["cli.js", ...args])

2. CLI 注册所有工具
   cli.js 内部:
   - Task 工具
   - Bash 工具
   - Read 工具
   - Skill 工具 (cli.js:2757-2850)
   - SlashCommand 工具
   - ...

3. CLI 发送 init 消息给 SDK
   CLI → SDK (stdout):
   {
     "type": "system",
     "subtype": "init",
     "tools": ["Task", "Bash", "Read", "Skill", ...],
     "availableSkills": [...]
   }

4. SDK 存储工具列表
   this.cliTools = message.tools

5. SDK 转发 init 消息给应用
   SDK → Application:
   yield { type: "system", subtype: "init", tools: [...] }
```

### 工具调用流程

```
1. Claude 决定调用工具
   Claude API → CLI:
   {
     "type": "tool_use",
     "name": "Read",
     "input": { "file_path": "/path/to/file" }
   }

2. CLI 执行工具
   const tool = cliTools["Read"]
   await tool.validateInput(input)
   await tool.checkPermissions(input)
   const result = await tool.call(input)

3. CLI 返回结果给 SDK
   CLI → SDK (stdout):
   {
     "type": "tool_result",
     "tool_use_id": "...",
     "content": "[file content]"
   }

4. SDK 转发给应用
   SDK → Application:
   yield { type: "tool_result", ... }
```

## Mock SDK 中的模拟

在 `cli-tools.ts` 中,我们模拟了 CLI 的工具注册:

```typescript
// 模拟 CLI 注册的工具
export function getBuiltinCliTools(): CliToolDefinition[] {
  return [
    { name: "Task" },
    { name: "Bash" },
    { name: "Read" },
    { name: "Write" },
    { name: "Skill" },  // 实现在 cli.js:2757-2850
    { name: "SlashCommand" },
    // ...
  ];
}
```

在 `Query` 类的 `initialize()` 方法中:

```typescript
private async initialize(): Promise<void> {
  // 步骤 1: 模拟接收 CLI 的 init 消息
  this.cliTools = getBuiltinCliTools();

  // 步骤 2: 发送 init 消息给应用层
  this.stream.enqueue({
    type: "system",
    subtype: "init",
    tools: this.cliTools.map(t => t.name),
    availableSkills: getAvailableSkills()
  });

  // 步骤 3: 触发 SessionStart hooks
  await this.triggerHooks("SessionStart", { initializing: true });
}
```

## 与真实 SDK 的区别

### 真实 SDK
- 启动真实的 CLI 子进程
- 通过 stdin/stdout 进行进程间通信
- 接收真实的 init 消息(包含所有 CLI 注册的工具)
- 转发工具调用和结果

### Mock SDK
- 不启动子进程
- 模拟 CLI 的工具注册
- 生成模拟的 init 消息
- 模拟工具调用的流程(但不真正执行)

## 重要设计原则

1. **SDK 不实现工具逻辑** - 所有工具的实现都在 CLI 中
2. **SDK 只做转发** - SDK 是 Application 和 CLI 之间的桥梁
3. **工具对 SDK 不透明** - SDK 只知道工具名称,不知道参数、实现
4. **CLI 拥有工具的完全控制权** - 权限检查、执行、错误处理都在 CLI

## 示例用法

```typescript
import { query, createSdkMcpServer } from "./mock-sdk";

// 创建查询
const result = query({
  prompt: "Read the README file",
  options: {
    hooks: {
      SessionStart: [{
        hooks: [async () => {
          console.log("Session started");
        }]
      }]
    }
  }
});

// 消费消息
for await (const message of result) {
  if (message.type === "system" && message.subtype === "init") {
    console.log("Available tools:", message.tools);
    // → ["Task", "Bash", "Read", "Write", "Skill", ...]

    console.log("Available skills:", message.availableSkills);
    // → [{name: "algorithmic-art", ...}, {name: "xlsx", ...}]
  }

  if (message.type === "result") {
    console.log("Assistant:", message.message.content);
  }
}
```

## 总结

Mock SDK 的模块化结构清晰地展示了:

1. **SDK 的职责**: 消息路由、流控制、Hook 管理
2. **CLI 的职责**: 工具实现、权限管理、系统集成
3. **工具的架构**: CLI 实现 → SDK 转发 → Application 使用

通过将 CLI 工具模拟(`cli-tools.ts`)与 SDK 核心逻辑(`query.ts`)分离,我们可以清楚地看到 SDK 并不拥有工具的实现,只是接收和转发工具信息。
