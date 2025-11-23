# 工具系统架构 - CLI 实现 vs SDK 转发

## 核心结论

**所有工具(Task、Bash、Read、Write、Skill、SlashCommand等)的实现代码都在 CLI 中,SDK 只负责转发工具调用和结果。**

```
SDK 层:
  ❌ 没有任何工具的实现代码
  ✅ 接收 CLI 发送的工具列表
  ✅ 转发 Claude 的工具调用给 CLI
  ✅ 接收 CLI 返回的工具结果
  ✅ 将结果转发给应用层

CLI 层:
  ✅ 实现所有工具的逻辑
  ✅ 注册工具并生成工具列表
  ✅ 通过 init 消息发送工具列表给 SDK
  ✅ 接收 SDK 转发的工具调用
  ✅ 执行工具逻辑
  ✅ 返回工具结果给 SDK
```

---

## 1. 完整的工具调用流程

### 初始化阶段: CLI → SDK

```
1. SDK 启动 CLI 子进程
   spawn("node", ["cli.js", ...args])

2. CLI 初始化并注册所有工具
   ├─ Task 工具
   ├─ Bash 工具
   ├─ Read 工具
   ├─ Write 工具
   ├─ Edit 工具
   ├─ Skill 工具 (加载 ~/.claude/skills/)
   ├─ SlashCommand 工具 (加载 .claude/commands/)
   ├─ MCP 工具 (加载插件提供的工具)
   └─ ...

3. CLI 发送 init 消息 (stdout)
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
       "Skill",
       "SlashCommand",
       "AskUserQuestion",
       ...MCP 工具
     ],
     "mcpServers": [...],
     "availableSkills": [...]
   }

4. SDK 接收并存储工具列表
   this.availableTools = message.tools

5. SDK 转发 init 消息给应用层
   yield { type: "system", subtype: "init", tools: [...] }
```

### 工具调用阶段: SDK ↔ CLI

```
1. 用户发送请求
   Application → SDK: "Read the README file"

2. SDK 转发给 CLI
   SDK → CLI (stdin): {
     "type": "user",
     "message": {
       "role": "user",
       "content": [{ "type": "text", "text": "Read the README file" }]
     }
   }

3. Claude API 决定调用工具
   Claude API → CLI: {
     "type": "tool_use",
     "name": "Read",
     "input": {
       "file_path": "/path/to/README.md"
     }
   }

4. CLI 执行工具
   ├─ 查找 Read 工具的处理器
   ├─ 检查权限 (checkPermissions)
   ├─ 验证输入 (validateInput)
   ├─ 执行工具逻辑 (call 方法)
   │   └─ 读取文件内容
   └─ 生成工具结果

5. CLI 返回工具结果
   CLI → SDK (stdout): {
     "type": "tool_result",
     "tool_use_id": "...",
     "content": "[文件内容]"
   }

6. SDK 转发给 Claude API
   SDK → Claude API: {
     "type": "tool_result",
     "tool_use_id": "...",
     "content": "[文件内容]"
   }

7. Claude API 继续处理
   基于文件内容生成响应

8. SDK 转发响应给应用
   SDK → Application: {
     "type": "assistant",
     "content": "Here's what I found in the README..."
   }
```

---

## 2. CLI 中的工具实现

### 工具定义接口

每个工具在 CLI 中都遵循以下接口:

