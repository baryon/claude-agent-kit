# Mock SDK vs 真实 SDK Agent 设计对比

## 问题
Mock SDK 的 agent 设计跟原版完全一样吗？包括 LLM 获取结果后的工具调用、循环以及最后生成结果。

## 简短回答

**不一样**。Mock SDK 是**极度简化**的版本，只模拟了基本的消息流，**没有实现真正的 agentic loop**。

## 详细对比

### 1. 真实 SDK 的 Agent Loop (CLI 实现)

真实的 Claude Agent SDK 实现了完整的 **agentic loop**（代理循环），这是一个复杂的对话循环系统：

#### 完整流程

```
1. 用户输入 (User Prompt)
   ↓
2. CLI 构建消息历史 + 系统提示
   ↓
3. 调用 Anthropic API (messages.create)
   ↓
4. 流式接收 LLM 响应
   ↓
5. 检查响应类型：
   ├─ 纯文本？ → 返回给用户 → 结束
   └─ 包含 tool_use？ → 进入工具调用循环
      ↓
6. 工具调用循环：
   a) 解析 tool_use blocks
   b) 检查权限 (canUseTool callback)
   c) 执行工具 (调用工具 handler)
   d) 收集 tool_result
   e) 将 tool_result 添加到消息历史
   f) 再次调用 Anthropic API
   ↓
7. 重复步骤 4-6，直到：
   - LLM 不再请求工具调用
   - 达到最大轮次限制
   - 用户中断
   ↓
8. 返回最终结果
```

#### 关键实现细节

**CLI 中的对话管理** (cli.js):
```javascript
// 真实 SDK 维护完整的消息历史
class ConversationManager {
  messages: Message[] = [];  // 完整对话历史

  async runAgenticLoop(userPrompt: string) {
    // 添加用户消息
    this.messages.push({
      role: "user",
      content: userPrompt
    });

    while (true) {
      // 调用 Claude API
      const response = await this.callAnthropic({
        messages: this.messages,
        tools: this.availableTools
      });

      // 添加助手响应到历史
      this.messages.push({
        role: "assistant",
        content: response.content  // 包含 text 和/或 tool_use blocks
      });

      // 检查是否有工具调用
      const toolUses = response.content.filter(block => block.type === "tool_use");

      if (toolUses.length === 0) {
        // 没有工具调用，结束循环
        break;
      }

      // 执行所有工具调用
      const toolResults = [];
      for (const toolUse of toolUses) {
        const result = await this.executeTool(toolUse.name, toolUse.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result
        });
      }

      // 添加工具结果到历史
      this.messages.push({
        role: "user",  // 工具结果作为 user 消息
        content: toolResults
      });

      // 继续循环，让 Claude 处理工具结果
    }

    return this.messages[this.messages.length - 1];  // 返回最后的助手消息
  }
}
```

**消息结构示例**:
```javascript
// 真实对话历史
[
  // Turn 1
  { role: "user", content: "Read the README file" },
  {
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_123",
        name: "Read",
        input: { file_path: "README.md" }
      }
    ]
  },

  // Turn 2
  {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "toolu_123",
        content: "# My Project\nThis is a test."
      }
    ]
  },

  // Turn 3
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "The README file contains information about 'My Project'..."
      }
    ]
  }
]
```

### 2. Mock SDK 的简化实现

Mock SDK **完全省略了 agentic loop**，只是简单的消息转发：

#### 简化流程

```
1. 用户输入
   ↓
2. Mock 生成假响应
   ↓
3. 直接返回 (没有工具调用循环)
```

#### Mock SDK 实现 (mock-sdk/src/index.ts)

```typescript
class MockConversationEngine {
  private readonly history: string[] = [];

  // 极度简化：只是拼接字符串，没有真正的对话循环
  generateResponse(prompt: string): string {
    this.history.push(prompt);
    const prefix = `Mock response #${this.history.length}`;
    return `${prefix}: ${prompt}`;  // 假响应
  }
}

class Query {
  private async processPrompt(text: string): Promise<void> {
    // ❌ 没有调用真实 API
    // ❌ 没有工具调用循环
    // ❌ 没有消息历史管理

    // 只是生成假响应
    this.pushResult(text);
  }

