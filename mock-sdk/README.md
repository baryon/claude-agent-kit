# Claude Agent SDK - Web Environment with Full Agentic Loop

Web 环境的 Claude Agent SDK，支持**完整的 Agentic Loop** 实现。

## 特性

✅ **多模型支持**
- 支持 Anthropic Claude
- 支持 OpenAI GPT
- 支持 Google Gemini
- 统一的接口，自由切换

✅ **完整的 Agentic Loop**
- 真实的 API 调用
- 多轮对话循环
- 工具调用和执行
- 流式响应处理

✅ **Web 环境工具**
- 数据库替代文件系统
- document_read, document_write, document_search
- 支持代码执行沙盒

✅ **生产就绪**
- TypeScript 类型安全
- 完整的错误处理
- Token 使用统计
- 对话历史管理

## 安装

```bash
cd mock-sdk
npm install
npm run build
```

## 快速开始

### 1. 设置 API Key

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### 2. 简单示例

#### 使用 Anthropic Claude

```typescript
import {
  AgenticEngine,
  WEB_TOOLS,
  getMockDatabase,
  getWebToolsSystemPrompt
} from '@claude-agent-kit/web-sdk';

// 准备数据库
const db = getMockDatabase();
await db.write('/notes.txt', 'Meeting at 2pm\nBuy groceries', 'text');

// 创建 Agent 引擎
const engine = new AgenticEngine({
  apiKey: process.env.ANTHROPIC_API_KEY,
  systemPrompt: getWebToolsSystemPrompt()
});

// 运行 Agentic Loop
for await (const message of engine.runAgenticLoop(
  'Read notes.txt and create a checklist',
  WEB_TOOLS
)) {
  if (message.type === 'assistant') {
    console.log('Agent:', message.content);
  }
}
```

#### 使用多模型引擎（支持 OpenAI、Gemini）

```typescript
import {
  MultiModelEngine,
  WEB_TOOLS,
  getWebToolsSystemPrompt
} from '@claude-agent-kit/web-sdk';

// 使用 OpenAI
const engine = new MultiModelEngine({
  provider: 'openai',
  openaiApiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4-turbo-preview',
  systemPrompt: getWebToolsSystemPrompt()
});

// 或使用 Gemini
const engine2 = new MultiModelEngine({
  provider: 'gemini',
  geminiApiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-pro',
  systemPrompt: getWebToolsSystemPrompt()
});

// API 完全相同
for await (const msg of engine.runAgenticLoop('Your task', WEB_TOOLS)) {
  console.log(msg);
}
```

### 3. 运行示例

```bash
# 简单示例
npm run build
node examples/simple-agent.js

# 完整示例（展示所有功能）
node examples/agentic-loop-example.js
```

## 完整的 Agentic Loop

### 工作原理

```
1. User Prompt → Claude API
   ↓
2. Claude 返回 tool_use blocks
   ↓
3. 执行工具 (document_read, document_write, etc.)
   ↓
4. Tool Results → Claude API
   ↓
5. Claude 处理结果并继续或结束
   ↓
6. 重复 2-5 直到完成（最多 maxTurns 轮）
```

### 消息流示例

```
User: "Read README.md and summarize it"

Turn 1:
  Assistant: [tool_use: document_read(path="/README.md")]
  Tool Result: "# My Project\nThis is a test..."

Turn 2:
  Assistant: "The README describes a project that..."
  [完成 - 没有更多 tool_use]
```

### AgenticEngine API

```typescript
class AgenticEngine {
  constructor(options: {
    apiKey: string;           // Anthropic API key (必需)
    model?: string;           // 模型名称 (默认: claude-3-5-sonnet-20241022)
    maxTurns?: number;        // 最大轮次 (默认: 10)
    maxTokens?: number;       // 每次最大 tokens (默认: 4096)
    temperature?: number;     // 温度 (默认: 1.0)
    systemPrompt?: string;    // 系统提示
  });

  // 运行 Agentic Loop
  runAgenticLoop(
    userPrompt: string,
    tools: ToolDefinition[]
  ): AsyncGenerator<QueryMessage>;

  // 获取对话历史
  getConversationHistory(): MessageParam[];

  // 获取当前轮次
  getCurrentTurn(): number;

  // 获取 Token 使用量
  getTokenUsage(): {
    input: number;
    output: number;
    total: number;
  };

  // 中止当前操作
  abort(): void;
}
```

