# 在 SDK 应用中使用 Skills

## 简短回答

**是的！可以使用 skills，而且是自动可用的！**

当你使用 SDK 创建应用(如 basic-example)时，Claude **自动拥有** 访问所有 skills 的能力，因为:
1. SDK 启动 CLI 进程时，CLI 自动加载 `~/.claude/skills/` 中的所有 skills
2. CLI 注册 "Skill" 工具并通过 init 消息发送给 SDK
3. Claude 可以使用 "Skill" 工具来激活任何可用的 skill

## 详细说明

### 1. Skills 的自动加载机制

```
应用启动流程:

1. basic-example 启动
   new SimpleClaudeAgentSDKClient()

2. SDK 启动 CLI 子进程
   spawn("node", ["cli.js", ...])

3. CLI 启动并加载 skills
   ├─ 扫描 ~/.claude/skills/
   │  ├─ algorithmic-art/
   │  ├─ canvas-design/
   │  ├─ document-skills/xlsx/
   │  ├─ document-skills/pdf/
   │  └─ ...
   │
   ├─ 解析每个 SKILL.md
   │  ├─ 读取 YAML frontmatter (name, description)
   │  └─ 读取 Markdown 内容
   │
   └─ 注册 "Skill" 工具

4. CLI 发送 init 消息给 SDK
   {
     "type": "system",
     "subtype": "init",
     "tools": ["Task", "Bash", ..., "Skill", ...],
     "availableSkills": [
       { "name": "algorithmic-art", "description": "..." },
       { "name": "xlsx", "description": "..." },
       { "name": "pdf", "description": "..." },
       ...
     ]
   }

5. SDK 转发 init 消息给应用
   basic-example 接收到工具列表(包括 "Skill")

6. Claude 可以使用 "Skill" 工具
   Claude 看到系统提示中的 skills 说明
   决定使用某个 skill 时，调用 Skill 工具
```

### 2. Basic Example 中的实际情况

查看 `basic-example/server/server.ts`:

```typescript
const sdkClient = new SimpleClaudeAgentSDKClient();

const defaultOptions: SessionSDKOptions = {
  cwd: path.join(process.cwd(), "agent"),
  thinkingLevel: "default_on",
};

// 注意: 没有任何关于 skills 的配置
// 因为 skills 是 CLI 自动加载的！
```

**关键点**: 你不需要做任何配置，skills 就已经可用了！

### 3. Skills 如何被使用

#### 方式 1: Claude 自动匹配激活

```
用户输入: "Create a budget spreadsheet"
   ↓
CLI 分析关键词: "spreadsheet"
   ↓
CLI 自动匹配到 xlsx skill
   ↓
CLI 将 xlsx skill 内容注入系统提示
   ↓
Claude 按照 xlsx skill 的规范生成代码
   ↓
结果: 创建符合规范的 Excel 文件
  - 蓝色输入，黑色公式
  - 货币格式规范
  - 零值显示为 "-"
  - ...
```

#### 方式 2: Claude 显式调用 Skill 工具

```
用户输入: "Create algorithmic art"
   ↓
Claude 推理: 应该使用 algorithmic-art skill
   ↓
Claude 调用工具:
{
  "type": "tool_use",
  "name": "Skill",
  "input": {
    "skill": "algorithmic-art"
  }
}
   ↓
CLI 接收工具调用
   ↓
CLI 读取 ~/.claude/skills/algorithmic-art/SKILL.md
   ↓
CLI 将 skill 内容作为系统消息返回
   ↓
Claude 按照 skill 指导创建艺术作品
```

### 4. 在 Basic Example 中测试 Skills

#### 测试 1: 使用 xlsx skill

```
用户消息: "Create a financial model for Q4 revenue projection"

预期行为:
1. CLI 自动激活 xlsx skill
2. Claude 创建 Excel 文件
3. 应用所有 xlsx skill 的格式规范
   - 使用公式而非硬编码
   - 蓝色输入单元格
   - 正确的货币格式
   - 零值显示为 "-"
```

#### 测试 2: 显式请求 skill

```
用户消息: "Use the algorithmic-art skill to create a flow field visualization"

预期行为:
1. Claude 调用 Skill 工具
2. CLI 激活 algorithmic-art skill
3. Claude 使用 p5.js 创建艺术作品
4. 应用 seed 系统确保可重现
```

### 5. 查看可用的 Skills

在 basic-example 中，你可以在初始化消息中看到所有可用的 skills:

```typescript
// 在客户端监听 init 消息
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "system" && message.subtype === "init") {
    console.log("Available tools:", message.tools);
    // → ["Task", "Bash", "Read", "Write", "Skill", ...]

    console.log("Available skills:", message.availableSkills);
    // → [
    //     { name: "algorithmic-art", description: "..." },
    //     { name: "canvas-design", description: "..." },
    //     { name: "xlsx", description: "..." },
    //     { name: "pdf", description: "..." },
    //     ...
    //   ]
  }
};
```

### 6. 自定义 Skills

如果你想添加自定义 skills:

#### 步骤 1: 创建 skill 文件

```bash
mkdir -p ~/.claude/skills/my-custom-skill
```

创建 `~/.claude/skills/my-custom-skill/SKILL.md`:

```markdown
---
name: my-custom-skill
description: My custom domain knowledge
license: private
---

# Custom Skill Instructions

When creating [specific type of output], always follow these rules:
1. ...
2. ...
```

#### 步骤 2: 重启应用

```bash
# 重启 basic-example
# CLI 会重新扫描 ~/.claude/skills/ 并加载新 skill
```

#### 步骤 3: 使用 skill

