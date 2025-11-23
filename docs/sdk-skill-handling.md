# SDK 如何处理 Skills - 完整机制详解

## 核心结论

**SDK 接收 "Skill" 工具信息,但不管理 skill 内容。所有 skill 内容管理都在 CLI 层完成。**

```
SDK 层级:
  - ✅ 接收 CLI 提供的工具列表 (包括 "Skill" 工具)
  - ✅ 可以看到 "Skill" 工具的定义
  - ✅ 转发 Claude 对 Skill 工具的调用请求
  - ❌ 不知道 ~/.claude/skills/ 目录
  - ❌ 不加载或解析 SKILL.md 文件
  - ❌ 不匹配或激活 skills
  - ❌ 不处理 Skill 工具调用的实际执行
  - ✅ 只能通过 systemPrompt 参数间接影响

CLI 层级:
  - ✅ 读取 ~/.claude/skills/ 目录
  - ✅ 解析 SKILL.md 文件
  - ✅ 注册 "Skill" 工具并添加到工具列表
  - ✅ 通过 init 消息将工具列表发送给 SDK
  - ✅ 自动匹配和激活 skills
  - ✅ 将 skill 内容注入系统提示
  - ✅ 处理 Skill 工具调用的实际执行
```

### 重要区分: "Skill" 工具 vs Skill 内容

**"Skill" 工具 (SDK 可见)**:
- 出现在 init 消息的 tools 数组中
- SDK 接收并知道这个工具存在
- Claude 可以调用这个工具
- 示例:
```json
{
  "type": "system",
  "subtype": "init",
  "tools": [
    "Task", "Bash", "Glob", "Grep",
    "Skill",  // ← SDK 可以看到这个工具
    "SlashCommand"
  ]
}
```

**Skill 内容 (CLI 独占管理)**:
- SKILL.md 文件的实际内容
- Skill 的匹配、激活逻辑
- Skill 内容注入系统提示的时机
- 这些完全在 CLI 内部处理,SDK 不可见

---

## 1. 完整消息流: "Skill" 工具如何到达 SDK

### 初始化阶段

```
1. SDK 启动 CLI 子进程
   const child = spawn("node", ["cli.js", ...args]);

2. CLI 启动并初始化
   ├─ 扫描 ~/.claude/skills/ 目录
   ├─ 解析所有 SKILL.md 文件
   ├─ 构建 skill 注册表
   └─ 注册 "Skill" 工具

3. CLI 发送 init 消息 (通过 stdout)
   {
     "type": "system",
     "subtype": "init",
     "tools": [
       "Task",
       "Bash",
       "Glob",
       "Grep",
       "ExitPlanMode",
       "Read",
       "Edit",
       "Write",
       "NotebookEdit",
       "WebFetch",
       "TodoWrite",
       "WebSearch",
       "BashOutput",
       "KillShell",
       "Skill",        // ← CLI 注册的工具
       "SlashCommand",
       ...MCP 工具
     ],
     "availableSkills": [  // CLI 提供的 skills 信息
       {
         "name": "algorithmic-art",
         "description": "Creating algorithmic art..."
       },
       {
         "name": "xlsx",
         "description": "Spreadsheet operations..."
       },
       ...
     ]
   }

4. SDK 接收 init 消息 (从 stdout 读取)
   ├─ 解析 JSON
   ├─ 看到 "Skill" 在 tools 数组中
   ├─ 存储工具列表
   └─ 可以检查 availableSkills (如果需要)

5. SDK 应用代码可以访问这些信息
   for await (const message of query({ prompt: "..." })) {
     if (message.type === "system" && message.subtype === "init") {
       console.log("Available tools:", message.tools);
       // → 包含 "Skill"

       console.log("Available skills:", message.availableSkills);
       // → [{ name: "algorithmic-art", ... }, ...]
     }
   }
```

### Claude 调用 Skill 工具的流程

