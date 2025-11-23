# Claude Code Skills 和 Plugins 系统详解

## 目录

1. [Skills vs Plugins 对比](#skills-vs-plugins-对比)
2. [Skills 系统](#skills-系统)
3. [Plugins 系统](#plugins-系统)
4. [SDK 集成机制](#sdk-集成机制)
5. [实践示例](#实践示例)

---

## Skills vs Plugins 对比

### 核心区别

| 特性 | Skills | Plugins |
|------|--------|---------|
| **本质** | **提示词增强** (Prompt Engineering) | **代码扩展** (Code Extension) |
| **实现方式** | Markdown 文件 + 系统提示注入 | Node.js/TypeScript 代码包 |
| **激活机制** | 通过 Skill tool 或自动匹配 | 通过 MCP 服务器或工具调用 |
| **存储位置** | `~/.claude/skills/` | `~/.claude/plugins/` |
| **运行环境** | Claude 对话上下文 | Node.js 进程 |
| **能力范围** | 指导 Claude 行为和输出格式 | 扩展 Claude 工具能力 |
| **开发难度** | 低 (写 Markdown) | 高 (写代码 + 测试) |
| **示例** | algorithmic-art, canvas-design | document-skills (xlsx/pdf/docx) |

### 概念模型

```
┌─────────────────────────────────────────────────┐
│              Claude Code CLI                    │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │         System Prompt Layer              │  │
│  │  - 基础系统提示                            │  │
│  │  - Skills 注入的提示                       │  │
│  │  - appendSystemPrompt                     │  │
│  └──────────────────────────────────────────┘  │
│                      │                          │
│                      ↓                          │
│  ┌──────────────────────────────────────────┐  │
│  │         Tool Execution Layer             │  │
│  │  - 内置工具 (Read, Write, Bash...)         │  │
│  │  - MCP 工具 (远程 MCP 服务器)              │  │
│  │  - Plugin 工具 (SDK MCP 服务器)            │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
└─────────────────────────────────────────────────┘

Skills 影响:  System Prompt → Claude 生成内容
Plugins 影响: Tool Execution → 实际执行能力
```

---

## Skills 系统

### 1. Skill 结构

**文件组织**:
```
~/.claude/skills/
├── algorithmic-art/
│   ├── SKILL.md              # 主技能文件
│   ├── LICENSE.txt
│   └── templates/            # 可选模板
├── document-skills/
│   ├── xlsx/
│   │   └── SKILL.md          # 子技能
│   ├── pdf/
│   │   ├── SKILL.md
│   │   ├── reference.md      # 参考文档
│   │   └── forms.md
│   └── docx/
│       └── SKILL.md
└── canvas-design/
    └── SKILL.md
```

**SKILL.md 格式**:
```markdown
---
name: algorithmic-art
description: Creating algorithmic art using p5.js with seeded randomness...
license: Complete terms in LICENSE.txt
---

# Skill 内容

这里是会被注入到 Claude 系统提示中的内容。

可以包含:
- 指导原则
- 工作流程
- 示例代码
- 最佳实践
- 格式要求
```

### 2. Skill 激活机制

#### 方式 1: Skill Tool (显式调用)

用户在对话中使用 Skill tool:

```
User: Use the algorithmic-art skill to create a particle system

Claude 处理流程:
1. 检测到 Skill tool 调用
2. 读取 ~/.claude/skills/algorithmic-art/SKILL.md
3. 将内容注入到当前对话的系统提示
4. 根据 Skill 指导生成响应
```

#### 方式 2: 自动匹配 (隐式激活)

Claude Code 根据对话内容自动激活相关 Skill:

```
User: Can you create a spreadsheet for budget tracking?

Claude 处理流程:
1. 分析请求关键词: "spreadsheet", "xlsx"
2. 匹配 document-skills/xlsx 的 description
3. 自动加载 xlsx/SKILL.md 到系统提示
4. 根据 Skill 指导生成符合规范的代码
```

**匹配逻辑**:
```typescript
// 伪代码
function matchSkill(userMessage: string): Skill | null {
  for (const skill of availableSkills) {
    // 检查 description 中的关键词
    if (skill.description.includes(keyword)) {
      return skill;
    }

    // 检查触发条件
    if (skill.triggers && skill.triggers.some(t => matches(userMessage, t))) {
      return skill;
    }
  }
  return null;
}
```

### 3. Skill 实现示例

**algorithmic-art Skill**:

```markdown
---
name: algorithmic-art
description: Creating algorithmic art using p5.js...
---

## ALGORITHMIC PHILOSOPHY CREATION

Create an ALGORITHMIC PHILOSOPHY expressed through:
- Computational processes, emergent behavior
- Seeded randomness, noise fields
- Particles, flows, fields, forces

### PROCESS
1. Name the movement (1-2 words)
2. Articulate philosophy (4-6 paragraphs)
3. Express through p5.js code

### EXAMPLES
**"Organic Turbulence"**
Flow fields driven by Perlin noise. Particles following
vector forces, trails accumulating into density maps...

### OUTPUT
- philosophy.md: Algorithmic philosophy document
- sketch.html: Interactive p5.js viewer
- sketch.js: Generative algorithm
```

**工作原理**:
1. 用户请求生成艺术作品
2. Skill 被激活,内容注入系统提示
3. Claude 按照 Skill 定义的流程:
   - 先创建哲学文档
   - 再生成 p5.js 代码
   - 输出符合规范的文件

### 4. Skill 的优势

**提示词工程的最佳实践封装**:
- ✅ 复杂的工作流程标准化
- ✅ 输出格式一致性
- ✅ 领域知识注入
- ✅ 多步骤任务指导

**示例: xlsx Skill 的价值**:

Without Skill:
```
User: Create a financial model
Claude: [生成简单表格,没有公式,格式混乱]
```

With Skill:
```
User: Create a financial model
Claude: [根据 xlsx/SKILL.md 的规范]
  - 使用蓝色标记输入
  - 使用黑色标记公式
  - 货币格式: $#,##0
  - 零值显示为 "-"
  - 负数用括号表示
  - 添加数据源注释
  - 所有假设放在单独单元格
```

---

## Plugins 系统

### 1. Plugin 架构

**Plugins 是通过 MCP (Model Context Protocol) 实现的代码扩展**:

```
┌─────────────────────────────────────────────┐
│          Claude Code CLI                    │
│                                             │
│  ┌───────────────────────────────────────┐ │
│  │      MCP Client (内置)                  │ │
│  │  - 连接 MCP 服务器                       │ │
│  │  - 发现工具列表                          │ │
│  │  - 调用工具方法                          │ │
│  └───────────────┬───────────────────────┘ │
│                  │                          │
└──────────────────┼──────────────────────────┘
                   │ MCP Protocol
                   │ (JSON-RPC)
     ┌─────────────▼─────────────┐
     │   Plugin MCP Server       │
     │   (独立 Node.js 进程)      │
     │                           │
     │  ┌─────────────────────┐ │
     │  │  Tool Definitions   │ │
     │  │  - xlsx_read()      │ │
     │  │  - xlsx_write()     │ │
     │  │  - pdf_extract()    │ │
     │  └─────────────────────┘ │
     │                           │
     │  ┌─────────────────────┐ │
     │  │  Implementation     │ │
     │  │  - ExcelJS library  │ │
     │  │  - pdf-lib library  │ │
     │  └─────────────────────┘ │
     └───────────────────────────┘
```

### 2. Plugin 安装和配置

**安装位置**:
```
~/.claude/plugins/
├── config.json                    # 全局配置
├── installed_plugins.json         # 已安装插件清单
├── known_marketplaces.json        # 插件市场列表
├── marketplaces/
│   └── anthropic-agent-skills/   # 官方插件市场
│       └── document-skills/       # 插件包
│           ├── package.json
│           ├── dist/              # 编译后代码
│           └── src/               # 源代码
└── repos/                         # 自定义插件仓库
```

**installed_plugins.json**:
```json
{
  "version": 1,
  "plugins": {
    "document-skills@anthropic-agent-skills": {
      "version": "unknown",
      "installedAt": "2025-11-07T02:30:24.523Z",
      "installPath": "/Users/user/.claude/plugins/marketplaces/...",
      "gitCommitSha": "c74d647e56e6daa12029b6acb11a821348ad044b",
      "isLocal": true
    }
  }
}
```

### 3. Plugin 工作流程

**启动阶段**:
```
1. Claude Code CLI 启动
   ↓
2. 读取 installed_plugins.json
   ↓
3. 对于每个已安装插件:
   a. 读取 package.json
   b. 启动 MCP 服务器 (子进程)
   c. 通过 stdin/stdout 建立通信
   ↓
4. 发送 initialize 请求
   ↓
5. 接收工具列表
   ↓
6. 将工具注册到 Claude 可用工具集
```

**工具调用阶段**:
```
User: "Extract text from PDF"
   ↓
Claude 决定使用 pdf_extract 工具
   ↓
Claude Code CLI 发送 MCP 请求:
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "pdf_extract",
    "arguments": {
      "file_path": "/path/to/file.pdf"
    }
  }
}
   ↓
Plugin MCP Server 执行:
async function pdf_extract(args) {
  const pdfDoc = await PDFDocument.load(args.file_path);
  const text = await extractText(pdfDoc);
  return { content: [{ type: "text", text }] };
}
   ↓
返回结果给 Claude
   ↓
Claude 将结果整合到响应中
```

### 4. Plugin 示例: document-skills

**package.json**:
```json
{
  "name": "document-skills",
  "version": "1.0.0",
  "skills": [
    {
      "name": "xlsx",
      "description": "Excel spreadsheet operations",
      "skillPath": "skills/xlsx/SKILL.md"
    },
    {
      "name": "pdf",
      "description": "PDF manipulation",
      "skillPath": "skills/pdf/SKILL.md"
    }
  ],
  "mcpServer": {
    "command": "node",
    "args": ["dist/index.js"]
  }
}
```

**MCP 服务器实现**:
```typescript
// src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({
  name: "document-skills",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});

// 注册工具
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "xlsx_read",
        description: "Read Excel file",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string" }
          }
        }
      },
      {
        name: "xlsx_write",
        description: "Write Excel file",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string" },
            data: { type: "object" }
          }
        }
      }
    ]
  };
});

// 工具调用处理
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "xlsx_read":
      return await handleXlsxRead(request.params.arguments);
    case "xlsx_write":
      return await handleXlsxWrite(request.params.arguments);
    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

// 启动服务器
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 5. Plugin 的优势

**真实代码执行能力**:
- ✅ 调用外部库 (ExcelJS, pdf-lib, docx...)
- ✅ 文件系统操作
- ✅ 网络请求
- ✅ 复杂数据处理
- ✅ 性能优化

**示例: PDF 表单填充**:

Without Plugin:
```
User: Fill out this PDF form
Claude: I cannot directly manipulate PDF files.
        I can only read and suggest values.
```

With Plugin:
```
User: Fill out this PDF form
Claude: [调用 pdf_fill_form 工具]
  → Plugin 使用 pdf-lib 库
  → 实际修改 PDF 字节流
  → 填充表单字段
  → 保存新 PDF 文件
✓ Done! PDF form filled and saved.
```

---

## SDK 集成机制

### 1. SDK 如何传递 Plugin 配置

**通过 `--plugin-dir` 参数**:

```typescript
// SDK 代码 (sdk.mjs:6474-6481)
if (plugins && plugins.length > 0) {
  for (const plugin of plugins) {
    if (plugin.type === "local") {
      args.push("--plugin-dir", plugin.path);
    } else {
      throw new Error(`Unsupported plugin type: ${plugin.type}`);
    }
  }
}
```

**使用示例**:
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const result = query({
  prompt: "Read data from spreadsheet.xlsx",
  options: {
    plugins: [
      {
        type: "local",
        path: "/path/to/document-skills"
      }
    ]
  }
});

// CLI 启动命令会包含:
// --plugin-dir /path/to/document-skills
```

### 2. SDK 不直接处理 Skills

**Skills 完全由 CLI 管理**:
```
SDK 层级:
  - 不知道 Skills 存在
  - 只负责传递 systemPrompt 和 appendSystemPrompt

CLI 层级:
  - 读取 ~/.claude/skills/
  - 匹配和加载 Skills
  - 将 Skill 内容注入系统提示
  - 执行对话
```

**systemPrompt 参数**:
```typescript
query({
  prompt: "Create art",
  options: {
    systemPrompt: {
      type: "preset",  // 使用预设系统提示
      append: "Additional instructions..."
    }
    // 或
    systemPrompt: "Complete custom system prompt"
  }
});
```

### 3. Plugin 作为 SDK MCP Server

**Plugin 也可以直接在 SDK 进程中运行**:

```typescript
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// 创建 SDK MCP 服务器
const myPlugin = createSdkMcpServer({
  name: "my-custom-tools",
  version: "1.0.0",
  tools: [
    tool(
      "calculate_tax",
      "Calculate sales tax",
      z.object({
        amount: z.number(),
        rate: z.number()
      }),
      async (input) => {
        const tax = input.amount * input.rate;
        return {
          content: [{ type: "text", text: `Tax: $${tax.toFixed(2)}` }]
        };
      }
    )
  ]
});

// 传递给 query
const result = query({
  prompt: "Calculate tax on $100 at 8.5%",
  options: {
    mcpServers: {
      "my-tools": myPlugin  // SDK MCP Server
    }
  }
});
```

**区别**:
- **Local Plugin** (`--plugin-dir`): 独立子进程,通过 stdio 通信
- **SDK MCP Server**: 同进程,直接函数调用

---

## 实践示例

### 示例 1: 使用 Skill 指导输出格式

**场景**: 创建财务模型

```typescript
// 不需要 SDK 代码,Skill 自动激活

User: "Create a quarterly revenue projection for SaaS company"

Claude 自动激活 document-skills/xlsx Skill:
  → 读取 ~/.claude/skills/document-skills/xlsx/SKILL.md
  → 注入系统提示:
     - 蓝色输入,黑色公式
     - 货币格式 $#,##0
     - 负数用括号
     - 零值显示为 "-"
     - ...

Claude 输出:
  → 创建符合金融行业标准的 Excel 文件
  → 所有格式规范自动应用
  → 公式正确,无硬编码值
```

### 示例 2: 使用 Plugin 扩展工具能力

**场景**: PDF 表单批量填充

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const result = query({
  prompt: `
    Fill out all PDF forms in /forms directory with data from data.csv
  `,
  options: {
    cwd: "/path/to/project",
    plugins: [
      {
        type: "local",
        path: "/Users/user/.claude/plugins/marketplaces/anthropic-agent-skills/document-skills"
      }
    ]
  }
});

// CLI 启动时加载 document-skills Plugin
// 提供 pdf_fill_form 工具
// Claude 可以:
//   1. 读取 CSV (内置 Read 工具)
//   2. 列出 PDF 文件 (内置 Glob 工具)
//   3. 填充每个 PDF (pdf_fill_form Plugin 工具)
//   4. 保存结果 (Plugin 工具内部实现)
```

### 示例 3: Skill + Plugin 组合

**场景**: 创建专业演示文稿

```typescript
// Skill: 指导 PowerPoint 格式和内容结构
// Plugin: 提供 pptx 文件操作能力

User: "Create a pitch deck for our startup"

工作流程:
1. document-skills/pptx Skill 激活
   → 注入演示文稿最佳实践
   → 幻灯片结构指导
   → 设计原则

2. Claude 生成内容策略
   → 标题幻灯片
   → 问题陈述
   → 解决方案
   → 市场机会
   → ...

3. 调用 pptx_create Plugin 工具
   → 实际创建 .pptx 文件
   → 应用模板
   → 插入内容
   → 格式化

4. 输出符合规范的专业演示文稿
```

### 示例 4: 自定义 SDK MCP Server + Skill

**场景**: 数据分析流程自动化

```typescript
import { createSdkMcpServer, tool, query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// 1. 创建自定义分析工具
const analyticsServer = createSdkMcpServer({
  name: "analytics-tools",
  tools: [
    tool(
      "run_sql_query",
      "Execute SQL query on database",
      z.object({ query: z.string() }),
      async (input) => {
        const results = await database.query(input.query);
        return {
          content: [{ type: "text", text: JSON.stringify(results) }]
        };
      }
    ),
    tool(
      "create_chart",
      "Generate chart from data",
      z.object({
        data: z.array(z.any()),
        type: z.enum(["bar", "line", "pie"])
      }),
      async (input) => {
        const chartUrl = await generateChart(input.data, input.type);
        return {
          content: [{ type: "image", url: chartUrl }]
        };
      }
    )
  ]
});

// 2. 创建自定义 Skill (保存到 ~/.claude/skills/data-analysis/)
const customSkill = `
---
name: data-analysis
description: Automated data analysis workflow
---

# Data Analysis Workflow

When analyzing data:
1. First, run SQL query to get data
2. Analyze statistical properties
3. Create appropriate visualizations
4. Summarize insights in business terms

# Best Practices
- Always validate data before charting
- Use appropriate chart types for data
- Include data source and timestamp
`;

// 3. 运行分析
const result = query({
  prompt: "Analyze sales trends for Q4 2024",
  options: {
    mcpServers: {
      "analytics": analyticsServer
    },
    appendSystemPrompt: customSkill  // 或让 CLI 自动加载 Skill
  }
});

// Claude 会:
// 1. 按照 Skill 指导的工作流程
// 2. 使用 run_sql_query 获取数据
// 3. 使用 create_chart 生成可视化
// 4. 以业务术语总结洞察
```

---

## 总结

### Skills 和 Plugins 的协同

```
┌────────────────────────────────────────────┐
│         Claude Code 完整能力                │
├────────────────────────────────────────────┤
│                                            │
│  Skills (提示词层)                          │
│  ┌──────────────────────────────────────┐ │
│  │ • 工作流程指导                         │ │
│  │ • 输出格式规范                         │ │
│  │ • 领域知识注入                         │ │
│  │ • 最佳实践封装                         │ │
│  └──────────────────────────────────────┘ │
│                  ↓                         │
│         影响 Claude 思维和输出               │
│                  ↓                         │
│  Plugins (工具层)                          │
│  ┌──────────────────────────────────────┐ │
│  │ • 文件操作能力                         │ │
│  │ • 外部库调用                          │ │
│  │ • 复杂数据处理                         │ │
│  │ • 网络和系统集成                       │ │
│  └──────────────────────────────────────┘ │
│                  ↓                         │
│         扩展 Claude 实际能力                │
│                                            │
└────────────────────────────────────────────┘

完美结合 = 知道怎么做 (Skill) + 能真正做到 (Plugin)
```

### 选择指南

**使用 Skill 当你需要**:
- ✅ 标准化 Claude 的输出格式
- ✅ 定义复杂的多步骤工作流程
- ✅ 注入领域专业知识
- ✅ 保持输出一致性
- ✅ 快速迭代提示词策略

**使用 Plugin 当你需要**:
- ✅ 调用外部库或 API
- ✅ 执行复杂计算或数据处理
- ✅ 操作二进制文件格式
- ✅ 与系统或网络集成
- ✅ 性能关键型操作

**结合使用当你需要**:
- 🎯 专业级输出质量 (Skill 指导格式)
- 🎯 强大的执行能力 (Plugin 实现功能)
- 🎯 端到端自动化工作流
- 🎯 可维护和可扩展的解决方案

### SDK 开发者注意事项

1. **Plugins 通过 `--plugin-dir` 参数传递**
   ```typescript
   plugins: [{ type: "local", path: "/path/to/plugin" }]
   ```

2. **Skills 由 CLI 自动管理**
   - SDK 不需要知道 Skills
   - 通过 `systemPrompt` 和 `appendSystemPrompt` 间接影响

3. **SDK MCP Server 是 Plugin 的替代方案**
   - 同进程执行,性能更好
   - 适合轻量级工具
   - 不适合需要独立环境的场景

4. **最佳实践**:
   - 简单工具 → SDK MCP Server
   - 复杂功能 → Local Plugin
   - 提示词优化 → 创建自定义 Skill
   - 组合使用获得最佳效果