### 消息类型

Agentic Loop 会 yield 以下类型的消息：

```typescript
// 用户消息
{
  type: "user",
  content: string
}

// 助手消息（可能包含 tool_use）
{
  type: "assistant",
  content: ContentBlock[]  // text 或 tool_use blocks
}

// 工具执行结果
{
  type: "tool_result",
  tool_use_id: string,
  content: string,
  is_error: boolean
}

// 错误
{
  type: "error",
  error: string
}

// 完成
{
  type: "done",
  reason: "completed" | "max_turns",
  numTurns: number,
  totalTokens: {
    input: number,
    output: number
  }
}
```

## Web 工具

### 可用工具

| 工具名 | 描述 | 替代的 CLI 工具 |
|--------|------|----------------|
| document_read | 从数据库读取文档 | Read |
| document_write | 写入/更新文档 | Write, Edit |
| document_search | 全文搜索 | Grep |
| document_list | 列出文档 | Glob |
| code_execute | 沙盒代码执行 | Bash |

### document_read

```typescript
{
  name: "document_read",
  description: "Read a document from the database",
  input: {
    path: string  // 文档路径，如 "/project/README.md"
  }
}
```

### document_write

```typescript
{
  name: "document_write",
  description: "Create or update a document",
  input: {
    path: string,      // 文档路径
    content: string,   // 文档内容
    type?: string      // 类型: text, code, markdown, json
  }
}
```

### document_search

```typescript
{
  name: "document_search",
  description: "Search documents by content",
  input: {
    query: string  // 搜索关键词
  }
}
```

### document_list

```typescript
{
  name: "document_list",
  description: "List all documents",
  input: {
    path_prefix?: string  // 可选的路径前缀
  }
}
```

## 完整示例

### 复杂的多步骤任务

```typescript
import {
  AgenticEngine,
  WEB_TOOLS,
  getMockDatabase,
  getWebToolsSystemPrompt
} from '@claude-agent-kit/web-sdk';

async function complexTask() {
  // 1. 准备数据库
  const db = getMockDatabase();
  await db.write('/data.json', JSON.stringify({
    users: [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 }
    ]
  }), 'json');

  // 2. 创建引擎
  const engine = new AgenticEngine({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-3-5-sonnet-20241022',
    maxTurns: 15,
    systemPrompt: getWebToolsSystemPrompt()
  });

  // 3. 复杂的多步骤提示
  const prompt = `Please do the following:
1. Read data.json and understand the structure
2. Search for all documents containing "user"
3. Create a report.md summarizing what you found
4. List all files in the database`;

  // 4. 运行并跟踪进度
  let turnCount = 0;

  for await (const msg of engine.runAgenticLoop(prompt, WEB_TOOLS)) {
    switch (msg.type) {
      case 'assistant':
        turnCount++;
        console.log(`\nTurn ${turnCount}:`);

        for (const block of msg.content) {
          if (block.type === 'text') {
            console.log('💬', block.text);
          } else if (block.type === 'tool_use') {
            console.log('🔧', block.name, block.input);
          }
        }
        break;

      case 'tool_result':
        console.log('✅ Tool completed:', msg.tool_use_id);
        break;

      case 'done':
        console.log(`\n✨ Completed in ${msg.numTurns} turns`);
        console.log(`📊 Tokens: ${msg.totalTokens?.total}`);
        break;
    }
  }

  // 5. 查看创建的报告
  const report = await db.read('/report.md');
  if (report) {
    console.log('\n📄 Generated Report:');
    console.log(report.content);
  }

  // 6. 显示统计
  const usage = engine.getTokenUsage();
  console.log('\n💰 Cost Estimate:');
  const cost = (usage.input / 1_000_000) * 3.0 +
               (usage.output / 1_000_000) * 15.0;
  console.log(`   $${cost.toFixed(6)}`);
}

complexTask().catch(console.error);
```

## 与真实数据库集成

在生产环境中，替换 `MockDocumentDatabase` 为真实数据库：

