# 数据库存储 Skills 的多用户架构

## 问题分析

### 当前架构的限制

**单用户文件系统方式**:
```
~/.claude/skills/
├─ algorithmic-art/
├─ canvas-design/
└─ xlsx/
```

- ❌ Skills 存储在用户本地文件系统
- ❌ 每个用户只能访问自己的 skills
- ❌ 无法实现多用户共享
- ❌ 无法实现权限管理
- ❌ 无法实时更新 skills

### 多用户 SaaS 需求

**数据库存储方式**:
```
Database:
├─ users 表
├─ skills 表 (skill_id, user_id, name, content, ...)
├─ shared_skills 表 (skill_id, org_id, visibility, ...)
└─ skill_permissions 表
```

- ✅ 多用户隔离
- ✅ 共享 skills (组织级、公开级)
- ✅ 权限管理
- ✅ 实时更新
- ✅ 版本控制

---

## 解决方案

### 方案对比

| 方案 | 是否需要修改 CLI | 复杂度 | 推荐程度 |
|------|----------------|--------|---------|
| **方案 1: 不用 CLI,完全自定义** | ❌ 不用 CLI | 🔴 高 | ⭐⭐ |
| **方案 2: MCP Plugin (推荐)** | ❌ 不修改 CLI | 🟡 中 | ⭐⭐⭐⭐⭐ |
| **方案 3: systemPrompt 注入** | ❌ 不用 CLI | 🟢 低 | ⭐⭐⭐ |
| **方案 4: 修改 CLI** | ✅ 修改 CLI | 🔴 高 | ⭐ |

---

## 方案 1: 不用 CLI,完全自定义 (不推荐)

### 架构

```
Web App
   ↓
直接调用 Anthropic API (不用 SDK)
   ↓
自己实现所有工具
   ↓
从数据库加载 skills
```

### 优点
- ✅ 完全控制
- ✅ 无需依赖 CLI

### 缺点
- ❌ 失去所有 CLI 提供的工具 (Read, Write, Bash, etc.)
- ❌ 需要自己实现权限系统
- ❌ 需要自己实现 MCP 集成
- ❌ 大量重复造轮子

### 结论
**不推荐**: 失去太多 CLI 提供的功能

---

## 方案 2: MCP Plugin 方式 (强烈推荐) ⭐⭐⭐⭐⭐

### 核心思路

**通过 MCP Plugin 将数据库 skills 注入到 CLI 的 skill 系统**

```
Web App
   ↓
SDK (启动 CLI)
   ↓
CLI 启动时加载:
├─ 默认 skills (~/.claude/skills/)
└─ MCP Plugin 提供的 skills (从数据库读取)
```

### 架构设计

```
┌─────────────────────────────────────────────────┐
│              Web Application                    │
│                                                 │
│  ┌──────────────┐      ┌──────────────────┐   │
│  │   User 1     │      │     User 2       │   │
│  │  Session     │      │    Session       │   │
│  └──────┬───────┘      └────────┬─────────┘   │
│         │                       │             │
│         └───────────┬───────────┘             │
│                     ↓                          │
│         ┌──────────────────────┐              │
│         │   SDK Instance       │              │
│         │  (per user session)  │              │
│         └──────────┬───────────┘              │
└────────────────────┼──────────────────────────┘
                     ↓
         ┌──────────────────────┐
         │   CLI Process        │
         │  (per user session)  │
         │                      │
         │  Loads:              │
         │  ├─ Built-in tools   │
         │  ├─ MCP Plugin       │
         │  └─ Skills from DB   │
         └──────────┬───────────┘
                     ↓
         ┌──────────────────────┐
         │  MCP Plugin          │
         │  "database-skills"   │
         │                      │
         │  ┌────────────────┐ │
         │  │ loadSkills()   │ │
         │  │   ↓            │ │
         │  │ Database       │ │
         │  │ SELECT *       │ │
         │  │ FROM skills    │ │
         │  │ WHERE user_id  │ │
         │  │   = ?          │ │
         │  └────────────────┘ │
         └──────────────────────┘
```