```
1. 用户发送请求
   SDK → CLI: {
     "type": "user",
     "message": {
       "role": "user",
       "content": [{ "type": "text", "text": "Create algorithmic art" }]
     }
   }

2. Claude 决定调用 Skill 工具
   CLI ← Claude API: {
     "type": "tool_use",
     "name": "Skill",
     "input": {
       "skill": "algorithmic-art"
     }
   }

3. CLI 处理工具调用
   ├─ 接收到 "Skill" 工具调用
   ├─ 读取 ~/.claude/skills/algorithmic-art/SKILL.md
   ├─ 加载 skill 内容
   └─ 注入到后续对话的系统提示中

4. CLI 返回工具结果
   CLI → SDK: {
     "type": "system",
     "subtype": "skill_activated",
     "skillName": "algorithmic-art",
     "content": "[SKILL.md 的完整内容]"
   }

5. SDK 转发给应用
   SDK → Application: {
     "type": "system",
     "subtype": "skill_activated",
     ...
   }

6. Claude 后续响应会基于激活的 skill
   ├─ 使用 p5.js 创建艺术作品
   ├─ 应用 seed 系统确保可重现
   ├─ 遵循 skill 中定义的所有规范
   └─ ...
```

### SDK 的视角 vs CLI 的视角

**SDK 看到的**:
```typescript
// SDK 接收到的消息
{
  type: "system",
  subtype: "init",
  tools: ["Task", "Bash", ..., "Skill", "SlashCommand"],
  availableSkills: [
    { name: "algorithmic-art", description: "..." },
    { name: "xlsx", description: "..." }
  ]
}

// SDK 转发 Claude 的工具调用
{
  type: "tool_use",
  name: "Skill",
  input: { skill: "algorithmic-art" }
}

// SDK 接收 CLI 的响应
{
  type: "system",
  subtype: "skill_activated",
  skillName: "algorithmic-art"
}
```

**CLI 内部处理的** (SDK 不可见):
```javascript
// CLI 启动时
const skills = loadSkillsFromDisk("~/.claude/skills/");
// → { "algorithmic-art": { content: "...", ... }, ... }

// 注册 Skill 工具
registerTool({
  name: "Skill",
  handler: (input) => {
    const skillContent = skills[input.skill].content;
    injectIntoSystemPrompt(skillContent);
    return { activated: true };
  }
});

// 自动匹配逻辑
if (userMessage.includes("spreadsheet")) {
  autoActivateSkill("xlsx");
}
```

**关键点**: SDK 可以看到 "Skill" 工具的存在和调用,但不能访问或控制:
- Skill 文件的加载
- Skill 的匹配逻辑
- Skill 内容的注入时机
- Skill 的激活条件

---

## 2. SDK 的职责边界

### SDK 可以做的

**通过 `systemPrompt` 参数影响系统提示**:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

// 方式 1: 完全自定义系统提示 (替换 CLI 默认提示)
const result1 = query({
  prompt: "Create a spreadsheet",
  options: {
    systemPrompt: "You are an expert in data analysis..."
  }
});

// 方式 2: 使用预设提示 + 追加内容
const result2 = query({
  prompt: "Create a spreadsheet",
  options: {
    systemPrompt: {
      type: "preset",       // 使用 CLI 默认系统提示
      append: "Additional instructions..."  // 追加自定义内容
    }
  }
});

// 方式 3: 默认行为 (不指定 systemPrompt)
const result3 = query({
  prompt: "Create a spreadsheet",
  options: {}
  // CLI 会使用默认系统提示 + 自动加载的 skills
});
```

**SDK 源码实现**:

```javascript
// sdk.mjs:14746-14754
const { systemPrompt, settingSources, ...rest } = options ?? {};
let customSystemPrompt;
let appendSystemPrompt;

if (systemPrompt === undefined) {
  // 情况 1: 未指定 - CLI 使用默认提示
  customSystemPrompt = "";
} else if (typeof systemPrompt === "string") {
  // 情况 2: 字符串 - 完全替换系统提示
  customSystemPrompt = systemPrompt;
} else if (systemPrompt.type === "preset") {
  // 情况 3: preset + append - 使用默认提示并追加
  appendSystemPrompt = systemPrompt.append;
}

// 传递给 CLI
const transport = new ProcessTransport({
  // ...
  customSystemPrompt,    // --system-prompt 参数
  appendSystemPrompt,    // --append-system-prompt 参数
  // ...
});
```

**CLI 参数映射**:

```javascript
// sdk.mjs:6413-6416
if (typeof customSystemPrompt === "string")
  args.push("--system-prompt", customSystemPrompt);

if (appendSystemPrompt)
  args.push("--append-system-prompt", appendSystemPrompt);
