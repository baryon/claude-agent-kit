# Claude Agent SDK 实现原理

本文档从两个角度介绍 SDK 行为：

1. 原始 `sdk.mjs` 的核心模块和交互流程，路径为 `node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.1.27_zod@4.1.12/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`。
2. `mock-sdk/src/index.ts` 中的 TypeScript 模拟实现，用于本地测试或无 CLI 场景下替代真实 SDK。

## 一、`sdk.mjs` 核心结构

### 1. 常量与基础类型
- `HOOK_EVENTS` 与 `EXIT_REASONS` 在 `sdk.mjs:6331-6348` 定义，供外部注册 hook 或判断退出原因。
- `AbortError`（`sdk.mjs:6349`）继承自原生 `Error`，在流被中断、AbortController 触发或传输异常时抛出。

### 2. `ProcessTransport`（`sdk.mjs:6357-6794`）
- 负责将 SDK 选项映射为 CLI 参数：模型、system prompt、MCP 配置、工具白/黑名单、插件等都转成 `--flag value`。
- 根据 `canUseTool` 与 `permissionPromptToolName` 的组合选择 `--permission-prompt-tool` 策略，保证 CLI 能向 SDK 回传权限请求。
- `spawn` 子进程（node/bun/native binary），监听 stdout 行并解析 JSON 消息，stdin 用于写入用户消息与控制命令。
- 支持 `abortController`：一旦触发，关闭 stdin、发送 SIGTERM，再必要时 SIGKILL；stderr 根据 `DEBUG` 或 `stderr` 回调逐行输出。

### 3. `Query`（`sdk.mjs:7490-7800`）
- 将 `ProcessTransport.readMessages()` 的输出放入自实现的 `Stream`，并且实现 AsyncIterator 接口，供调用方 `for await ...`。
- `readMessages` 分类处理 CLI 信息：
  - `control_response`：匹配 `pendingControlResponses` 中的 Promise；
  - `control_request`：转交 `processControlRequest`，支持 `can_use_tool`、`hook_callback`、`mcp_message` 等子类型；
  - `control_cancel_request`：通过保存的 AbortController 取消挂起的回调；
  - `result`：在单轮对话时自动关闭 stdin。
- `streamInput` 支持外部 AsyncIterable；若存在 SDK MCP server，会在收到首条结果或超时后再关闭输入。
- `request` 将调用封装为 `control_request` 消息（含随机 `request_id`），并等待响应。

### 4. MCP Server 与工具体系（`sdk.mjs:14160-14734`）
- `McpServer` 基于 MCP SDK 注册工具、资源、Prompt，并将 Zod schema 转为 JSON Schema（通过 `zodToJsonSchema`）。
- `createSdkMcpServer` 将用户提供的工具列表注册到 MCP server，并以 `{ type: "sdk", instance }` 返回，供 `query` 接入。
- `query` 会区分 `sdk` MCP server 与远程 server：前者通过 `SdkControlServerTransport` 与 CLI 双向通信，后者直接把配置串成 `--mcp-config`。

### 5. 顶层 API（`sdk.mjs:14680-14869`）
- `tool` 简单打包工具描述。
- `query` 组装所有选项、设定默认 system prompt、检测 CLI 路径、启动 `ProcessTransport` 并构造 `Query` 实例。
- 若 `prompt` 为字符串，立刻把用户消息写入 CLI stdin；否则调用 `queryInstance.streamInput`。

## 二、`mock-sdk/src/index.ts` 模拟实现

### 1. 导出项与 Schema 适配
- 在 `mock-sdk/src/index.ts:1-118` 中复刻了 `HOOK_EVENTS`、`EXIT_REASONS`、`AbortError`，确保类型一致。
- 定义 `SchemaLike`、`validateWithSchema`，以兼容 Zod 的 `parse/safeParse/safeParseAsync` 接口，实现最基本的输入/输出校验而无需引入 `zod`。

### 2. MCP 辅助设施
- `tool` 支持两种调用方式（只有 handler 或 schema + handler），返回值与真实 SDK 一致。
- `MockMcpServer` (`mock-sdk/src/index.ts:226-316`) 存储工具列表：
  - `registerTool`/`tool` 接受模拟工具；
   - `listTools`、`sendToolListChanged` 提供工具能力；
   - `callTool` 根据 schema 校验入参与结构化结果，仿真输出校验。
- `createSdkMcpServer` 返回 `{ type: "sdk", instance }`，方便 `query` 自动识别并建立 `SdkControlServerTransport`。

### 3. 消息流与数据结构
- `AsyncMessageStream` (`mock-sdk/src/index.ts:365-438`) 模拟 SDK 内部 `Stream`：可多次 `enqueue`、在完成或失败时唤醒等待者，并提供 `[Symbol.asyncIterator]`。
- 定义 `QueryResultMessage`、`QueryDoneMessage`、`ControlRequest/Response` 等接口，与真实 SDK 的输出结构保持一致，方便替换。

### 4. Mock `Query`
- `Query` (`mock-sdk/src/index.ts:483-638`) 兼具 AsyncIterator 能力和控制方法：
  - 构造时自动处理字符串 prompt 或 AsyncIterable；
  - `wireMcpServers` 解析 `options.mcpServers`，对 SDK server 建立模拟 transport 并缓存 server 状态；
  - `processPrompt` 会触发 `SessionStart`/`UserPromptSubmit` hooks，并在 `canUseTool` 拒绝时返回一个“权限拒绝”型 `result`；
  - `pushResult` 使用 `MockConversationEngine` 生成 deterministc 回复，并附带近似 token 使用量；
  - 控制方法 (`interrupt/setModel/setMaxThinkingTokens` 等) 直接返回伪造的成功响应（包含时间戳和原始请求），满足上层逻辑；
  - `mcpServerStatus` 汇总注册的 server 类型、状态与最近的消息；`accountInfo` 返回固定配额信息。

### 5. TypeScript 配置
- `mock-sdk/tsconfig.json` 设定 `target: es2022 / module: esnext`、`declaration: true`，以 UMD/ESM 都可消费的输出为目标。
- 构建方式：`npx tsc -p mock-sdk` 可生成 `dist`，供测试或独立包发布使用。

## 三、使用场景
1. **理解真实 SDK 行为**：参考文档中的行号定位 `ProcessTransport`、`Query`、MCP 交互等关键逻辑，便于调试 CLI 调用失败、权限流程和 MCP 消息。
2. **本地/单元测试替代**：通过 `mock-sdk/src/index.ts` 的 `query`/`createSdkMcpServer`/`tool`，不再依赖真实 Claude CLI，也不会访问网络；输出 deterministic，更易 snapshot 测试。
3. **类型校验**：Mock 保留主 API 的类型签名，编译时能发现调用差异；若要生成声明文件或供其他包引用，执行一次 `npx tsc -p mock-sdk` 即可。
