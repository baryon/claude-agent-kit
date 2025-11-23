# Web 环境下的工具替换方案

## 问题分析

### CLI 默认工具在 Web 环境下的限制

| CLI 工具 | 依赖本地文件系统 | Web 环境是否适用 | 需要替换 |
|---------|-----------------|----------------|---------|
| **Read** | ✅ 读取本地文件 | ❌ | ✅ 需要替换 |
| **Write** | ✅ 写入本地文件 | ❌ | ✅ 需要替换 |
| **Edit** | ✅ 编辑本地文件 | ❌ | ✅ 需要替换 |
| **Bash** | ✅ 执行系统命令 | ❌ | ✅ 需要替换 |
| **Glob** | ✅ 搜索文件系统 | ❌ | ✅ 需要替换 |
| **Grep** | ✅ 搜索文件内容 | ❌ | ✅ 需要替换 |
| **Task** | ⚠️ 依赖子进程 | ⚠️ | ⚠️ 可能需要 |
| **Skill** | ❌ 从 systemPrompt | ✅ | ✅ 已通过 DB 解决 |
| **SlashCommand** | ⚠️ 可能依赖文件 | ⚠️ | ⚠️ 看具体命令 |
| **WebFetch** | ❌ 纯网络操作 | ✅ | ❌ |
| **WebSearch** | ❌ 纯网络操作 | ✅ | ❌ |
| **TodoWrite** | ⚠️ 可能写文件 | ⚠️ | ✅ 需要替换 |
| **AskUserQuestion** | ❌ UI 交互 | ✅ | ❌ |

---

## 解决方案概览

### 方案对比

| 方案 | 是否用 CLI | 复杂度 | 推荐度 |
|------|-----------|--------|--------|
| **方案 1: 禁用文件工具 + 提供 Web 工具** | ✅ | 🟡 中 | ⭐⭐⭐⭐⭐ |
| **方案 2: 虚拟文件系统 + CLI** | ✅ | 🔴 高 | ⭐⭐ |
| **方案 3: 完全不用 CLI** | ❌ | 🔴 高 | ⭐ |

---

## 方案 1: 禁用文件工具 + MCP 提供 Web 工具 (推荐)

### 核心思路

```
1. 禁用 CLI 的文件系统工具 (Read, Write, Grep, etc.)
2. 通过 MCP Server 提供 Web 环境的替代工具
3. 保留有用的 CLI 工具 (WebFetch, WebSearch, AskUserQuestion)
```

### 架构设计

```
┌──────────────────────────────────────────────┐
│           Web Application                    │
│                                              │
│  用户数据:                                    │
│  ├─ Documents (数据库)                       │
│  ├─ Code Files (数据库)                      │
│  ├─ Skills (数据库)                          │
│  └─ Projects (数据库)                        │
│                                              │
└────────────────┬─────────────────────────────┘
                 ↓
┌──────────────────────────────────────────────┐
│              SDK + CLI                       │
│                                              │
│  禁用的工具:                                  │
│  ❌ Read, Write, Edit                        │
│  ❌ Bash, Glob, Grep                         │
│                                              │
│  保留的工具:                                  │
│  ✅ WebFetch, WebSearch                      │
│  ✅ AskUserQuestion                          │
│  ✅ Skills (从 DB)                           │
│                                              │
│  新增的 MCP 工具:                             │
│  ✅ DatabaseRead                             │
│  ✅ DatabaseWrite                            │
│  ✅ DatabaseSearch                           │
│  ✅ DatabaseQuery                            │
│  ✅ CodeExecute                              │
│  ✅ VisualizationCreate                      │
│                                              │
└──────────────────────────────────────────────┘
```

---

## Web 环境工具映射

### 文件操作 → 数据库操作

| CLI 工具 | 原功能 | Web 替代工具 | 新功能 |
|---------|--------|-------------|--------|
| **Read** | 读取本地文件 | **DatabaseRead** | 读取数据库中的文档/代码 |
| **Write** | 写入本地文件 | **DatabaseWrite** | 创建/更新数据库记录 |
| **Edit** | 编辑本地文件 | **DatabaseEdit** | 更新数据库记录的内容 |
| **Glob** | 搜索文件名 | **DatabaseList** | 列出数据库中的文档/项目 |
| **Grep** | 搜索文件内容 | **DatabaseSearch** | 全文搜索数据库内容 |