```

### SDK 不能做的

**❌ 不能直接加载或激活 skills**:

```typescript
// ❌ 这样的 API 不存在
query({
  prompt: "Create art",
  options: {
    skills: ["algorithmic-art"]  // 不存在这个选项
  }
});

// ❌ 也不能这样
query({
  prompt: "Create art",
  options: {
    loadSkills: true  // 不存在
  }
});
```

**❌ 不能控制 skill 激活逻辑**:

SDK 无法告诉 CLI:
- 哪些 skills 应该被激活
- 何时激活 skills
- 如何匹配 skills
- Skill tool 的行为

**原因**:
- Skills 是 CLI 的内部机制
- Skill 文件在用户的 `~/.claude/skills/` 目录
- Skill 匹配逻辑在 CLI 代码中
- SDK 只是通过 stdin/stdout 与 CLI 通信

---

## 3. CLI 的 Skill 处理流程

### CLI 启动时的 Skill 加载

```
1. CLI 进程启动
   ↓
2. 读取用户配置目录
   - ~/.claude/skills/
   ↓
3. 扫描所有 skill 目录
   - algorithmic-art/
   - canvas-design/
   - document-skills/xlsx/
   - document-skills/pdf/
   - ...
   ↓
4. 解析每个 SKILL.md 文件
   - 读取 YAML frontmatter (name, description)
   - 读取 Markdown 内容
   ↓
5. 构建 skill 注册表
   {
     "algorithmic-art": {
       name: "algorithmic-art",
       description: "Creating algorithmic art...",
       content: "# Algorithmic Philosophy...",
       path: "~/.claude/skills/algorithmic-art/SKILL.md"
     },
     "xlsx": {
       name: "xlsx",
       description: "Spreadsheet operations...",
       content: "# Requirements for Outputs...",
       path: "~/.claude/skills/document-skills/xlsx/SKILL.md"
     },
     ...
   }
   ↓
6. 将 skill 列表注册为 "Skill" 工具
   - 创建工具定义
   - 添加到可用工具列表
```

### 系统提示构建流程

```
1. 基础系统提示 (CLI 内置)
   ┌────────────────────────────────────────┐
   │ You are Claude, an AI assistant...     │
   │ [工具使用指南]                          │
   │ [权限系统说明]                          │
   │ [文件操作规范]                          │
   └────────────────────────────────────────┘
              ↓
2. 添加 Skill Tool 定义
   ┌────────────────────────────────────────┐
   │ <skills_instructions>                  │
   │ When users ask you to perform tasks,   │
   │ check if any available skills can help │
   │                                        │
   │ <available_skills>                     │
   │ - algorithmic-art                      │
   │ - canvas-design                        │
   │ - xlsx                                 │
   │ - pdf                                  │
   │ - ...                                  │
   │ </available_skills>                    │
   │ </skills_instructions>                 │
   └────────────────────────────────────────┘
              ↓
3. 处理 SDK 传入的 systemPrompt
   if (customSystemPrompt) {
     // 完全替换上面的内容
     finalPrompt = customSystemPrompt;
   } else {
     // 使用上面构建的默认提示
     finalPrompt = basePrompt;

     if (appendSystemPrompt) {
       // 追加 SDK 传入的内容
       finalPrompt += "\n\n" + appendSystemPrompt;
     }
   }
              ↓
4. 发送给 Claude API
```

### Skill 激活机制

**方式 1: 自动匹配激活**

```
用户输入: "Create a budget spreadsheet"
   ↓
CLI 分析:
1. 检测关键词: "spreadsheet"
2. 匹配 skill: xlsx
   - description 包含 "spreadsheet"
   - 匹配成功
   ↓
3. 注入 xlsx skill 内容到系统提示
   systemPrompt += "\n\n" + skillContent["xlsx"]
   ↓
4. 发送请求到 Claude API
   - 系统提示包含 xlsx 的所有规范
   - Claude 按照 skill 指导生成代码
```

**方式 2: 显式调用 (Skill Tool)**

```
Claude 推理: "用户想创建艺术作品,应该使用 algorithmic-art skill"
   ↓
Claude 生成工具调用:
{
  "type": "tool_use",
  "name": "Skill",
  "input": {
    "skill": "algorithmic-art"
  }
}
   ↓