```
用户消息: "Use my-custom-skill to create X"
或
用户消息: "[触发关键词]"  # CLI 自动匹配
```

### 7. 通过 Plugin 提供 Skills

你也可以通过 SDK 的 plugin 选项来提供 skills:

```typescript
const defaultOptions: SessionSDKOptions = {
  cwd: path.join(process.cwd(), "agent"),
  thinkingLevel: "default_on",
  plugins: [
    {
      type: "local",
      path: "/path/to/my-plugin"
    }
  ]
};
```

Plugin 的 `package.json`:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "skills": [
    {
      "name": "custom-skill",
      "description": "My custom domain knowledge",
      "skillPath": "skills/custom-skill/SKILL.md"
    }
  ]
}
```

### 8. Skills 不工作的情况

#### 问题 1: 使用完全自定义的 systemPrompt

```typescript
// ❌ 这会禁用 skills
const options: SessionSDKOptions = {
  systemPrompt: "You are a financial analyst..." // 完全替换
};
```

**解决方案**: 使用 `appendSystemPrompt` 而不是 `systemPrompt`

```typescript
// ✅ 保留 skills
const options: SessionSDKOptions = {
  appendSystemPrompt: "Focus on conservative estimates..."
};
```

#### 问题 2: Skills 路径问题

Skills 必须在以下位置:
- 用户 skills: `~/.claude/skills/`
- Plugin skills: `~/.claude/plugins/{plugin}/skills/`

### 9. Skills 与 systemPrompt 的交互

```typescript
// 场景 1: 默认 - Skills 完全可用
const options1: SessionSDKOptions = {
  cwd: "./agent"
  // CLI 使用默认系统提示 + 所有 skills
};

// 场景 2: 追加内容 - Skills 完全可用
const options2: SessionSDKOptions = {
  appendSystemPrompt: "Focus on SaaS metrics..."
  // CLI 使用默认系统提示 + skills + 你的追加内容
};

// 场景 3: 完全替换 - Skills 被禁用
const options3: SessionSDKOptions = {
  systemPrompt: "You are an expert..."
  // ❌ 所有 skills 被禁用
};
```

### 10. 在 Basic Example 中启用 Skills 的最佳实践

```typescript
// basic-example/server/server.ts

const defaultOptions: SessionSDKOptions = {
  cwd: path.join(process.cwd(), "agent"),
  thinkingLevel: "default_on",

  // ✅ 使用 appendSystemPrompt 而不是 systemPrompt
  // 这样可以保留所有 skills
  appendSystemPrompt: `
    You are assisting with a web-based chat interface.
    Focus on clarity and helpful responses.
  `.trim(),

  // ✅ 可选: 通过 plugin 提供额外的 skills
  plugins: [
    // {
    //   type: "local",
    //   path: path.join(process.cwd(), "custom-plugin")
    // }
  ]
};
```

## 总结

### ✅ 可以使用 Skills

1. **默认就能用**: SDK 应用自动拥有访问所有 skills 的能力
2. **无需配置**: CLI 自动加载 `~/.claude/skills/` 中的 skills
3. **两种使用方式**:
   - 自动匹配: CLI 根据关键词自动激活
   - 显式调用: Claude 使用 "Skill" 工具

### ✅ Skills 在 Basic Example 中的工作方式

```
basic-example (SDK App)
        ↓
SimpleClaudeAgentSDKClient
        ↓
启动 CLI 子进程
        ↓
CLI 自动加载 ~/.claude/skills/
        ↓
CLI 注册 "Skill" 工具
        ↓
发送 init 消息(包含 skills 列表)
        ↓
Claude 可以使用所有 skills
```

### ⚠️ 注意事项

1. **不要使用完全自定义的 systemPrompt** - 会禁用 skills
2. **使用 appendSystemPrompt** - 保留 skills + 添加自定义内容
3. **Skills 路径**: 必须在 `~/.claude/skills/` 或 plugin 中

### 📝 实践建议

1. **让 CLI 管理 skills** - 不要试图在 SDK 中控制 skills
2. **使用 appendSystemPrompt** - 添加应用特定的指令
3. **查看 init 消息** - 验证 skills 已加载
4. **测试自动匹配** - 使用包含 skill 关键词的输入
5. **创建自定义 skills** - 在 `~/.claude/skills/` 中添加你的专业知识

## 示例代码

完整的 basic-example 启用 skills 示例:

```typescript
// server/server.ts
import path from "node:path";
import { SimpleClaudeAgentSDKClient, type SessionSDKOptions } from "@claude-agent-kit/server";

const sdkClient = new SimpleClaudeAgentSDKClient();

const defaultOptions: SessionSDKOptions = {
  // 工作目录
  cwd: path.join(process.cwd(), "agent"),

  // 思维级别
  thinkingLevel: "default_on",

  // ✅ 追加系统提示(保留 skills)
  appendSystemPrompt: `
    You are a helpful assistant in a web chat interface.

    When users ask for spreadsheets, use the xlsx skill.
    When users ask for art, use the algorithmic-art skill.
    When users ask for documents, use the appropriate document skill.
  `.trim(),
};

// Skills 现在完全可用！
// Claude 可以:
// 1. 自动匹配并激活 skills
// 2. 显式使用 Skill 工具
// 3. 访问所有 ~/.claude/skills/ 中的 skills
```

测试命令:

```bash
# 启动 basic-example
cd examples/basic-example
bun run dev

# 在聊天界面测试:
# 1. "Create a budget spreadsheet for Q4"  → xlsx skill
# 2. "Create algorithmic art"              → algorithmic-art skill
# 3. "Generate a PDF report"               → pdf skill
```

所有 skills 都可以在你的 SDK 应用中使用，完全无需额外配置！🎉
