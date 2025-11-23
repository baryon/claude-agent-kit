# Agentic Loop 详解 - 从类型定义反推实现

虽然 CLI 代码被混淆了，但我们可以从 TypeScript 类型定义 (`sdk.d.ts`) 来理解真实的 agentic loop 实现。

## 核心发现

### 1. 消息类型系统

从类型定义可以看到完整的消息流：

```typescript
// sdk.d.ts 行 251-276
type SDKUserMessageContent = {
  type: 'user';
  message: APIUserMessage;  // Anthropic API 的 UserMessage 格式
  parent_tool_use_id: string | null;  // 关键：追踪工具调用链
  isSynthetic?: boolean;  // 系统生成的消息（如 tool_result）
};

export type SDKAssistantMessage = SDKMessageBase & {
  type: 'assistant';
  message: APIAssistantMessage;  // Anthropic API 的 AssistantMessage
  parent_tool_use_id: string | null;
};
```

**关键点**：
- `parent_tool_use_id`: 用于追踪工具调用的层级关系
- `isSynthetic`: 区分真实用户输入和系统生成的 tool_result

### 2. Result Message 揭示循环机制

```typescript
// sdk.d.ts 行 282-309
export type SDKResultMessage = (SDKMessageBase & {
  type: 'result';
  subtype: 'success';
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;  // 🔑 关键：记录了循环的轮次数！
  result: string;
  total_cost_usd: number;
  usage: NonNullableUsage;
  modelUsage: {
    [modelName: string]: ModelUsage;  // 支持多个模型
  };
  permission_denials: SDKPermissionDenial[];  // 权限拒绝记录
});
```

**关键字段**：
- `num_turns`: 证明有循环，记录了执行了多少轮对话
- `modelUsage`: 按模型统计，说明可能切换模型
- `permission_denials`: 收集所有被拒绝的工具调用

### 3. Stream Events 揭示流式处理

```typescript
// sdk.d.ts 行 332-336
export type SDKPartialAssistantMessage = SDKMessageBase & {
  type: 'stream_event';
  event: RawMessageStreamEvent;  // Anthropic API 的 stream event
  parent_tool_use_id: string | null;
};
```

**说明**：使用 Anthropic 的流式 API，实时返回响应。

## 反推的 Agentic Loop 实现

基于这些类型定义，我们可以反推出真实的实现逻辑：

### 完整流程

```typescript
class ConversationEngine {
  private messages: APIUserMessage[] = [];  // Anthropic 消息历史
  private currentTurn: number = 0;
  private totalCost: number = 0;
  private modelUsage: Map<string, ModelUsage> = new Map();

  async runAgenticLoop(
    userPrompt: string,
    tools: ToolDefinition[],
    options: QueryOptions
  ): AsyncIterator<SDKMessage> {
    // Turn 1: 用户消息
    const userMessage: SDKUserMessage = {
      uuid: generateUUID(),
      session_id: this.sessionId,
      type: 'user',
      message: {
        role: 'user',
        content: userPrompt
      },
      parent_tool_use_id: null,
      isSynthetic: false  // 真实用户输入
    };

    this.messages.push(userMessage.message);
    yield userMessage;

    // 循环：直到 Claude 不再请求工具
    while (this.currentTurn < MAX_TURNS) {
      this.currentTurn++;

      // 调用 Anthropic API (流式)
      const stream = await this.anthropic.messages.create({
        model: options.model || 'claude-3-5-sonnet-20241022',
        messages: this.messages,
        tools: this.convertTools(tools),
        stream: true
      });

      const contentBlocks = [];
      let hasToolUse = false;

      // 流式处理响应
      for await (const event of stream) {
        // 实时发送流事件给应用层
        const streamEvent: SDKPartialAssistantMessage = {
          uuid: generateUUID(),
          session_id: this.sessionId,
          type: 'stream_event',
          event: event,
          parent_tool_use_id: null
        };
        yield streamEvent;

        // 收集 content blocks
        if (event.type === 'content_block_delta') {
          contentBlocks.push(event.delta);

          // 检查是否有 tool_use
          if (event.delta.type === 'tool_use') {
            hasToolUse = true;
          }
        }
      }

      // 完整的助手消息
      const assistantMessage: SDKAssistantMessage = {
        uuid: generateUUID(),
        session_id: this.sessionId,
        type: 'assistant',
        message: {
          role: 'assistant',
          content: contentBlocks
        },
        parent_tool_use_id: null
      };

      this.messages.push(assistantMessage.message);
      yield assistantMessage;

      // 统计使用量
      this.updateUsage(stream.usage);

      // 检查是否需要执行工具
      if (!hasToolUse) {
        // 没有工具调用，循环结束
        break;
      }

      // 提取所有 tool_use blocks
      const toolUses = contentBlocks.filter(
        block => block.type === 'tool_use'
      );

      // 执行所有工具
      const toolResults = await this.executeTools(toolUses, tools);

      // 构建 tool_result 消息（synthetic user message）
      const toolResultMessage: SDKUserMessage = {
        uuid: generateUUID(),
        session_id: this.sessionId,
        type: 'user',
        message: {
          role: 'user',
          content: toolResults.map(result => ({
            type: 'tool_result',
            tool_use_id: result.tool_use_id,
            content: result.content,
            is_error: result.is_error
          }))
        },
        parent_tool_use_id: toolUses[0].id,  // 追踪父工具
        isSynthetic: true  // 标记为系统生成
      };

      this.messages.push(toolResultMessage.message);
      yield toolResultMessage;

      // 继续循环，让 Claude 处理工具结果
    }

    // 返回最终结果
    const resultMessage: SDKResultMessage = {
      uuid: generateUUID(),
      session_id: this.sessionId,
      type: 'result',
      subtype: 'success',
      duration_ms: this.totalDuration,
      duration_api_ms: this.apiDuration,
      is_error: false,
      num_turns: this.currentTurn,  // 总轮次
      result: this.extractFinalResult(),
      total_cost_usd: this.totalCost,
      usage: this.totalUsage,
      modelUsage: Object.fromEntries(this.modelUsage),
      permission_denials: this.permissionDenials
    };

    yield resultMessage;
  }

  private async executeTools(
    toolUses: ToolUse[],
    availableTools: ToolDefinition[]
  ): Promise<ToolResult[]> {
    return Promise.all(
      toolUses.map(async (toolUse) => {
        try {
          // 1. 权限检查
          const permission = await this.checkPermission(
            toolUse.name,
            toolUse.input
          );

          if (permission.behavior === 'deny') {
            // 记录拒绝
            this.permissionDenials.push({
              tool_name: toolUse.name,
              tool_use_id: toolUse.id,
              tool_input: toolUse.input
            });

            return {
              tool_use_id: toolUse.id,
              content: permission.message,
              is_error: true
            };
          }

          // 2. 查找工具
          const tool = availableTools.find(t => t.name === toolUse.name);
          if (!tool) {
            throw new Error(`Tool not found: ${toolUse.name}`);
          }

          // 3. 执行工具
          const result = await tool.handler(
            permission.updatedInput || toolUse.input,
            {
              signal: this.abortSignal,
              toolName: toolUse.name
            }
          );

          // 4. 返回结果
          return {
            tool_use_id: toolUse.id,
            content: result.content[0].text,
            is_error: result.isError || false
          };
        } catch (error) {
          return {
            tool_use_id: toolUse.id,
            content: error.message,
            is_error: true
          };
        }
      })
    );
  }

  private async checkPermission(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<PermissionResult> {
    if (this.canUseTool) {
      return await this.canUseTool(toolName, input, {
        signal: this.abortSignal,
        suggestions: this.generatePermissionSuggestions(toolName, input)
      });
    }

    // 默认允许
    return {
      behavior: 'allow',
      updatedInput: input
    };
  }
}
```