CLI 处理:
1. 接收到 Skill 工具调用
2. 读取 algorithmic-art/SKILL.md
3. 将内容作为系统消息返回
   {
     "type": "system",
     "subtype": "skill_loaded",
     "content": [skill content]
   }
   ↓
Claude 接收:
- 看到 skill 内容
- 按照 skill 指导完成任务
```

---

## 4. 完整流程示例

### 示例 1: SDK 默认行为 (CLI 自动管理 skills)

**SDK 代码**:
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const result = query({
  prompt: "Create a financial model for Q4 revenue projection",
  options: {
    cwd: "/path/to/project"
    // 注意: 没有指定 systemPrompt
  }
});

for await (const message of result) {
  console.log(message);
}
```

**实际执行流程**:

```
1. SDK 构建 CLI 启动命令
   node cli.js \
     --output-format stream-json \
     --input-format stream-json \
     --verbose
   (注意: 没有 --system-prompt 参数)

2. CLI 启动
   - 加载所有 skills
   - 构建默认系统提示 + Skill tool

3. SDK 发送用户消息
   {
     "type": "user",
     "message": {
       "role": "user",
       "content": [
         { "type": "text", "text": "Create a financial model..." }
       ]
     }
   }

4. CLI 接收消息
   - 分析关键词: "financial model"
   - 匹配到 xlsx skill
   - 自动注入 xlsx skill 内容

5. CLI 构建最终系统提示
   基础提示
   + Skill tool 定义
   + xlsx skill 内容 (自动激活)
     → 蓝色输入,黑色公式
     → 货币格式规范
     → 零值显示为 "-"
     → ...

6. 发送给 Claude API
   - 系统提示包含完整的 xlsx 规范
   - Claude 生成符合规范的代码

7. Claude 使用 Write 工具创建文件
   - 创建 .xlsx 文件
   - 应用所有格式规范
   - 使用公式而非硬编码

8. 返回结果给 SDK
```

### 示例 2: SDK 自定义系统提示 (覆盖 CLI 默认行为)

**SDK 代码**:
```typescript
const result = query({
  prompt: "Create a financial model",
  options: {
    systemPrompt: "You are a financial analyst. Always use conservative estimates."
  }
});
```

**实际执行流程**:

```
1. SDK 构建 CLI 启动命令
   node cli.js \
     --output-format stream-json \
     --input-format stream-json \
     --system-prompt "You are a financial analyst..."

2. CLI 启动
   - 加载所有 skills (仍然执行)
   - 但系统提示被完全替换

3. CLI 使用的系统提示
   ❌ 不包含默认的工具使用指南
   ❌ 不包含 Skill tool 定义
   ❌ 不会自动激活 xlsx skill
   ✅ 只有用户提供的内容

4. 结果
   - Claude 没有 xlsx skill 的指导
   - 生成的 Excel 文件可能不符合规范
   - 可能使用硬编码值而非公式
```

**注意**: 完全自定义 systemPrompt 会**禁用** skills 自动激活!

### 示例 3: SDK 追加系统提示 (保留 skills)

**SDK 代码**:
```typescript
const result = query({
  prompt: "Create a financial model",
  options: {
    systemPrompt: {
      type: "preset",  // 使用 CLI 默认提示
      append: "Focus on SaaS metrics: ARR, MRR, CAC, LTV."
    }
  }
});
```

**实际执行流程**:

```
1. SDK 构建 CLI 启动命令
   node cli.js \
     --output-format stream-json \
     --input-format stream-json \
     --append-system-prompt "Focus on SaaS metrics..."

2. CLI 构建系统提示
   基础提示
   + Skill tool 定义
   + xlsx skill 内容 (自动激活)
   + "Focus on SaaS metrics..." (追加)

3. 结果
   ✅ 保留了 xlsx skill 的格式规范
   ✅ 增加了 SaaS 指标的专业知识
   ✅ 两者结合,生成高质量的财务模型
```

---

## 5. 通过 Plugin 提供 Skills

虽然 SDK 不能直接加载 skills,但可以通过 **Plugin** 机制间接提供 skill 内容。

### Plugin 包含 Skills

**Plugin 结构**:
```
my-custom-plugin/
├── package.json
├── skills/
│   └── custom-skill/
│       └── SKILL.md
└── dist/
    └── index.js  (MCP 服务器)
```