```typescript
interface Tool {
  // 工具名称
  name: string;

  // 工具描述(可以是函数,动态生成)
  description: string | ((input: any) => Promise<string>);

  // 工具提示(包含详细的使用说明)
  prompt: () => Promise<string>;

  // 输入参数的 Zod schema
  inputSchema: z.ZodObject<any>;

  // 输出结果的 Zod schema
  outputSchema?: z.ZodObject<any>;

  // 验证输入
  validateInput: (input: any, context: Context) => Promise<{
    result: boolean;
    message?: string;
    errorCode?: number;
  }>;

  // 检查权限
  checkPermissions: (input: any, context: Context) => Promise<{
    behavior: "allow" | "deny" | "ask";
    message?: string;
    updatedInput?: any;
    suggestions?: Permission[];
  }>;

  // 执行工具逻辑
  call: (input: any, context: Context) => AsyncGenerator<{
    type: "result" | "progress";
    data: any;
    newMessages?: Message[];
  }>;

  // 工具属性
  userFacingName: () => string;
  isConcurrencySafe: () => boolean;
  isEnabled: () => boolean;
  isReadOnly: () => boolean;
}
```

### Skill 工具实现示例

```javascript
// cli.js:2757-2850 (简化后的代码)

const Pd = {
  name: "Skill",

  // 输入: skill 名称
  inputSchema: z.object({
    command: z.string().describe('The skill name')
  }),

  // 输出: 成功标志和 skill 名称
  outputSchema: z.object({
    success: z.boolean(),
    commandName: z.string()
  }),

  // 动态描述
  async description({ command }) {
    return `Execute skill: ${command}`;
  },

  // 详细的使用说明
  async prompt() {
    // 1. 加载所有 skills
    const skills = await loadSkills();

    // 2. 生成 skills 列表
    const skillsList = skills
      .map(skill => `- ${skill.name}: ${skill.description}`)
      .join('\n');

    // 3. 返回完整的指导文本
    return `Execute a skill within the main conversation

<skills_instructions>
When users ask you to perform tasks, check if any of the available skills
below can help complete the task more effectively.

How to use skills:
- Invoke skills using this tool with the skill name only
- Examples: skill: "pdf", skill: "xlsx"
</skills_instructions>

<available_skills>
${skillsList}
</available_skills>`;
  },

  // 验证输入
  async validateInput({ command }, context) {
    const skillName = command.trim();
    const skills = await loadSkills();

    if (!skillExists(skillName, skills)) {
      return {
        result: false,
        message: `Unknown skill: ${skillName}`,
        errorCode: 2
      };
    }

    return { result: true };
  },

  // 检查权限
  async checkPermissions({ command }, context) {
    // 检查是否被权限规则阻止
    if (isDenied(command, context.toolPermissionContext)) {
      return {
        behavior: "deny",
        message: "Skill execution blocked by permission rules"
      };
    }

    // 检查是否已允许
    if (isAllowed(command, context.toolPermissionContext)) {
      return {
        behavior: "allow",
        updatedInput: { command }
      };
    }

    // 需要询问用户
    return {
      behavior: "ask",
      message: `Execute skill: ${command}`,
      suggestions: [
        {
          type: "addRules",
          rules: [{ toolName: "Skill", ruleContent: command }],
          behavior: "allow",
          destination: "localSettings"
        }
      ]
    };
  },

  // 执行工具
  async *call({ command }, context) {
    const skillName = command.trim();

    // 1. 加载 skill 内容
    const skills = await loadSkills();
    const skill = findSkill(skillName, skills);

    // 2. 处理 skill (加载并注入到系统提示)
    const result = await processSkill(skillName, skill, context);

    // 3. 返回结果
    yield {
      type: "result",
      data: {
        success: true,
        commandName: skillName
      },
      // 新消息: skill 已激活的通知
      newMessages: result.messages,
      // 上下文修改器: 更新权限等
      contextModifier(ctx) {
        return {
          ...ctx,
          // 允许 skill 需要的工具
          toolPermissionContext: updatePermissions(ctx)
        };
      }
    };
  }
};
```

### Read 工具实现示例