### 实现步骤

#### 步骤 1: 创建数据库 Schema

```sql
-- skills 表
CREATE TABLE skills (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  org_id UUID,  -- 组织 ID (用于共享)
  name VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,  -- SKILL.md 的内容
  visibility ENUM('private', 'org', 'public') DEFAULT 'private',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(user_id, name),
  INDEX(user_id),
  INDEX(org_id)
);

-- 共享 skills
CREATE TABLE skill_shares (
  id UUID PRIMARY KEY,
  skill_id UUID REFERENCES skills(id),
  shared_with_user_id UUID,
  permission ENUM('read', 'write') DEFAULT 'read',
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(skill_id, shared_with_user_id)
);
```

#### 步骤 2: 创建 MCP Plugin

创建 `database-skills-plugin/`:

```
database-skills-plugin/
├── package.json
├── src/
│   └── index.ts
└── skills/  (空目录,动态填充)
```

**package.json**:
```json
{
  "name": "database-skills-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "mcpServer": {
    "command": "node",
    "args": ["dist/index.js"]
  }
}
```

**src/index.ts**:
```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pg from "pg";

const { Pool } = pg;

// 数据库连接
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// 从环境变量获取当前用户 ID (SDK 传递)
const currentUserId = process.env.CURRENT_USER_ID;

interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
}

// 加载用户的 skills (包括共享的)
async function loadUserSkills(userId: string): Promise<Skill[]> {
  const result = await pool.query(`
    SELECT DISTINCT s.id, s.name, s.description, s.content
    FROM skills s
    LEFT JOIN skill_shares ss ON s.id = ss.skill_id
    WHERE
      s.user_id = $1  -- 用户自己的
      OR s.visibility = 'public'  -- 公开的
      OR (s.org_id IN (
        SELECT org_id FROM users WHERE id = $1
      ) AND s.visibility = 'org')  -- 组织共享的
      OR ss.shared_with_user_id = $1  -- 明确共享给用户的
    ORDER BY s.name
  `, [userId]);

  return result.rows;
}

// MCP Server
const server = new Server(
  {
    name: "database-skills",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 提供 "load_user_skills" 工具
server.setRequestHandler("tools/list", async () => {
  return {
    tools: [
      {
        name: "load_user_skills",
        description: "Load skills from database for current user",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

server.setRequestHandler("tools/call", async (request) => {
  if (request.params.name === "load_user_skills") {
    const skills = await loadUserSkills(currentUserId!);

    // 将 skills 格式化为 CLI 期望的格式
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(skills, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Database Skills MCP server running on stdio");
}

main().catch(console.error);
```

#### 步骤 3: SDK 集成

在你的 Web App 中:

```typescript
import { SimpleClaudeAgentSDKClient } from "@claude-agent-kit/server";
import type { SessionSDKOptions } from "@claude-agent-kit/server";
import { Pool } from "pg";

// 数据库连接
const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// 为每个用户创建 session
async function createUserSession(userId: string) {
  const sdkClient = new SimpleClaudeAgentSDKClient();

  // 从数据库加载用户的 skills
  const skills = await loadUserSkillsFromDB(userId);

  // 创建临时的 skills 目录 (每个用户一个)
  const userSkillsDir = `/tmp/skills/${userId}`;
  await fs.mkdir(userSkillsDir, { recursive: true });

  // 将 skills 写入临时目录
  for (const skill of skills) {
    const skillDir = path.join(userSkillsDir, skill.name);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      skill.content
    );
  }

  const options: SessionSDKOptions = {
    cwd: userSkillsDir,

    // 方式 1: 使用环境变量传递用户信息给 MCP plugin
    env: {
      CURRENT_USER_ID: userId,
      DB_HOST: process.env.DB_HOST,
      DB_NAME: process.env.DB_NAME,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
    },

    // 方式 2: 或者使用 systemPrompt 直接注入 skills
    appendSystemPrompt: generateSkillsPrompt(skills),
  };

  return { sdkClient, options };
}

// 从数据库加载用户的 skills
async function loadUserSkillsFromDB(userId: string) {
  const result = await pool.query(`
    SELECT DISTINCT s.id, s.name, s.description, s.content
    FROM skills s
    LEFT JOIN skill_shares ss ON s.id = ss.skill_id
    WHERE
      s.user_id = $1
      OR s.visibility = 'public'
      OR (s.org_id IN (
        SELECT org_id FROM users WHERE id = $1
      ) AND s.visibility = 'org')
      OR ss.shared_with_user_id = $1
    ORDER BY s.name
  `, [userId]);

  return result.rows;
}

// WebSocket 处理
wsHandler.onMessage(async (ws, message) => {
  const { userId } = ws.data; // 从 WebSocket 数据中获取用户 ID

  // 为该用户创建 session
  const { sdkClient, options } = await createUserSession(userId);

  // 发送消息
  await sdkClient.queryStream(message.prompt, options);
});
```