```typescript
// PostgreSQL 实现
import { Pool } from 'pg';

class PostgresDocumentDatabase {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async read(path: string) {
    const { rows } = await this.pool.query(
      'SELECT * FROM documents WHERE path = $1',
      [path]
    );
    return rows[0] || null;
  }

  async write(path: string, content: string, type: string) {
    const { rows } = await this.pool.query(`
      INSERT INTO documents (path, content, type)
      VALUES ($1, $2, $3)
      ON CONFLICT (path) DO UPDATE
      SET content = $2, type = $3, updated_at = NOW()
      RETURNING *
    `, [path, content, type]);
    return rows[0];
  }

  async search(query: string) {
    const { rows } = await this.pool.query(`
      SELECT * FROM documents
      WHERE to_tsvector('english', content) @@
            plainto_tsquery('english', $1)
      ORDER BY ts_rank(
        to_tsvector('english', content),
        plainto_tsquery('english', $1)
      ) DESC
    `, [query]);
    return rows;
  }

  async list(pathPrefix?: string) {
    if (pathPrefix) {
      const { rows } = await this.pool.query(
        'SELECT * FROM documents WHERE path LIKE $1',
        [pathPrefix + '%']
      );
      return rows;
    }
    const { rows } = await this.pool.query('SELECT * FROM documents');
    return rows;
  }
}

// 使用真实数据库
const db = new PostgresDocumentDatabase(process.env.DATABASE_URL);

// 将工具处理函数更新为使用真实数据库
const realDocumentReadTool = {
  ...DocumentReadTool,
  handler: async (input, ctx) => {
    const doc = await db.read(input.path);
    if (!doc) {
      return {
        content: [{ type: "text", text: `Document not found: ${input.path}` }],
        isError: true
      };
    }
    return {
      content: [{ type: "text", text: doc.content }]
    };
  }
};
```

## 项目结构

```
mock-sdk/
├── src/
│   ├── index.ts              # 主入口
│   ├── agentic-engine.ts     # 完整 Agentic Loop 实现 ⭐
│   ├── web-tools.ts          # Web 环境工具
│   └── types.ts              # 类型定义
├── examples/
│   ├── simple-agent.ts       # 简单示例
│   └── agentic-loop-example.ts  # 完整功能演示
├── package.json
├── tsconfig.json
└── README.md
```

## 开发

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 构建
npm run build

# 类型检查
npm run typecheck
```

## 费用估算

使用 Claude 3.5 Sonnet 的定价：
- 输入: $3 / 1M tokens
- 输出: $15 / 1M tokens

示例成本：
- 简单任务（2-3 轮）: ~$0.001 - $0.005
- 复杂任务（5-10 轮）: ~$0.01 - $0.05

## 对比

### Mock SDK (旧版)
- ❌ 假响应生成
- ❌ 无真实 API 调用
- ❌ 无工具执行
- ✅ 零成本测试

### Web SDK with Agentic Loop (新版)
- ✅ 真实 Anthropic API
- ✅ 完整的 Agentic Loop
- ✅ 真实工具执行
- ✅ 多轮对话
- ✅ 生产就绪
- 💰 需要 API key 和费用

## 常见问题

### Q: 如何控制成本？

A: 使用 `maxTurns` 限制循环次数，使用 `maxTokens` 限制每次调用的 token 数量。

```typescript
const engine = new AgenticEngine({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxTurns: 5,      // 最多 5 轮对话
  maxTokens: 2048   // 每次最多 2048 tokens
});
```

### Q: 如何处理错误？

A: 监听 `error` 类型的消息：

```typescript
for await (const msg of engine.runAgenticLoop(prompt, tools)) {
  if (msg.type === 'error') {
    console.error('Error:', msg.error);
    // 处理错误
  }
}
```

### Q: 如何中止长时间运行的任务？

A: 调用 `engine.abort()`:

```typescript
const engine = new AgenticEngine({ apiKey });

// 设置超时
setTimeout(() => {
  engine.abort();
}, 30000);  // 30 秒后中止

for await (const msg of engine.runAgenticLoop(prompt, tools)) {
  // 处理消息
}
```

### Q: 如何查看完整的对话历史？

A: 使用 `getConversationHistory()`:

```typescript
const history = engine.getConversationHistory();
console.log('Total messages:', history.length);

for (const msg of history) {
  console.log(`${msg.role}:`, msg.content);
}
```

## 相关文档

- `docs/agentic-loop-explained.md` - Agentic Loop 原理详解
- `docs/mock-vs-real-agent-comparison.md` - Mock vs Real Agent 对比
- `docs/web-environment-tools.md` - Web 工具完整设计

## License

MIT