  private pushResult(sourceText: string): void {
    const assistantText = this.engine.generateResponse(sourceText);

    // 直接返回一个结果，没有循环
    this.stream.enqueue({
      type: "result",
      message: {
        role: "assistant",
        content: [{ type: "text", text: assistantText }]
      }
    });

    this.stream.enqueue({ type: "done", reason: "completed" });
  }
}
```

### 3. 关键差异对比

| 特性 | 真实 SDK (CLI) | Mock SDK |
|------|---------------|----------|
| **Agentic Loop** | ✅ 完整实现 | ❌ 没有 |
| **工具调用** | ✅ 真实执行 (Read, Write, Bash 等) | ❌ 只注册，不执行 |
| **消息历史** | ✅ 维护完整对话历史 | ❌ 只存储 prompt 字符串 |
| **API 调用** | ✅ 调用 Anthropic Messages API | ❌ 生成假响应 |
| **tool_use blocks** | ✅ 解析和处理 | ❌ 不生成 |
| **tool_result blocks** | ✅ 构建并发送回 API | ❌ 不处理 |
| **多轮对话** | ✅ 支持 Claude 多次调用工具 | ❌ 单次响应 |
| **流式输出** | ✅ 真实流式 API | ✅ 模拟流式 (AsyncIterator) |
| **权限检查** | ✅ canUseTool 回调 | ✅ 模拟权限检查 |
| **Hooks** | ✅ 完整 hook 系统 | ✅ 模拟 hook 触发 |
| **MCP Servers** | ✅ 真实 MCP 通信 | ✅ 模拟 MCP 通信 |

### 4. 为什么 Mock SDK 不实现 Agentic Loop？

#### 设计目标不同

**真实 SDK**:
- 生产环境使用
- 调用真实 Anthropic API
- 完整的 AI agent 功能
- 费用产生（API 调用）

**Mock SDK**:
- **测试和开发用途**
- 不调用任何外部 API
- 模拟基本消息流
- 零费用

#### Mock SDK 的用途

```typescript
// 测试 SDK 集成
test("should handle query correctly", async () => {
  const result = query({
    prompt: "Hello",
    options: { model: "test" }
  });

  for await (const msg of result) {
    // 验证消息格式
    expect(msg.type).toBe("result");
    expect(msg.message.role).toBe("assistant");
  }
});

// 测试 MCP Server 注册
test("should register MCP tools", async () => {
  const server = createSdkMcpServer({
    name: "test",
    tools: [myTool]
  });

  const tools = server.instance.listTools();
  expect(tools).toContain("myTool");
});
```

### 5. 如果要实现真正的 Agentic Loop？

如果需要在 Mock SDK 中实现真正的 agentic loop，需要：

#### 步骤 1: 添加 Anthropic API 客户端

```typescript
import Anthropic from '@anthropic-ai/sdk';

class RealConversationEngine {
  private client: Anthropic;
  private messages: Anthropic.MessageParam[] = [];

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async runAgenticLoop(
    userPrompt: string,
    tools: ToolDefinition[]
  ): AsyncIterator<QueryMessage> {
    // 添加用户消息
    this.messages.push({
      role: "user",
      content: userPrompt
    });

    while (true) {
      // 调用真实 API
      const response = await this.client.messages.create({
        model: "claude-3-5-sonnet-20241022",
        messages: this.messages,
        tools: this.convertToolsToAnthropicFormat(tools),
        stream: true
      });

      const contentBlocks = [];
      for await (const chunk of response) {
        // 处理流式响应
        if (chunk.type === "content_block_delta") {
          contentBlocks.push(chunk.delta);
          yield { type: "partial", content: chunk.delta };
        }
      }

      // 添加助手响应到历史
      this.messages.push({
        role: "assistant",
        content: contentBlocks
      });

      // 检查工具调用
      const toolUses = contentBlocks.filter(b => b.type === "tool_use");

      if (toolUses.length === 0) {
        // 没有工具调用，结束
        yield { type: "done", reason: "completed" };
        break;
      }

      // 执行工具
      const toolResults = await this.executeTools(toolUses, tools);

      // 添加工具结果
      this.messages.push({
        role: "user",
        content: toolResults.map(r => ({
          type: "tool_result",
          tool_use_id: r.id,
          content: r.result
        }))
      });

      // 继续循环
    }
  }