### 方案 2 的优点

- ✅ **保留所有 CLI 功能** (Read, Write, Bash, 所有工具)
- ✅ **多用户隔离**: 每个用户有独立的 skills
- ✅ **共享机制**: 支持公开、组织、私有 skills
- ✅ **实时更新**: 修改数据库后立即生效
- ✅ **权限管理**: 数据库级别的权限控制
- ✅ **无需修改 CLI**: 使用标准的 SDK API

### 方案 2 的缺点

- ⚠️ 需要为每个用户创建临时 skills 目录
- ⚠️ 需要管理临时文件的清理

---

## 方案 3: systemPrompt 直接注入 (简单推荐) ⭐⭐⭐

### 核心思路

**不使用 CLI 的 Skill 工具,直接通过 systemPrompt 注入 skill 内容**

```
Web App
   ↓
从数据库加载 skills
   ↓
生成 systemPrompt (包含所有 skills)
   ↓
SDK (传递给 CLI)
   ↓
Claude 看到 skills (作为系统提示的一部分)
```

### 实现

```typescript
import { SimpleClaudeAgentSDKClient } from "@claude-agent-kit/server";
import type { SessionSDKOptions } from "@claude-agent-kit/server";

// 从数据库加载用户的 skills
async function loadUserSkills(userId: string) {
  const result = await db.query(`
    SELECT name, description, content
    FROM skills
    WHERE user_id = $1 OR visibility = 'public'
    ORDER BY name
  `, [userId]);

  return result.rows;
}

// 生成 skills 系统提示
function generateSkillsPrompt(skills: Skill[]): string {
  const skillsList = skills.map(skill => {
    return `<skill name="${skill.name}">
<description>${skill.description}</description>

${skill.content}
</skill>`;
  }).join('\n\n');

  return `
# Available Skills

You have access to the following specialized skills. Use them when appropriate:

${skillsList}

When a task matches a skill's domain, apply the skill's instructions.
`;
}

// 创建 session
async function createUserSession(userId: string) {
  const sdkClient = new SimpleClaudeAgentSDKClient();

  // 从数据库加载用户的 skills
  const skills = await loadUserSkills(userId);

  const options: SessionSDKOptions = {
    cwd: path.join(process.cwd(), "workspace"),

    // 直接注入 skills 到系统提示
    appendSystemPrompt: generateSkillsPrompt(skills),
  };

  return { sdkClient, options };
}

// 使用
const { sdkClient, options } = await createUserSession("user-123");
const result = sdkClient.queryStream("Create a budget spreadsheet", options);
```

### 方案 3 的优点

- ✅ **最简单**: 只需修改 systemPrompt
- ✅ **保留所有 CLI 工具**: Read, Write, Bash 等
- ✅ **多用户隔离**: 每个用户有不同的 systemPrompt
- ✅ **无需临时文件**: 直接注入内容
- ✅ **实时更新**: 修改数据库后立即生效

### 方案 3 的缺点

- ⚠️ **Token 消耗**: Skills 占用系统提示的 token
- ⚠️ **失去 Skill 工具**: Claude 不能显式调用 "Skill" 工具
- ⚠️ **只能自动匹配**: 无法让 Claude 主动选择 skill