**package.json**:
```json
{
  "name": "my-custom-plugin",
  "version": "1.0.0",
  "skills": [
    {
      "name": "custom-skill",
      "description": "My custom domain knowledge",
      "skillPath": "skills/custom-skill/SKILL.md"
    }
  ],
  "mcpServer": {
    "command": "node",
    "args": ["dist/index.js"]
  }
}
```

**SDK 使用**:
```typescript
const result = query({
  prompt: "Use my custom domain knowledge",
  options: {
    plugins: [
      {
        type: "local",
        path: "/path/to/my-custom-plugin"
      }
    ]
  }
});

// CLI 启动时:
// 1. 加载 plugin
// 2. 读取 plugin 的 skills/ 目录
// 3. 将 plugin 的 skills 添加到可用 skills 列表
// 4. 自动激活或通过 Skill tool 调用
```

**工作流程**:
```
SDK 传递 --plugin-dir /path/to/my-custom-plugin
   ↓
CLI 读取 plugin 的 package.json
   ↓
CLI 发现 "skills" 字段
   ↓
CLI 读取 skills/custom-skill/SKILL.md
   ↓
CLI 将 custom-skill 添加到可用 skills
   ↓
用户可以通过 Skill tool 调用或自动匹配激活
```

---

## 6. Skills 与 systemPrompt 的交互

### 场景对比

| 场景 | systemPrompt 设置 | Skills 行为 | 结果 |
|------|------------------|-------------|------|
| **场景 1** | 未设置 | 自动加载和激活 | ✅ 最佳,CLI 完全管理 |
| **场景 2** | 字符串 (完全替换) | ❌ 被禁用 | ⚠️ 失去 skill 指导 |
| **场景 3** | preset + append | 自动加载和激活 | ✅ 保留 skills + 自定义 |
| **场景 4** | Plugin 提供 | 通过 plugin 加载 | ✅ SDK 可控的 skills |

### 最佳实践

**✅ 推荐: 让 CLI 管理 skills**

```typescript
// 场景 1: 完全默认
query({ prompt: "Create spreadsheet" });

// 场景 3: 追加自定义内容
query({
  prompt: "Create spreadsheet",
  options: {
    systemPrompt: {
      type: "preset",
      append: "Focus on quarterly reporting"
    }
  }
});

// 场景 4: 通过 plugin 提供 skills
query({
  prompt: "Use custom skill",
  options: {
    plugins: [{ type: "local", path: "/path/to/plugin" }]
  }
});
```

**❌ 不推荐: 完全替换系统提示**

```typescript
// 这会禁用所有 skills
query({
  prompt: "Create spreadsheet",
  options: {
    systemPrompt: "You are an expert..."
  }
});

// 如果必须这样做,需要手动包含 skill 内容
const xlsxSkillContent = fs.readFileSync(
  "~/.claude/skills/document-skills/xlsx/SKILL.md",
  "utf-8"
);

query({
  prompt: "Create spreadsheet",
  options: {
    systemPrompt: `You are an expert...

${xlsxSkillContent}`
  }
});
```

---

## 7. 调试 Skill 问题

### 检查 Skills 是否被加载

**方法 1: 查看系统消息**

```typescript
for await (const message of query({ prompt: "..." })) {
  if (message.type === "system") {
    console.log("System message:", message);
    // 检查是否包含 skill 内容
  }
}
```

**方法 2: 使用 Skill Tool**

```typescript
// 在对话中显式请求
const result = query({
  prompt: "Use the xlsx skill to show me available skills"
});

// Claude 会调用 Skill tool
// 返回的消息会显示 skill 内容
```

**方法 3: 检查 CLI 日志**

```typescript
query({
  prompt: "Create spreadsheet",
  options: {
    env: { DEBUG: "1" },  // 启用调试日志
    stderr: (data) => {
      console.log("CLI stderr:", data);
      // 查找 skill 加载日志
    }
  }
});
```

### 常见问题

**问题 1: Skill 没有被激活**

原因:
- 使用了完全自定义的 `systemPrompt` (字符串)
- Skill 的 description 不匹配用户输入
- Skill 文件格式错误

解决:
```typescript
// 使用 preset + append 而非完全替换
options: {
  systemPrompt: {
    type: "preset",
    append: "Additional instructions"
  }
}
```

**问题 2: 不知道有哪些 Skills 可用**