```javascript
// CLI 中的 Read 工具实现

const ReadTool = {
  name: "Read",

  inputSchema: z.object({
    file_path: z.string(),
    offset: z.number().optional(),
    limit: z.number().optional()
  }),

  async validateInput({ file_path }, context) {
    // 检查路径是否绝对路径
    if (!path.isAbsolute(file_path)) {
      return {
        result: false,
        message: "Path must be absolute",
        errorCode: 1
      };
    }

    return { result: true };
  },

  async checkPermissions({ file_path }, context) {
    // 检查文件是否在允许的路径中
    if (isInAllowedPath(file_path)) {
      return { behavior: "allow" };
    }

    // 需要用户授权
    return {
      behavior: "ask",
      message: `Read file: ${file_path}`
    };
  },

  async *call({ file_path, offset, limit }, context) {
    // 1. 读取文件
    const content = fs.readFileSync(file_path, 'utf-8');

    // 2. 应用 offset 和 limit
    const lines = content.split('\n');
    const start = offset || 0;
    const end = limit ? start + limit : lines.length;
    const result = lines.slice(start, end).join('\n');

    // 3. 返回结果
    yield {
      type: "result",
      data: {
        content: result,
        totalLines: lines.length
      }
    };
  }
};
```

---

## 3. SDK 中的工具处理

SDK **没有**任何工具的实现代码,只有转发逻辑:

```javascript
// sdk.mjs 中的工具处理 (简化)

class Query {
  constructor(options) {
    this.availableTools = [];
    this.transport = new ProcessTransport(options);
  }

  async *execute() {
    // 1. 启动 CLI 进程
    await this.transport.start();

    // 2. 接收 init 消息
    for await (const message of this.transport.stream()) {
      if (message.type === "system" && message.subtype === "init") {
        // 存储工具列表
        this.availableTools = message.tools;

        // 转发给应用
        yield message;
        continue;
      }

      // 3. 处理工具调用
      if (message.type === "tool_use") {
        // SDK 不执行工具,只是转发给 CLI
        // CLI 已经通过 Claude API 接收到工具调用
        // SDK 只需要等待工具结果
        continue;
      }

      // 4. 转发工具结果
      if (message.type === "tool_result") {
        yield message;
        continue;
      }

      // 5. 转发其他消息
      yield message;
    }
  }
}
```

**关键点**:
- SDK 不知道任何工具的实现细节
- SDK 不执行工具逻辑
- SDK 只是一个"传声筒",负责在应用和 CLI 之间传递消息

---

## 4. 消息流对比

### 文件读取工具调用

```
┌─────────────┐
│ Application │
└──────┬──────┘
       │ "Read README.md"
       ↓
┌─────────────┐
│     SDK     │  ← 没有 Read 工具的实现
└──────┬──────┘
       │ stdin: { type: "user", message: "Read README.md" }
       ↓
┌─────────────┐
│     CLI     │  ← 有 Read 工具的实现代码
│             │
│ ReadTool {  │
│   call() {  │
│     const   │
│     content │
│     = fs    │
│     .read   │
│     FileSync│
│     (...)   │
│   }         │
│ }           │
└──────┬──────┘
       │ 调用 Claude API
       ↓
┌─────────────┐
│ Claude API  │
└──────┬──────┘
       │ 返回工具调用: { tool_use: "Read", input: {...} }
       ↓
┌─────────────┐
│     CLI     │
│             │
│ ├─ 执行    │
│ │  ReadTool│
│ │  .call() │
│ │           │
│ └─ 读取文件│
│    内容     │
└──────┬──────┘
       │ 返回: { tool_result: "[file content]" }
       ↓
┌─────────────┐
│     SDK     │  ← 只转发,不处理
└──────┬──────┘
       │ stdout: { type: "tool_result", content: "..." }
       ↓
┌─────────────┐
│ Application │
└─────────────┘
```

### Skill 工具调用