### 方案 3 的优化

如果 skills 太多导致 token 消耗大:

```typescript
// 智能选择相关的 skills
async function selectRelevantSkills(
  userId: string,
  userPrompt: string
): Promise<Skill[]> {
  // 方法 1: 基于关键词匹配
  const keywords = extractKeywords(userPrompt);

  const result = await db.query(`
    SELECT name, description, content
    FROM skills
    WHERE user_id = $1
      AND (
        name ILIKE ANY($2)
        OR description ILIKE ANY($2)
      )
    LIMIT 5
  `, [userId, keywords.map(k => `%${k}%`)]);

  // 方法 2: 使用向量搜索 (如果有 embedding)
  // const skillEmbedding = await getEmbedding(userPrompt);
  // const result = await db.query(`
  //   SELECT name, description, content
  //   FROM skills
  //   WHERE user_id = $1
  //   ORDER BY embedding <-> $2
  //   LIMIT 5
  // `, [userId, skillEmbedding]);

  return result.rows;
}

// 使用
const relevantSkills = await selectRelevantSkills(userId, userPrompt);
const skillsPrompt = generateSkillsPrompt(relevantSkills);
```

---

## 方案 4: 修改 CLI (不推荐)

### 需要做的修改

修改 CLI 的 skill 加载逻辑,从数据库而不是文件系统加载:

```javascript
// cli.js 中修改 loadSkills 函数

// 原来的实现
async function loadSkills() {
  const skillsDir = path.join(homedir(), '.claude/skills');
  const skills = [];

  for (const dir of fs.readdirSync(skillsDir)) {
    const skillFile = path.join(skillsDir, dir, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      const content = fs.readFileSync(skillFile, 'utf-8');
      skills.push(parseSkill(content));
    }
  }

  return skills;
}

// 修改后的实现
async function loadSkills() {
  // 从环境变量获取用户 ID
  const userId = process.env.CURRENT_USER_ID;

  if (!userId) {
    // 回退到文件系统
    return loadSkillsFromFilesystem();
  }

  // 从数据库加载
  const pool = new Pool({...});
  const result = await pool.query(`
    SELECT name, description, content
    FROM skills
    WHERE user_id = $1
  `, [userId]);

  return result.rows.map(row => parseSkill(row.content));
}
```

### 方案 4 的缺点

- ❌ **需要修改 CLI 源码**: 维护成本高
- ❌ **破坏官方更新**: 无法轻松升级到新版本
- ❌ **需要 fork 项目**: 增加维护负担

---

## 推荐方案总结

### 最佳选择: 方案 3 (systemPrompt 注入) + 方案 2 (MCP Plugin)

**短期快速实现**: 使用方案 3
```typescript
const skills = await loadUserSkills(userId);
const options = {
  appendSystemPrompt: generateSkillsPrompt(skills)
};
```

**长期扩展**: 迁移到方案 2
- 保留 Skill 工具功能
- 更好的 skills 管理
- 支持动态加载

---

## 完整示例代码

### 数据库 Schema

```sql
-- skills 表
CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  org_id UUID,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  visibility VARCHAR(20) DEFAULT 'private',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT skills_user_name_unique UNIQUE(user_id, name)
);

CREATE INDEX idx_skills_user_id ON skills(user_id);
CREATE INDEX idx_skills_org_id ON skills(org_id);
CREATE INDEX idx_skills_visibility ON skills(visibility);

-- 示例数据
INSERT INTO skills (user_id, name, description, content, visibility) VALUES
('user-123', 'xlsx', 'Spreadsheet operations', '# XLSX Skill\n\n...', 'private'),
('user-123', 'pdf', 'PDF manipulation', '# PDF Skill\n\n...', 'private'),
('org-456', 'company-style', 'Company branding', '# Style Guide\n\n...', 'org');
```

### Web App 实现

```typescript
// server/skills-service.ts
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
}