解决:
```typescript
// 方法 1: 查看文件系统
ls ~/.claude/skills/

// 方法 2: 在对话中询问
const result = query({
  prompt: "List all available skills using the Skill tool"
});
```

**问题 3: 自定义 Skill 未被识别**

检查:
1. Skill 文件在正确位置 (`~/.claude/skills/my-skill/SKILL.md`)
2. YAML frontmatter 格式正确
3. CLI 已重启 (加载 skills 在启动时)

---

## 8. 总结

### SDK 的角色

```
┌──────────────────────────────────────────────┐
│                   SDK                        │
├──────────────────────────────────────────────┤
│                                              │
│  职责:                                        │
│  ✅ 启动 CLI 子进程                          │
│  ✅ 传递配置参数 (systemPrompt, plugins...)  │
│  ✅ 通过 stdin 发送用户消息                  │
│  ✅ 通过 stdout 接收响应                     │
│  ✅ 接收并存储工具列表 (包括 "Skill")        │
│  ✅ 转发 Claude 对 Skill 工具的调用          │
│  ✅ 接收 skill 激活的通知消息                │
│                                              │
│  不负责:                                      │
│  ❌ 加载或解析 SKILL.md 文件                 │
│  ❌ 匹配或激活 skill 内容                    │
│  ❌ 执行 Skill 工具调用 (只转发)             │
│  ❌ 管理 skill 的生命周期                    │
│                                              │
└──────────────────────────────────────────────┘
                    ↓ 进程通信 (stdin/stdout)
┌──────────────────────────────────────────────┐
│                   CLI                        │
├──────────────────────────────────────────────┤
│                                              │
│  职责:                                        │
│  ✅ 扫描 ~/.claude/skills/ 目录              │
│  ✅ 解析 SKILL.md 文件                       │
│  ✅ 构建 skill 注册表                        │
│  ✅ 注册 "Skill" 工具                        │
│  ✅ 通过 init 消息发送工具列表给 SDK         │
│  ✅ 自动匹配和激活 skills                    │
│  ✅ 执行 Skill 工具调用                      │
│  ✅ 将 skill 内容注入系统提示                │
│  ✅ 管理完整的对话流程                       │
│                                              │
└──────────────────────────────────────────────┘
```

### 关键要点

1. **SDK 与 "Skill" 工具的关系**
   - ✅ SDK 接收 init 消息中的 "Skill" 工具
   - ✅ SDK 可以看到 availableSkills 列表
   - ✅ SDK 转发 Claude 对 Skill 工具的调用
   - ❌ SDK 不加载或解析 SKILL.md 文件
   - ❌ SDK 不执行 Skill 工具调用 (CLI 执行)
   - ❌ SDK 不控制 skill 的匹配和激活逻辑

2. **"Skill" 工具 vs Skill 内容的区别**
   - "Skill" 工具: SDK 可见,在 tools 数组中
   - Skill 内容: CLI 独占,SDK 不可见
   - 工具调用转发: SDK → CLI → 执行 → 返回结果
   - 内容管理: 完全在 CLI 内部

3. **三种使用 Skills 的方式**
   - 默认: 让 CLI 自动管理 (推荐)
   - 追加: preset + append (保留 skills + 自定义)
   - Plugin: 通过 plugin 提供自定义 skills

4. **避免的陷阱**
   - 不要完全替换 systemPrompt (会禁用 skills)
   - 不要期望 SDK 能直接控制 skill 激活逻辑
   - 不要混淆 "Skill" 工具的可见性和 skill 内容的管理权
   - 不要忘记 Plugin 也可以提供 skills

5. **最佳实践**
   ```typescript
   // ✅ 最简单 - 让 CLI 处理一切
   query({ prompt: "..." });

   // ✅ 追加自定义 - 保留 skills
   query({
     prompt: "...",
     options: {
       systemPrompt: { type: "preset", append: "..." }
     }
   });

   // ✅ Plugin - SDK 可控的 skills
   query({
     prompt: "...",
     options: {
       plugins: [{ type: "local", path: "..." }]
     }
   });

   // ✅ 检查可用的 skills
   for await (const message of query({ prompt: "..." })) {
     if (message.type === "system" && message.subtype === "init") {
       console.log("Available skills:", message.availableSkills);
     }
   }
   ```