### 执行操作 → 沙盒执行

| CLI 工具 | 原功能 | Web 替代工具 | 新功能 |
|---------|--------|-------------|--------|
| **Bash** | 执行系统命令 | **CodeExecute** | 在沙盒中执行代码 |
| **Task** | 启动子代理 | **WorkflowExecute** | 执行预定义的工作流 |

### 数据操作 → 数据库操作

| CLI 工具 | 原功能 | Web 替代工具 | 新功能 |
|---------|--------|-------------|--------|
| **TodoWrite** | 写入 TODO 文件 | **TaskManage** | 管理数据库中的任务 |

---

## 实现: MCP Server 提供 Web 工具

### 步骤 1: 数据库 Schema

```sql
-- 文档/代码文件
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,  -- 'code', 'markdown', 'json', etc.
  content TEXT NOT NULL,
  language VARCHAR(50),  -- 'typescript', 'python', etc.
  path VARCHAR(500),  -- 虚拟路径: /project/src/index.ts
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  INDEX(user_id),
  INDEX(project_id),
  INDEX(path)
);

-- 全文搜索索引
CREATE INDEX documents_content_fts_idx ON documents
USING GIN(to_tsvector('english', content));

-- 项目
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 任务
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_id UUID,
  content TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',  -- pending, in_progress, completed
  active_form TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 步骤 2: 创建 MCP Server

创建 `web-tools-mcp/`:

```
web-tools-mcp/
├── package.json
├── src/
│   ├── index.ts
│   ├── tools/
│   │   ├── database-read.ts
│   │   ├── database-write.ts
│   │   ├── database-search.ts
│   │   ├── database-list.ts
│   │   ├── code-execute.ts
│   │   └── task-manage.ts
│   └── db.ts
└── tsconfig.json
```

**package.json**:
```json
{
  "name": "web-tools-mcp",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "mcpServer": {
    "command": "node",
    "args": ["dist/index.js"]
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0",
    "pg": "^8.11.0",
    "zod": "^3.22.0"
  }
}
```

**src/index.ts**:
```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pool } from "./db.js";

// 从环境变量获取当前用户
const currentUserId = process.env.CURRENT_USER_ID;