export async function loadUserSkills(userId: string): Promise<Skill[]> {
  const result = await pool.query(`
    SELECT DISTINCT s.id, s.name, s.description, s.content
    FROM skills s
    LEFT JOIN skill_shares ss ON s.id = ss.skill_id
    WHERE
      s.user_id = $1
      OR s.visibility = 'public'
      OR (s.org_id IN (
        SELECT org_id FROM users WHERE id = $1
      ) AND s.visibility = 'org')
      OR ss.shared_with_user_id = $1
    ORDER BY s.name
  `, [userId]);

  return result.rows;
}

export function generateSkillsPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return "";
  }

  const skillsList = skills.map(skill => `
<skill name="${skill.name}">
<description>${skill.description}</description>

${skill.content}
</skill>
  `).join('\n');

  return `
# Available Skills

You have access to the following specialized skills:

${skillsList}

When a user's request matches a skill's domain, automatically apply that skill's instructions.
`;
}

// server/session-manager.ts
import { SimpleClaudeAgentSDKClient } from "@claude-agent-kit/server";
import { loadUserSkills, generateSkillsPrompt } from "./skills-service";

export async function createUserSession(userId: string) {
  const sdkClient = new SimpleClaudeAgentSDKClient();

  // 从数据库加载该用户的 skills
  const skills = await loadUserSkills(userId);

  const options = {
    cwd: path.join(process.cwd(), "workspace", userId),

    // 注入 skills 到系统提示
    appendSystemPrompt: generateSkillsPrompt(skills),
  };

  return { sdkClient, options };
}

// server/websocket-handler.ts
import { BunWebSocketHandler } from "@claude-agent-kit/bun-websocket";
import { createUserSession } from "./session-manager";

const sessions = new Map();

export async function handleWebSocket(ws, message) {
  const { userId } = ws.data;

  // 为该用户创建或获取 session
  if (!sessions.has(userId)) {
    const session = await createUserSession(userId);
    sessions.set(userId, session);
  }

  const { sdkClient, options } = sessions.get(userId);

  // 处理消息
  for await (const result of sdkClient.queryStream(message.prompt, options)) {
    ws.send(JSON.stringify(result));
  }
}
```

### API 端点

```typescript
// server/api/skills.ts

// 获取用户的 skills
app.get("/api/skills", async (req, res) => {
  const userId = req.user.id;
  const skills = await loadUserSkills(userId);
  res.json(skills);
});

// 创建新 skill
app.post("/api/skills", async (req, res) => {
  const userId = req.user.id;
  const { name, description, content, visibility } = req.body;

  const result = await pool.query(`
    INSERT INTO skills (user_id, name, description, content, visibility)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [userId, name, description, content, visibility]);

  res.json(result.rows[0]);
});

// 更新 skill
app.put("/api/skills/:id", async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { description, content } = req.body;

  const result = await pool.query(`
    UPDATE skills
    SET description = $1, content = $2, updated_at = NOW()
    WHERE id = $3 AND user_id = $4
    RETURNING *
  `, [description, content, id, userId]);

  res.json(result.rows[0]);
});

// 删除 skill
app.delete("/api/skills/:id", async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  await pool.query(`
    DELETE FROM skills
    WHERE id = $1 AND user_id = $2
  `, [id, userId]);

  res.json({ success: true });
});
```

---

## 总结

### 推荐实现路径

1. **Phase 1 (快速启动)**: 使用方案 3 (systemPrompt 注入)
   - 最简单
   - 立即可用
   - 满足基本需求

2. **Phase 2 (功能完善)**: 优化为方案 2 (MCP Plugin)
   - 保留 Skill 工具
   - 更好的用户体验
   - 支持更复杂的 skills 管理

3. **不要选择方案 4**: 修改 CLI 维护成本太高

### 关键点

- ✅ **可以用 CLI**: 不需要放弃 CLI
- ✅ **保留所有工具**: Read, Write, Bash 等都可用
- ✅ **多用户支持**: 每个用户独立的 skills
- ✅ **实时更新**: 修改数据库立即生效
- ✅ **无需修改 SDK/CLI**: 使用标准 API

你的多用户 SaaS 应用完全可以使用 SDK + CLI,只需要从数据库动态加载 skills 并注入到系统提示中即可！
