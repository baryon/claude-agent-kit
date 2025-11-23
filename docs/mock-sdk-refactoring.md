# Mock SDK 重构说明

## 概述

将 Mock SDK 从文件系统工具重构为 Web 环境数据库工具，保持接口简洁清晰。

## 核心变更

### 1. 工具替换

| 变更类型 | 原 CLI 工具 | 新 Web 工具 | 实现位置 |
|---------|------------|------------|---------|
| 文件读取 | Read | document_read | `web-tools.ts:89-112` |
| 文件写入 | Write, Edit | document_write | `web-tools.ts:142-153` |
| 内容搜索 | Grep | document_search | `web-tools.ts:180-213` |
| 文件列表 | Glob | document_list | `web-tools.ts:235-259` |
| 命令执行 | Bash | code_execute | `web-tools.ts:286-305` |

### 2. 架构保持

**不变部分**：
- SDK 核心接口（Query, AsyncIterator, Stream）
- MCP Server 注册机制
- Hook 系统
- 权限控制
- 会话管理

**变更部分**：
- 工具实现从文件系统改为数据库
- 工具名称从 CLI 风格改为 Web 风格
- 添加 Mock 数据库层

### 3. 文件结构

```
mock-sdk/
├── src/
│   ├── index.ts           # 主入口
│   │   ├── 导出 Web 工具（第 9-19 行）
│   │   ├── Query 类（第 494-782 行）
│   │   └── simulateCliToolRegistration() 更新（第 561-578 行）
│   ├── web-tools.ts       # Web 工具实现（新增）
│   │   ├── MockDocumentDatabase（第 30-71 行）
│   │   ├── 5 个工具定义（第 80-317 行）
│   │   └── 系统提示生成器（第 334-390 行）
│   └── types.ts           # 类型定义（保持不变）
├── examples/
│   └── web-example.ts     # 使用示例（新增）
└── README.md              # 简化的文档（重写）
```

## 实现细节

### MockDocumentDatabase

简单的内存数据库实现：

```typescript
class MockDocumentDatabase {
  private documents = new Map<string, WebDocument>();

  async read(path: string): Promise<WebDocument | null>
  async write(path: string, content: string, type?: string): Promise<WebDocument>
  async search(query: string): Promise<WebDocument[]>
  async list(pathPrefix?: string): Promise<WebDocument[]>
  async delete(path: string): Promise<boolean>
}
```

**位置**: `web-tools.ts:30-71`

### Web 工具定义

每个工具包含：
- `name`: 工具名称
- `description`: 工具描述
- `inputSchema`: 输入验证（SchemaLike）
- `handler`: 异步处理函数
- `annotations`: 元数据（标记替代的 CLI 工具）

**示例** (`web-tools.ts:114-124`):

```typescript
export const DocumentReadTool: ToolDefinition = {
  name: "document_read",
  description: "Read a document from the database (replaces 'Read' tool)",
  inputSchema: documentReadSchema,
  handler: documentReadHandler,
  enabled: true,
  annotations: {
    replaces: "Read",
    category: "document"
  }
};
```

### 系统提示

生成器告知 Claude 可用的 Web 工具 (`web-tools.ts:334-390`):

```typescript
export function getWebToolsSystemPrompt(): string {
  return `
# Web Environment Tools

You are operating in a web environment where files are stored in a database.

## Available Tools
- document_read: Read a document from the database
- document_write: Create or update a document
- document_search: Search document content
- document_list: List all documents
- code_execute: Execute code in a sandbox
...
  `;
}
```

## 使用方式

### 基础用法

```typescript
import {
  query,
  createSdkMcpServer,
  WEB_TOOLS,
  getMockDatabase
} from './mock-sdk';

// 1. 准备数据库
const db = getMockDatabase();
await db.write("/project/README.md", "# Hello", "text");

// 2. 创建 MCP 服务器
const webToolsServer = createSdkMcpServer({
  name: "web-tools",
  tools: WEB_TOOLS
});

// 3. 查询
const result = query({
  prompt: "Read the README file",
  options: { mcpServers: { "web-tools": webToolsServer } }
});

// 4. 处理响应
for await (const msg of result) {
  console.log(msg);
}
```

## 与真实环境集成

### 替换 Mock 数据库

在生产环境中，用真实数据库替换 `MockDocumentDatabase`:

```typescript
// PostgreSQL 实现
class PostgresDocumentDatabase {
  constructor(private pool: Pool) {}

  async read(path: string) {
    const { rows } = await this.pool.query(
      'SELECT * FROM documents WHERE path = $1',
      [path]
    );
    return rows[0] || null;
  }

  async search(query: string) {
    const { rows } = await this.pool.query(`
      SELECT * FROM documents
      WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
      ORDER BY ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) DESC
    `, [query]);
    return rows;
  }

  // ... 其他方法
}
```

### 数据库 Schema

参考 `docs/web-environment-tools.md` 的完整 Schema 设计：