  private async executeTools(
    toolUses: ToolUse[],
    availableTools: ToolDefinition[]
  ) {
    return Promise.all(
      toolUses.map(async (toolUse) => {
        const tool = availableTools.find(t => t.name === toolUse.name);
        if (!tool) {
          throw new Error(`Tool not found: ${toolUse.name}`);
        }

        const result = await tool.handler(toolUse.input, {
          signal: new AbortController().signal,
          toolName: toolUse.name
        });

        return {
          id: toolUse.id,
          result: result.content[0].text
        };
      })
    );
  }
}
```

#### 步骤 2: 集成到 Query 类

```typescript
export class Query {
  private engine: RealConversationEngine;

  constructor(prompt: string, options: QueryOptions) {
    this.engine = new RealConversationEngine(options.apiKey);

    // 启动真正的 agentic loop
    this.startAgenticLoop(prompt, options.tools);
  }

  private async startAgenticLoop(
    prompt: string,
    tools: ToolDefinition[]
  ) {
    try {
      for await (const message of this.engine.runAgenticLoop(prompt, tools)) {
        this.stream.enqueue(message);
      }
    } catch (error) {
      this.stream.fail(error);
    }
  }
}
```

#### 步骤 3: 工具调用示例

```typescript
// 用户请求
query({
  prompt: "Read README.md and summarize it",
  options: {
    apiKey: "sk-ant-...",
    tools: [DocumentReadTool]
  }
});

// 实际执行流程：
// 1. User: "Read README.md and summarize it"
// 2. Claude: [tool_use: document_read(path="/README.md")]
// 3. Tool executes → returns file content
// 4. User: [tool_result: "# My Project\n..."]
// 5. Claude: "The README describes a project that..."
```

### 6. 消息流对比示例

#### 真实 SDK 的消息流

```
User Query: "Create a new file called test.txt with 'Hello World'"

→ Turn 1
  User: "Create a new file called test.txt with 'Hello World'"

  Claude API Call #1 →
  ← Claude Response:
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_abc123",
          name: "Write",
          input: {
            file_path: "test.txt",
            content: "Hello World"
          }
        }
      ]
    }

→ Turn 2
  Execute Tool: Write("test.txt", "Hello World")
  Result: "File created successfully"

  User: {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "toolu_abc123",
        content: "File created successfully"
      }
    ]
  }

  Claude API Call #2 →
  ← Claude Response:
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I've created the file test.txt with the content 'Hello World'."
        }
      ]
    }

→ Turn 3 (Final)
  Return to user: "I've created the file test.txt with the content 'Hello World'."
```

#### Mock SDK 的消息流

```
User Query: "Create a new file called test.txt with 'Hello World'"

→ Single Turn
  Mock Response Generation:
  "Mock response #1: Create a new file called test.txt with 'Hello World'"

  Return to user immediately
  (No tool execution, no API call, no agentic loop)
```

### 7. 总结

#### Mock SDK 的定位

Mock SDK 是一个**测试工具**，而不是完整的 Agent 实现：

✅ **Mock SDK 能做的**:
- 测试 SDK API 接口
- 测试 MCP Server 注册
- 测试流式消息处理
- 测试 Hook 系统
- 测试权限回调
- 开发时无需 API key

❌ **Mock SDK 不能做的**:
- 真正的 AI 对话
- 真正的工具调用循环
- 真正的多轮对话
- 基于 LLM 的决策
- 调用 Anthropic API

#### 使用场景

**使用 Mock SDK**:
- 单元测试
- 集成测试
- SDK API 开发
- 文档示例
- 不需要真实 AI 响应

**使用真实 SDK**:
- 生产环境
- 真实 AI 交互
- 工具调用功能
- 复杂 agent 场景
- 需要 LLM 决策

#### 如何升级

如果需要从 Mock 升级到真实实现：

1. **引入 Anthropic SDK**: `npm install @anthropic-ai/sdk`
2. **实现 ConversationEngine**: 替换 MockConversationEngine
3. **实现工具执行**: 真正执行工具而不是 mock
4. **维护消息历史**: 完整的 MessageParam[] 数组
5. **实现循环逻辑**: while loop 检查 tool_use blocks
6. **处理流式响应**: 正确处理 Anthropic stream events

参考真实 SDK 的 CLI 实现 (cli.js) 了解完整细节。