## 实际消息流示例

### 示例：读取文件并总结

```
用户输入: "Read README.md and summarize it"

══════════════════════════════════════════════════
Turn 1: User Message
══════════════════════════════════════════════════
{
  type: "user",
  message: {
    role: "user",
    content: "Read README.md and summarize it"
  },
  parent_tool_use_id: null,
  isSynthetic: false
}

↓ 调用 Anthropic API

══════════════════════════════════════════════════
Turn 2: Assistant Message (with tool_use)
══════════════════════════════════════════════════
[Stream Events]
{
  type: "stream_event",
  event: { type: "content_block_start", index: 0 }
}
{
  type: "stream_event",
  event: {
    type: "content_block_delta",
    delta: {
      type: "tool_use",
      id: "toolu_abc123",
      name: "Read",
      input: { file_path: "README.md" }
    }
  }
}

[Final Assistant Message]
{
  type: "assistant",
  message: {
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_abc123",
        name: "Read",
        input: { file_path: "README.md" }
      }
    ]
  },
  parent_tool_use_id: null
}

↓ 执行工具: Read("README.md")

══════════════════════════════════════════════════
Turn 3: Tool Result (Synthetic User Message)
══════════════════════════════════════════════════
{
  type: "user",
  message: {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "toolu_abc123",
        content: "# My Project\n\nThis is a test project for...",
        is_error: false
      }
    ]
  },
  parent_tool_use_id: "toolu_abc123",  // 追踪父工具
  isSynthetic: true  // 系统生成的消息
}

↓ 再次调用 Anthropic API

══════════════════════════════════════════════════
Turn 4: Final Assistant Message (no tool_use)
══════════════════════════════════════════════════
[Stream Events]
{
  type: "stream_event",
  event: {
    type: "content_block_delta",
    delta: {
      type: "text",
      text: "Based on the README..."
    }
  }
}

[Final Assistant Message]
{
  type: "assistant",
  message: {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Based on the README, this project is a test project that..."
      }
    ]
  },
  parent_tool_use_id: null
}

↓ 没有 tool_use，循环结束

══════════════════════════════════════════════════
Result Message
══════════════════════════════════════════════════
{
  type: "result",
  subtype: "success",
  duration_ms: 2543,
  duration_api_ms: 2100,
  is_error: false,
  num_turns: 2,  // 两轮 API 调用
  result: "Based on the README, this project is...",
  total_cost_usd: 0.0042,
  usage: {
    input_tokens: 1250,
    output_tokens: 180,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0
  },
  modelUsage: {
    "claude-3-5-sonnet-20241022": {
      inputTokens: 1250,
      outputTokens: 180,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      webSearchRequests: 0,
      costUSD: 0.0042,
      contextWindow: 200000
    }
  },
  permission_denials: []
}
```

