# 多模型支持 - 使用任意 LLM

SDK 支持多种 LLM 提供商，让你可以在 Anthropic Claude、OpenAI GPT 和 Google Gemini 之间自由切换。

## 支持的模型

### 1. Anthropic Claude

**推荐模型**:
- `claude-3-5-sonnet-20241022` (最新，最强)
- `claude-3-opus-20240229` (最强大)
- `claude-3-sonnet-20240229` (平衡)
- `claude-3-haiku-20240307` (最快，最便宜)

**特性**:
- ✅ 原生工具调用支持
- ✅ 流式响应
- ✅ 200K token 上下文窗口
- ✅ 最佳的工具调用质量

### 2. OpenAI GPT

**推荐模型**:
- `gpt-4-turbo-preview` (最新 GPT-4)
- `gpt-4-1106-preview` (GPT-4 Turbo)
- `gpt-4` (标准 GPT-4)
- `gpt-3.5-turbo` (快速且便宜)

**特性**:
- ✅ Function calling 支持
- ✅ 流式响应
- ✅ 128K token 上下文窗口
- ✅ 广泛使用和测试

### 3. Google Gemini

**推荐模型**:
- `gemini-pro` (标准模型)
- `gemini-pro-vision` (支持图像)

**特性**:
- ✅ Function calling 支持
- ✅ 32K token 上下文窗口
- ✅ 免费额度（有限制）

## 快速开始

### 安装依赖

```bash
cd mock-sdk

# 基础依赖（包含 Anthropic）
npm install

# 如果需要 OpenAI
npm install openai

# 如果需要 Gemini
npm install @google/generative-ai
```

### 设置 API Key

```bash
# Anthropic
export ANTHROPIC_API_KEY=sk-ant-api03-...

# OpenAI
export OPENAI_API_KEY=sk-...

# Google Gemini
export GEMINI_API_KEY=...
```

### 基础用法

```typescript
import {
  MultiModelEngine,
  WEB_TOOLS,
  getMockDatabase,
  getWebToolsSystemPrompt
} from './mock-sdk';

// 选择你的提供商
const engine = new MultiModelEngine({
  provider: 'anthropic',  // 或 'openai' 或 'gemini'
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-5-sonnet-20241022',
  systemPrompt: getWebToolsSystemPrompt()
});

// 使用方式完全相同
for await (const msg of engine.runAgenticLoop(
  'Your task here',
  WEB_TOOLS
)) {
  console.log(msg);
}
```

## 详细示例

### 使用 Anthropic Claude

```typescript
const engine = new MultiModelEngine({
  provider: 'anthropic',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-5-sonnet-20241022',
  maxTurns: 10,
  maxTokens: 4096,
  temperature: 1.0,
  systemPrompt: getWebToolsSystemPrompt()
});

const db = getMockDatabase();
await db.write('/task.txt', 'Build a REST API', 'text');

for await (const msg of engine.runAgenticLoop(
  'Read task.txt and create a plan',
  WEB_TOOLS
)) {
  if (msg.type === 'assistant') {
    console.log('Claude:', msg.content);
  }
}
```

### 使用 OpenAI GPT

```typescript
const engine = new MultiModelEngine({
  provider: 'openai',
  openaiApiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4-turbo-preview',
  maxTurns: 10,
  maxTokens: 4096,
  temperature: 0.7,
  systemPrompt: getWebToolsSystemPrompt()
});

for await (const msg of engine.runAgenticLoop(
  'Analyze the codebase',
  WEB_TOOLS
)) {
  if (msg.type === 'assistant') {
    console.log('GPT-4:', msg.content);
  }
}
```

### 使用 Google Gemini

```typescript
const engine = new MultiModelEngine({
  provider: 'gemini',
  geminiApiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-pro',
  maxTurns: 10,
  maxTokens: 2048,
  temperature: 0.9,
  systemPrompt: getWebToolsSystemPrompt()
});

for await (const msg of engine.runAgenticLoop(
  'Summarize the documentation',
  WEB_TOOLS
)) {
  if (msg.type === 'assistant') {
    console.log('Gemini:', msg.content);
  }
}
```

## 对比不同提供商

### 运行多模型测试

```typescript
import { MultiModelEngine, WEB_TOOLS, getWebToolsSystemPrompt } from './mock-sdk';

async function compareProviders() {
  const task = 'Read README.md and summarize in 3 bullet points';
  const providers = [
    {
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-sonnet-20241022'
    },
    {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4-turbo-preview'
    },
    {
      provider: 'gemini',
      apiKey: process.env.GEMINI_API_KEY,
      model: 'gemini-pro'
    }
  ];

  for (const config of providers) {
    console.log(`\nTesting ${config.provider}...`);

    const engine = new MultiModelEngine({
      provider: config.provider as any,
      [`${config.provider}ApiKey`]: config.apiKey,
      model: config.model,
      systemPrompt: getWebToolsSystemPrompt()
    });

    const startTime = Date.now();

    for await (const msg of engine.runAgenticLoop(task, WEB_TOOLS)) {
      if (msg.type === 'done') {
        const duration = Date.now() - startTime;
        const usage = engine.getTokenUsage();

        console.log(`Provider: ${config.provider}`);
        console.log(`Model: ${config.model}`);
        console.log(`Turns: ${msg.numTurns}`);
        console.log(`Tokens: ${usage.total}`);
        console.log(`Duration: ${duration}ms`);
      }
    }
  }
}

compareProviders().catch(console.error);
```