const server = new Server(
  {
    name: "web-tools",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ============================================
// 工具 1: DatabaseRead - 读取文档
// ============================================
const DatabaseReadSchema = z.object({
  path: z.string().describe("Document path, e.g., /project/src/index.ts"),
  document_id: z.string().uuid().optional().describe("Document ID (alternative to path)"),
});

async function databaseRead(input: z.infer<typeof DatabaseReadSchema>) {
  let query, params;

  if (input.document_id) {
    query = `
      SELECT id, name, type, content, language, path, metadata
      FROM documents
      WHERE id = $1 AND user_id = $2
    `;
    params = [input.document_id, currentUserId];
  } else {
    query = `
      SELECT id, name, type, content, language, path, metadata
      FROM documents
      WHERE path = $1 AND user_id = $2
    `;
    params = [input.path, currentUserId];
  }

  const result = await pool.query(query, params);

  if (result.rows.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Document not found: ${input.path || input.document_id}`,
        },
      ],
      isError: true,
    };
  }

  const doc = result.rows[0];

  return {
    content: [
      {
        type: "text",
        text: `# ${doc.name}
Path: ${doc.path}
Type: ${doc.type}
Language: ${doc.language || 'N/A'}

${doc.content}`,
      },
    ],
  };
}

// ============================================
// 工具 2: DatabaseWrite - 写入/更新文档
// ============================================
const DatabaseWriteSchema = z.object({
  path: z.string().describe("Document path"),
  content: z.string().describe("Document content"),
  type: z.string().optional().describe("Document type (code, markdown, etc.)"),
  language: z.string().optional().describe("Programming language"),
  project_id: z.string().uuid().optional().describe("Project ID"),
});

async function databaseWrite(input: z.infer<typeof DatabaseWriteSchema>) {
  // 检查文档是否存在
  const existing = await pool.query(
    `SELECT id FROM documents WHERE path = $1 AND user_id = $2`,
    [input.path, currentUserId]
  );

  let result;

  if (existing.rows.length > 0) {
    // 更新现有文档
    result = await pool.query(
      `
      UPDATE documents
      SET content = $1, updated_at = NOW(), language = $2
      WHERE id = $3 AND user_id = $4
      RETURNING id, name, path
      `,
      [input.content, input.language, existing.rows[0].id, currentUserId]
    );
  } else {
    // 创建新文档
    const name = input.path.split('/').pop() || 'Untitled';
    const type = input.type || 'code';

    result = await pool.query(
      `
      INSERT INTO documents (user_id, project_id, name, type, content, language, path)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, name, path
      `,
      [currentUserId, input.project_id, name, type, input.content, input.language, input.path]
    );
  }

  const doc = result.rows[0];

  return {
    content: [
      {
        type: "text",
        text: `Document saved successfully:
- ID: ${doc.id}
- Path: ${doc.path}
- Name: ${doc.name}`,
      },
    ],
  };
}

// ============================================
// 工具 3: DatabaseSearch - 全文搜索
// ============================================
const DatabaseSearchSchema = z.object({
  query: z.string().describe("Search query (supports full-text search)"),
  type: z.string().optional().describe("Filter by document type"),
  project_id: z.string().uuid().optional().describe("Filter by project"),
  limit: z.number().optional().default(10).describe("Max results"),
});

async function databaseSearch(input: z.infer<typeof DatabaseSearchSchema>) {
  let query = `
    SELECT id, name, type, path, language,
           ts_headline('english', content, plainto_tsquery('english', $1)) as snippet,
           ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) as rank
    FROM documents
    WHERE user_id = $2
      AND to_tsvector('english', content) @@ plainto_tsquery('english', $1)
  `;

  const params: any[] = [input.query, currentUserId];
  let paramIndex = 3;

  if (input.type) {
    query += ` AND type = $${paramIndex}`;
    params.push(input.type);
    paramIndex++;
  }

  if (input.project_id) {
    query += ` AND project_id = $${paramIndex}`;
    params.push(input.project_id);
    paramIndex++;
  }

  query += ` ORDER BY rank DESC LIMIT $${paramIndex}`;
  params.push(input.limit);

  const result = await pool.query(query, params);

  if (result.rows.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No documents found matching: "${input.query}"`,
        },
      ],
    };
  }

  const results = result.rows
    .map((row, i) => {
      return `${i + 1}. **${row.name}** (${row.path})
   Type: ${row.type} | Language: ${row.language || 'N/A'}

   ${row.snippet}
   `;
    })
    .join('\n---\n');

  return {
    content: [
      {
        type: "text",
        text: `Found ${result.rows.length} documents:\n\n${results}`,
      },
    ],
  };
}

// ============================================
// 工具 4: DatabaseList - 列出文档
// ============================================
const DatabaseListSchema = z.object({
  project_id: z.string().uuid().optional().describe("Filter by project"),
  type: z.string().optional().describe("Filter by document type"),
  path_prefix: z.string().optional().describe("Filter by path prefix"),
});

async function databaseList(input: z.infer<typeof DatabaseListSchema>) {
  let query = `
    SELECT id, name, type, path, language, created_at, updated_at
    FROM documents
    WHERE user_id = $1
  `;

  const params: any[] = [currentUserId];
  let paramIndex = 2;

  if (input.project_id) {
    query += ` AND project_id = $${paramIndex}`;
    params.push(input.project_id);
    paramIndex++;
  }

  if (input.type) {
    query += ` AND type = $${paramIndex}`;
    params.push(input.type);
    paramIndex++;
  }

  if (input.path_prefix) {
    query += ` AND path LIKE $${paramIndex}`;
    params.push(`${input.path_prefix}%`);
    paramIndex++;
  }

  query += ` ORDER BY path`;

  const result = await pool.query(query, params);

  if (result.rows.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "No documents found.",
        },
      ],
    };
  }

  const list = result.rows
    .map((row) => {
      return `- ${row.path} (${row.type})`;
    })
    .join('\n');

  return {
    content: [
      {
        type: "text",
        text: `Found ${result.rows.length} documents:\n\n${list}`,
      },
    ],
  };
}

// ============================================
// 工具 5: CodeExecute - 执行代码 (沙盒)
// ============================================
const CodeExecuteSchema = z.object({
  language: z.enum(["javascript", "python", "sql"]).describe("Programming language"),
  code: z.string().describe("Code to execute"),
  timeout: z.number().optional().default(5000).describe("Timeout in milliseconds"),
});