```
┌─────────────┐
│ Application │
└──────┬──────┘
       │ "Create a spreadsheet"
       ↓
┌─────────────┐
│     SDK     │  ← 没有 Skill 工具的实现
└──────┬──────┘
       │ stdin
       ↓
┌─────────────┐
│     CLI     │  ← 有 Skill 工具的实现
│             │
│ 1. 加载     │
│    skills   │
│    from     │
│    ~/.claude│
│    /skills/ │
│             │
│ 2. 注册    │
│    Skill   │
│    工具     │
│             │
│ 3. 发送    │
│    init    │
│    消息     │
└──────┬──────┘
       │ { tools: ["Skill", ...] }
       ↓
┌─────────────┐
│     SDK     │  ← 转发工具列表
└──────┬──────┘
       │
       ↓
┌─────────────┐
│ Application │  ← 看到 "Skill" 在工具列表中
└──────┬──────┘
       │
       │ (Claude 决定调用 Skill 工具)
       ↓
┌─────────────┐
│ Claude API  │
└──────┬──────┘
       │ { tool_use: "Skill", input: { skill: "xlsx" } }
       ↓
┌─────────────┐
│     CLI     │
│             │
│ SkillTool { │
│   async *   │
│   call() {  │
│     // 读取│
│     const   │
│     skill=  │
│     load    │
│     Skill   │
│     ("xlsx")│
│             │
│     // 注入│
│     inject  │
│     Into    │
│     System  │
│     Prompt  │
│     (skill) │
│   }         │
│ }           │
└──────┬──────┘
       │ { tool_result: "Skill activated", newMessages: [...] }
       ↓
┌─────────────┐
│     SDK     │  ← 只转发
└──────┬──────┘
       │
       ↓
┌─────────────┐
│ Application │
└─────────────┘
```

---

## 5. 为什么这样设计?

### 安全性

- **CLI 有文件系统访问权限**: 可以读写文件、执行命令
- **SDK 在不同的进程空间**: 隔离了安全风险
- **CLI 可以实施权限检查**: 在执行工具前检查用户授权

### 灵活性

- **CLI 可以独立更新**: 添加新工具不需要修改 SDK
- **插件系统**: MCP 服务器可以动态添加工具
- **权限系统**: CLI 可以实施细粒度的权限控制

### 职责分离

- **SDK 职责**: 进程通信、消息路由、流式处理
- **CLI 职责**: 工具实现、权限管理、系统集成

---

## 6. 总结

### SDK 的角色

```typescript
// SDK 只做这些事情:
class SDK {
  // 1. 启动 CLI 进程
  startCLI()

  // 2. 接收 CLI 发送的消息
  receiveCLIMessages()

  // 3. 转发消息给应用
  forwardToApplication(message)

  // 4. 接收应用的消息
  receiveApplicationMessages()

  // 5. 转发给 CLI
  forwardToCLI(message)
}
```

### CLI 的角色

```typescript
// CLI 做所有实际的工作:
class CLI {
  // 1. 注册所有工具
  registerTools() {
    this.tools = {
      Task: TaskToolImplementation,
      Bash: BashToolImplementation,
      Read: ReadToolImplementation,
      Write: WriteToolImplementation,
      Skill: SkillToolImplementation,
      SlashCommand: SlashCommandToolImplementation,
      // ... 所有其他工具
    }
  }

  // 2. 发送工具列表给 SDK
  sendInitMessage() {
    const toolNames = Object.keys(this.tools);
    send({ type: "init", tools: toolNames });
  }

  // 3. 执行工具
  async executeTool(toolName, input, context) {
    const tool = this.tools[toolName];

    // 验证
    await tool.validateInput(input, context);

    // 权限检查
    await tool.checkPermissions(input, context);

    // 执行
    return await tool.call(input, context);
  }
}
```

### 关键要点

1. **所有工具都在 CLI 中实现** - SDK 没有任何工具的实现代码
2. **SDK 是传输层** - 只负责消息的路由和转发
3. **CLI 是执行层** - 负责所有实际的工具逻辑
4. **工具列表在 init 消息中传递** - CLI → SDK → Application
5. **工具调用的执行流程**: Application → SDK → CLI → 执行工具 → CLI → SDK → Application