```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  path VARCHAR(500) NOT NULL,
  content TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'text',
  language VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, path)
);

-- 全文搜索索引
CREATE INDEX documents_fts ON documents
USING GIN(to_tsvector('english', content));
```

## 关键设计决策

### 1. 保持 SDK 接口不变

SDK 的核心 API (Query, query(), AsyncIterator) 保持不变，只替换底层工具实现。

**理由**:
- 最小化破坏性变更
- 应用层代码无需修改
- 工具层可插拔

### 2. 工具名称语义化

使用 `document_read` 而非 `read`，明确表明是数据库操作。

**理由**:
- 避免与文件系统工具混淆
- 更清晰的语义
- 符合 Web 环境特点

### 3. Mock 数据库简化

内存实现，不依赖真实数据库。

**理由**:
- 降低测试依赖
- 快速原型验证
- 易于集成测试

### 4. 保留未改动工具

Task, WebFetch, TodoWrite 等工具保持不变。

**理由**:
- 这些工具不依赖文件系统
- Web 环境同样适用
- 减少变更范围

## 迁移指南

### 从 CLI SDK 迁移

如果你之前使用 CLI SDK:

```typescript
// 旧代码（CLI SDK）
import { query } from '@anthropic-ai/claude-agent-sdk';

const result = query({
  prompt: "Read README.md",
  options: { cwd: "/path/to/project" }
});
// Claude 会使用 Read 工具读取文件系统
```

迁移到 Web SDK:

```typescript
// 新代码（Web SDK）
import { query, createSdkMcpServer, WEB_TOOLS, getMockDatabase } from './mock-sdk';

// 1. 将文件内容导入数据库
const db = getMockDatabase();
await db.write("/project/README.md", fileContent, "text");

// 2. 注册 Web 工具
const webTools = createSdkMcpServer({
  name: "web-tools",
  tools: WEB_TOOLS
});

// 3. 查询（无需 cwd）
const result = query({
  prompt: "Read README.md",
  options: { mcpServers: { "web-tools": webTools } }
});
// Claude 会使用 document_read 工具从数据库读取
```

### 工具调用对比

**CLI SDK** (文件系统):
```
User: "Read the config file"
→ Claude 调用 Read 工具
→ CLI 读取 /path/to/config.json
→ 返回文件内容
```

**Web SDK** (数据库):
```
User: "Read the config file"
→ Claude 调用 document_read 工具
→ MCP Server 查询数据库: SELECT * FROM documents WHERE path = '/project/config.json'
→ 返回文档内容
```

## 测试

运行示例:

```bash
cd mock-sdk
npm install
npm run build
node examples/web-example.js
```

预期输出:

```
🌐 Web Environment Agent Example

📦 Created 3 sample documents in database

💬 Starting query...

🤖 Assistant: Mock response #1: List all documents and read the README file

📊 Usage: { input_tokens: ..., output_tokens: ... }

✅ Done: completed

🔧 Direct Tool Usage Examples:
...
```

## 性能考虑

### Mock 数据库

- **优点**: 快速、无依赖、内存操作
- **缺点**: 不持久化、不支持复杂查询
- **适用**: 测试、演示、原型

### 真实数据库

- **优点**: 持久化、全文搜索、并发支持
- **缺点**: 需要配置、网络延迟
- **适用**: 生产环境、多用户、大数据量

## 未来扩展

### 多租户支持

参考 `docs/database-skills-architecture.md` 添加用户隔离:

```typescript
interface WebDocument {
  id: string;
  user_id: string;  // 添加用户 ID
  org_id?: string;  // 添加组织 ID
  path: string;
  content: string;
  // ...
}

class MultiTenantDatabase {
  async read(userId: string, path: string) {
    return await db.query(
      'SELECT * FROM documents WHERE user_id = $1 AND path = $2',
      [userId, path]
    );
  }
}
```

### 权限控制

```typescript
interface DocumentPermission {
  document_id: string;
  user_id: string;
  permission: 'read' | 'write' | 'admin';
}

async function checkPermission(userId: string, docId: string, action: string) {
  const perm = await db.query(
    'SELECT permission FROM permissions WHERE user_id = $1 AND document_id = $2',
    [userId, docId]
  );
  return perm.permission === 'admin' || perm.permission === action;
}
```

### 实时协作

```typescript
// WebSocket 广播文档变更
io.on('document_updated', (data) => {
  io.to(`doc:${data.docId}`).emit('content_changed', {
    path: data.path,
    content: data.content,
    updatedBy: data.userId
  });
});
```

## 总结

✅ **完成**:
- 文件系统工具 → 数据库工具
- CLI 风格 → Web 风格
- 保持 SDK 接口不变
- 提供简单的使用示例
- 完整的文档说明

🎯 **核心价值**:
- Web 环境兼容
- 简洁的接口设计
- 易于扩展和集成
- 保持 SDK 核心不变

📚 **相关文档**:
- `mock-sdk/README.md` - 使用指南
- `docs/web-environment-tools.md` - Web 工具完整设计
- `examples/web-example.ts` - 代码示例