async function codeExecute(input: z.infer<typeof CodeExecuteSchema>) {
  // 这里需要集成代码执行沙盒
  // 例如: https://github.com/patriksimek/vm2 (JavaScript)
  // 或者: Docker 容器 (通用)
  // 或者: WebAssembly (浏览器)

  // 示例实现 (仅用于演示,生产环境需要真正的沙盒)
  if (input.language === "javascript") {
    try {
      // ⚠️ 警告: 这不是真正的沙盒,仅用于演示
      // 生产环境必须使用 vm2 或 Docker
      const { VM } = await import("vm2");
      const vm = new VM({ timeout: input.timeout });
      const result = vm.run(input.code);

      return {
        content: [
          {
            type: "text",
            text: `Execution successful:\n\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Execution failed:\n\n${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  return {
    content: [
      {
        type: "text",
        text: `Language ${input.language} not yet supported`,
      },
    ],
    isError: true,
  };
}

// ============================================
// 工具 6: TaskManage - 管理任务
// ============================================
const TaskManageSchema = z.object({
  action: z.enum(["create", "update", "list", "delete"]).describe("Action to perform"),
  tasks: z.array(z.object({
    content: z.string(),
    status: z.enum(["pending", "in_progress", "completed"]),
    active_form: z.string(),
  })).optional().describe("Tasks to create/update"),
  task_id: z.string().uuid().optional().describe("Task ID for update/delete"),
});

async function taskManage(input: z.infer<typeof TaskManageSchema>) {
  if (input.action === "create" && input.tasks) {
    // 批量创建任务
    const values = input.tasks.map((task, i) => {
      const offset = i * 4;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
    }).join(', ');

    const params = input.tasks.flatMap(task => [
      currentUserId,
      task.content,
      task.status,
      task.active_form,
    ]);

    await pool.query(
      `INSERT INTO tasks (user_id, content, status, active_form) VALUES ${values}`,
      params
    );

    return {
      content: [
        {
          type: "text",
          text: `Created ${input.tasks.length} tasks`,
        },
      ],
    };
  }

  if (input.action === "list") {
    const result = await pool.query(
      `SELECT id, content, status, active_form, created_at
       FROM tasks
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [currentUserId]
    );

    const list = result.rows
      .map((row, i) => {
        const statusIcon = row.status === 'completed' ? '✅' :
                          row.status === 'in_progress' ? '🔄' : '⏳';
        return `${i + 1}. [${statusIcon}] ${row.content}`;
      })
      .join('\n');

    return {
      content: [
        {
          type: "text",
          text: `Current tasks:\n\n${list}`,
        },
      ],
    };
  }

  // 其他操作...
  return {
    content: [
      {
        type: "text",
        text: `Action ${input.action} completed`,
      },
    ],
  };
}

// ============================================
// 注册所有工具
// ============================================
server.setRequestHandler("tools/list", async () => {
  return {
    tools: [
      {
        name: "database_read",
        description: "Read a document from the database by path or ID",
        inputSchema: DatabaseReadSchema,
      },
      {
        name: "database_write",
        description: "Create or update a document in the database",
        inputSchema: DatabaseWriteSchema,
      },
      {
        name: "database_search",
        description: "Search documents using full-text search",
        inputSchema: DatabaseSearchSchema,
      },
      {
        name: "database_list",
        description: "List documents with optional filters",
        inputSchema: DatabaseListSchema,
      },
      {
        name: "code_execute",
        description: "Execute code in a sandboxed environment",
        inputSchema: CodeExecuteSchema,
      },
      {
        name: "task_manage",
        description: "Manage tasks (create, update, list, delete)",
        inputSchema: TaskManageSchema,
      },
    ],
  };
});

server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "database_read":
      return await databaseRead(args);
    case "database_write":
      return await databaseWrite(args);
    case "database_search":
      return await databaseSearch(args);
    case "database_list":
      return await databaseList(args);
    case "code_execute":
      return await codeExecute(args);
    case "task_manage":
      return await taskManage(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Web Tools MCP server running");
}

main().catch(console.error);
```

**src/db.ts**:
```typescript
import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
```

### 步骤 3: SDK 集成

```typescript
// server/session-manager.ts
import { SimpleClaudeAgentSDKClient } from "@claude-agent-kit/server";
import path from "path";

export async function createUserSession(userId: string, projectId?: string) {
  const sdkClient = new SimpleClaudeAgentSDKClient();

  // 加载用户的 skills
  const skills = await loadUserSkills(userId);

  const options = {
    // 工作目录 (虽然不会真正使用文件系统)
    cwd: path.join("/tmp", "workspace", userId),

    // 注入 skills
    appendSystemPrompt: generateSkillsPrompt(skills),

    // 传递用户信息给 MCP server
    env: {
      CURRENT_USER_ID: userId,
      CURRENT_PROJECT_ID: projectId,
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_NAME: process.env.DB_NAME,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
    },

    // 禁用文件系统工具
    disallowedTools: [
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Glob",
      "Grep",
      "NotebookEdit",
    ],

    // 指定 MCP servers
    mcpServers: {
      "web-tools": {
        command: "node",
        args: [path.join(process.cwd(), "web-tools-mcp/dist/index.js")],
        env: {
          CURRENT_USER_ID: userId,
          DB_HOST: process.env.DB_HOST,
          DB_NAME: process.env.DB_NAME,
          DB_USER: process.env.DB_USER,
          DB_PASSWORD: process.env.DB_PASSWORD,
        },
      },
    },
  };

  return { sdkClient, options };
}
```

---

## 使用示例

### 示例 1: 读取文档

**用户输入**:
```
"Read the user profile component"
```

**Claude 的操作**:
```json
{
  "tool_use": "database_read",
  "input": {
    "path": "/project/components/UserProfile.tsx"
  }
}
```

**返回**:
```
# UserProfile.tsx
Path: /project/components/UserProfile.tsx
Type: code
Language: typescript

import React from 'react';

export function UserProfile({ user }) {
  return (
    <div className="profile">
      <h1>{user.name}</h1>
      ...
    </div>
  );
}
```

### 示例 2: 搜索代码

**用户输入**:
```
"Find all components that use the useState hook"
```

**Claude 的操作**:
```json
{
  "tool_use": "database_search",
  "input": {
    "query": "useState",
    "type": "code",
    "limit": 10
  }
}
```

**返回**:
```
Found 5 documents:

1. **UserProfile.tsx** (/project/components/UserProfile.tsx)
   Type: code | Language: typescript

   const [user, setUser] = <b>useState</b>(null);

2. **Dashboard.tsx** (/project/pages/Dashboard.tsx)
   Type: code | Language: typescript

   const [data, setData] = <b>useState</b>([]);
...
```

### 示例 3: 创建新文件

**用户输入**:
```
"Create a new API route for user authentication"
```

**Claude 的操作**:
```json
{
  "tool_use": "database_write",
  "input": {
    "path": "/project/api/auth.ts",
    "type": "code",
    "language": "typescript",
    "content": "import { Router } from 'express';\n\nconst router = Router();\n\nrouter.post('/login', async (req, res) => {\n  // ...\n});\n\nexport default router;"
  }
}
```

### 示例 4: 管理任务

**用户输入**:
```
"Create a todo list for implementing the auth system"
```

**Claude 的操作**:
```json
{
  "tool_use": "task_manage",
  "input": {
    "action": "create",
    "tasks": [
      {
        "content": "Design authentication schema",
        "status": "pending",
        "active_form": "Designing authentication schema"
      },
      {
        "content": "Implement JWT token generation",
        "status": "pending",
        "active_form": "Implementing JWT token generation"
      },
      {
        "content": "Create login endpoint",
        "status": "pending",
        "active_form": "Creating login endpoint"
      }
    ]
  }
}
```

---

## 工具对照表

### 完整的工具映射

| 场景 | CLI 工具 | Web 工具 | 说明 |
|------|---------|---------|------|
| 读取文件 | Read | database_read | 从数据库读取文档 |
| 写入文件 | Write | database_write | 写入/更新数据库文档 |
| 编辑文件 | Edit | database_write | 更新数据库文档内容 |
| 搜索文件名 | Glob | database_list | 列出数据库文档 |
| 搜索内容 | Grep | database_search | 全文搜索 |
| 执行命令 | Bash | code_execute | 沙盒执行代码 |
| 管理 TODO | TodoWrite | task_manage | 数据库存储任务 |
| 网络请求 | WebFetch | WebFetch | 保留 |
| 搜索网络 | WebSearch | WebSearch | 保留 |
| 询问用户 | AskUserQuestion | AskUserQuestion | 保留 |
| Skills | Skill | (systemPrompt) | 从数据库注入 |

---

## 系统提示示例

为了让 Claude 知道使用哪些工具,需要在 systemPrompt 中说明:

```typescript
const webEnvironmentPrompt = `
# Environment Information

You are operating in a **web environment** with the following tools:

## Document Management
- **database_read**: Read documents from the database
  - Use this instead of the "Read" tool
  - Example: database_read({ path: "/project/src/index.ts" })

- **database_write**: Create or update documents
  - Use this instead of the "Write" or "Edit" tools
  - Example: database_write({ path: "/project/src/new.ts", content: "..." })

- **database_list**: List documents
  - Use this instead of the "Glob" tool
  - Example: database_list({ path_prefix: "/project/src/" })

- **database_search**: Search document content
  - Use this instead of the "Grep" tool
  - Supports full-text search
  - Example: database_search({ query: "function getUserData" })

## Code Execution
- **code_execute**: Execute code in a sandboxed environment
  - Use this instead of the "Bash" tool
  - Supports: JavaScript, Python, SQL
  - Example: code_execute({ language: "javascript", code: "..." })

## Task Management
- **task_manage**: Manage tasks
  - Use this instead of the "TodoWrite" tool
  - Example: task_manage({ action: "create", tasks: [...] })

## Important Notes
- All files are stored in a **database**, not a filesystem
- Use **database_*** tools for file operations
- Paths are virtual (e.g., /project/src/file.ts)
- Code execution happens in a sandbox, not on the system
`;

const options = {
  appendSystemPrompt: webEnvironmentPrompt + generateSkillsPrompt(skills),
  disallowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  // ...
};
```

---

## 安全考虑

### 代码执行沙盒

**不要使用 eval()** - 必须使用真正的沙盒:

```typescript
// ❌ 不安全 - 永远不要这样做
function codeExecute(code: string) {
  return eval(code);  // 可以执行任意代码!
}

// ✅ 安全选项 1: vm2 (Node.js)
import { VM } from "vm2";
const vm = new VM({ timeout: 5000, sandbox: {} });
const result = vm.run(code);

// ✅ 安全选项 2: Docker 容器
import Docker from "dockerode";
const docker = new Docker();
const container = await docker.createContainer({
  Image: "node:18-alpine",
  Cmd: ["node", "-e", code],
  HostConfig: {
    Memory: 128 * 1024 * 1024,  // 128MB
    CpuQuota: 50000,  // 50% CPU
  },
});

// ✅ 安全选项 3: WebAssembly (浏览器)
// 编译代码到 WASM,在隔离的环境中执行
```

### 数据库权限

确保每个用户只能访问自己的数据:

```sql
-- 所有查询都必须包含 user_id 检查
SELECT * FROM documents
WHERE user_id = $1  -- 必须!
  AND path = $2;

-- 使用 Row Level Security (RLS)
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_documents_policy ON documents
  FOR ALL
  USING (user_id = current_setting('app.current_user_id')::uuid);
```

---

## 总结

### ✅ 推荐方案

1. **使用 CLI + MCP** - 保留 CLI 的基础能力
2. **禁用文件工具** - 通过 `disallowedTools` 禁用
3. **提供 Web 工具** - 通过 MCP Server 提供数据库操作
4. **注入说明** - 通过 systemPrompt 告诉 Claude 使用哪些工具

### 🛠️ Web 环境核心工具

- `database_read` - 读取文档
- `database_write` - 写入文档
- `database_search` - 全文搜索
- `database_list` - 列出文档
- `code_execute` - 沙盒执行
- `task_manage` - 任务管理

### ⚠️ 关键注意事项

1. **代码执行必须在沙盒中** - 使用 vm2/Docker/WASM
2. **数据库必须隔离用户** - 所有查询包含 user_id
3. **明确告诉 Claude** - 在 systemPrompt 中说明使用 database_* 工具
4. **禁用文件工具** - 防止 Claude 尝试使用 Read/Write

你的 Web 应用完全可以使用 SDK + CLI,只需要:
1. 禁用文件工具
2. 通过 MCP 提供数据库操作工具
3. 在 systemPrompt 中说明使用方法

🎉 这样就能在 Web 环境中充分利用 Claude Agent SDK 的能力了!