## 关键实现细节

### 1. 消息历史管理

真实 SDK 维护**完整的 Anthropic API 消息数组**：

```typescript
messages: APIUserMessage[] = [
  // Turn 1
  {
    role: "user",
    content: "Read README.md and summarize it"
  },

  // Turn 2
  {
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_abc123",
        name: "Read",
        input: { file_path: "README.md" }
      }
    ]
  },

  // Turn 3
  {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "toolu_abc123",
        content: "# My Project\n..."
      }
    ]
  },

  // Turn 4
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Based on the README..."
      }
    ]
  }
]
```

### 2. 权限系统

从类型定义可以看到复杂的权限系统：

```typescript
export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];  // CLI 提供的建议
  }
) => Promise<PermissionResult>;

export type PermissionResult =
  | {
      behavior: 'allow';
      updatedInput: Record<string, unknown>;  // 可以修改输入
      updatedPermissions?: PermissionUpdate[];  // 可以更新权限规则
    }
  | {
      behavior: 'deny';
      message: string;  // 拒绝原因
      interrupt?: boolean;  // 是否中断整个会话
    };
```

**流程**：
1. CLI 调用 `canUseTool` 回调（如果提供）
2. 回调可以：
   - 允许并可选修改输入
   - 允许并更新权限规则（"总是允许"）
   - 拒绝并提供原因
   - 拒绝并中断会话

### 3. Hook 系统

从类型定义看到完整的 Hook 生命周期：

```typescript
// 工具调用前
export type PreToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: unknown;
};

// 工具调用后
export type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;  // 工具的返回结果
};
```

**Hook 可以影响执行**：

```typescript
export type SyncHookJSONOutput = {
  continue?: boolean;  // 是否继续
  suppressOutput?: boolean;  // 是否隐藏输出
  stopReason?: string;  // 停止原因
  decision?: 'approve' | 'block';  // 批准或阻止
  systemMessage?: string;  // 添加系统消息
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse';
    permissionDecision?: 'allow' | 'deny' | 'ask';  // Hook 可以做权限决策
    updatedInput?: Record<string, unknown>;  // Hook 可以修改输入
  };
};
```

### 4. 多轮次限制

从类型定义可以看到错误处理：

```typescript
export type SDKResultMessage =
  | {
      subtype: 'success';
      num_turns: number;
      // ...
    }
  | {
      subtype: 'error_max_turns';  // 达到最大轮次
      num_turns: number;
      // ...
    }
  | {
      subtype: 'error_during_execution';  // 执行错误
      // ...
    };
```

说明有 `MAX_TURNS` 限制，防止无限循环。

## 与 Mock SDK 的对比

| 特性 | 真实 SDK（反推） | Mock SDK |
|------|----------------|----------|
| 消息历史 | ✅ 完整 `APIUserMessage[]` | ❌ 只有字符串数组 |
| API 调用 | ✅ `anthropic.messages.create()` | ❌ Mock 响应 |
| tool_use | ✅ 解析并执行 | ❌ 不生成 |
| tool_result | ✅ 构建并发送 | ❌ 不处理 |
| 循环 | ✅ `while` loop + `num_turns` | ❌ 单次响应 |
| 流式输出 | ✅ `stream: true` + events | ✅ 模拟 AsyncIterator |
| 权限系统 | ✅ 完整 `CanUseTool` + suggestions | ✅ 基础回调 |
| Hook 系统 | ✅ Pre/Post + 影响执行 | ✅ 基础触发 |
| 错误处理 | ✅ 多种错误类型 | ❌ 简单错误 |
| 使用统计 | ✅ 按模型统计 + 费用 | ❌ 模拟 tokens |

## 总结

通过分析 TypeScript 类型定义，我们可以确认：

### 真实 SDK 的 Agentic Loop 包含：

1. **完整的消息历史管理**：维护 Anthropic API 格式的消息数组
2. **真实的 API 循环**：while loop 调用 `anthropic.messages.create()`
3. **工具调用链**：`parent_tool_use_id` 追踪层级关系
4. **Synthetic 消息**：区分用户输入和系统生成的 tool_result
5. **流式处理**：实时发送 `stream_event`
6. **权限系统**：复杂的 `CanUseTool` + `PermissionUpdate`
7. **Hook 系统**：Pre/Post hooks 可以影响执行
8. **使用统计**：`num_turns`, `modelUsage`, `total_cost_usd`
9. **错误处理**：`error_max_turns`, `error_during_execution`

### Mock SDK 只是测试工具：

- 模拟基本的消息流
- 不实现真正的 agentic loop
- 用于测试 SDK API 接口
- 零成本、零依赖

如果需要真正的 Agent 功能，必须使用真实的 `@anthropic-ai/claude-agent-sdk` 并提供 Anthropic API key。