## API 接口

### MultiModelEngine

```typescript
class MultiModelEngine {
  constructor(options: {
    // 提供商选择（必需）
    provider: 'anthropic' | 'openai' | 'gemini';

    // API Keys（根据 provider 选择其中一个）
    anthropicApiKey?: string;
    openaiApiKey?: string;
    geminiApiKey?: string;

    // 模型名称（可选，有默认值）
    model?: string;

    // 通用选项
    maxTurns?: number;        // 默认: 10
    maxTokens?: number;       // 默认: 4096
    temperature?: number;     // 默认: 1.0
    systemPrompt?: string;
  });

  // 运行 Agentic Loop（接口统一）
  runAgenticLoop(
    userPrompt: string,
    tools: ToolDefinition[]
  ): AsyncGenerator<QueryMessage>;

  // 获取对话历史（格式统一）
  getConversationHistory(): UnifiedMessage[];

  // 获取 Token 使用量（格式统一）
  getTokenUsage(): {
    input: number;
    output: number;
    total: number;
  };

  // 中止操作
  abort(): void;
}
```

## 价格对比

### 输入 Token 成本（每 1M tokens）

| 提供商 | 模型 | 价格 |
|--------|------|------|
| Anthropic | Claude 3.5 Sonnet | $3.00 |
| Anthropic | Claude 3 Opus | $15.00 |
| Anthropic | Claude 3 Haiku | $0.25 |
| OpenAI | GPT-4 Turbo | $10.00 |
| OpenAI | GPT-3.5 Turbo | $0.50 |
| Google | Gemini Pro | 免费* |

### 输出 Token 成本（每 1M tokens）

| 提供商 | 模型 | 价格 |
|--------|------|------|
| Anthropic | Claude 3.5 Sonnet | $15.00 |
| Anthropic | Claude 3 Opus | $75.00 |
| Anthropic | Claude 3 Haiku | $1.25 |
| OpenAI | GPT-4 Turbo | $30.00 |
| OpenAI | GPT-3.5 Turbo | $1.50 |
| Google | Gemini Pro | 免费* |

*Gemini Pro 有免费额度限制

### 成本示例（1000 次请求，平均每次 2K input + 1K output tokens）

| 提供商 | 模型 | 总成本 |
|--------|------|--------|
| Anthropic | Claude 3.5 Sonnet | $21.00 |
| OpenAI | GPT-4 Turbo | $50.00 |
| OpenAI | GPT-3.5 Turbo | $2.50 |
| Google | Gemini Pro | $0.00 |

## 性能对比

基于实际测试（相同任务）：

| 指标 | Claude 3.5 Sonnet | GPT-4 Turbo | Gemini Pro |
|------|------------------|-------------|------------|
| **工具调用准确性** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **响应速度** | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **上下文理解** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **代码生成** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **成本效益** | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

## 推荐选择

### 按场景选择

**生产环境 - 关键任务**:
- **首选**: Anthropic Claude 3.5 Sonnet
- **理由**: 最佳的工具调用质量和可靠性

**成本敏感场景**:
- **首选**: OpenAI GPT-3.5 Turbo 或 Google Gemini Pro
- **理由**: 价格最低，适合大量简单任务

**快速原型开发**:
- **首选**: Google Gemini Pro
- **理由**: 免费额度，快速迭代

**复杂推理任务**:
- **首选**: Anthropic Claude 3 Opus 或 OpenAI GPT-4 Turbo
- **理由**: 最强的推理能力

### 按工具调用质量选择

1. **Anthropic Claude 3.5 Sonnet** - 最可靠
2. **OpenAI GPT-4 Turbo** - 很好
3. **Google Gemini Pro** - 良好

## 常见问题

### Q: 可以在运行时切换模型吗？

A: 可以，创建新的 `MultiModelEngine` 实例即可：

```typescript
// 用 Claude 开始
let engine = new MultiModelEngine({
  provider: 'anthropic',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY
});

// 切换到 GPT-4
engine = new MultiModelEngine({
  provider: 'openai',
  openaiApiKey: process.env.OPENAI_API_KEY
});
```

### Q: 所有提供商都支持相同的功能吗？

A: 核心功能（工具调用、对话）都支持，但有细微差别：
- Anthropic: 最完整的工具调用支持
- OpenAI: Function calling 成熟
- Gemini: 基础工具调用支持

### Q: 如何处理 API key 安全？

A: 建议做法：
```typescript
// 1. 使用环境变量
const apiKey = process.env.ANTHROPIC_API_KEY;

// 2. 使用密钥管理服务
const apiKey = await secretManager.getSecret('anthropic-api-key');

// 3. 不要在代码中硬编码
// ❌ const apiKey = 'sk-ant-...';  // 错误！
```

### Q: 哪个提供商最适合 Web 环境？

A: 都适合 Web 环境，但建议：
- **服务端**: 任意提供商
- **客户端**: 不要直接调用（通过服务端代理）

## 运行示例

```bash
# 设置 API keys
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=...

# 运行多模型示例
npm run build
node examples/multi-model-example.js
```

## 总结

✅ **支持的提供商**: Anthropic, OpenAI, Google
✅ **统一接口**: 相同的代码，不同的模型
✅ **灵活切换**: 随时更换提供商
✅ **完整功能**: 工具调用、流式响应、对话历史

根据你的需求（成本、质量、速度）选择合适的提供商！
