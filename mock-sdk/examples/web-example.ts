/**
 * Web Environment Example - Using Mock SDK with Database Tools
 *
 * This example shows how to use the mock SDK in a web environment
 * where filesystem tools are replaced with database-backed tools.
 */

import {
  query,
  createSdkMcpServer,
  WEB_TOOLS,
  getWebToolsSystemPrompt,
  getMockDatabase,
  type WebDocument
} from "../src/index.js";

async function main() {
  console.log("🌐 Web Environment Agent Example\n");

  // 1. Setup: Populate mock database with some documents
  const db = getMockDatabase();
  await db.write("/project/README.md", "# My Project\nThis is a test project.", "text");
  await db.write("/project/src/index.ts", "export function hello() { return 'world'; }", "code");
  await db.write("/project/src/utils.ts", "export function helper() { return 'help'; }", "code");

  console.log("📦 Created 3 sample documents in database\n");

  // 2. Create MCP server with web tools
  const webToolsServer = createSdkMcpServer({
    name: "web-tools",
    version: "1.0.0",
    tools: WEB_TOOLS
  });

  // 3. Query with web tools enabled
  console.log("💬 Starting query...\n");

  const result = query({
    prompt: "List all documents and read the README file",
    options: {
      mcpServers: {
        "web-tools": webToolsServer
      },
      // Note: In a real implementation, you would inject the web tools system prompt
      // via appendSystemPrompt option to inform Claude about the available tools
    }
  });

  // 4. Stream responses
  for await (const message of result) {
    if (message.type === "result") {
      console.log("🤖 Assistant:", message.message.content[0].text);
      console.log("\n📊 Usage:", message.usage);
    } else if (message.type === "done") {
      console.log("\n✅ Done:", message.reason);
    }
  }

  // 5. Demonstrate tool usage directly
  console.log("\n\n🔧 Direct Tool Usage Examples:\n");

  // Read a document
  console.log("1. Reading document...");
  const doc = await db.read("/project/README.md");
  if (doc) {
    console.log(`   Path: ${doc.path}`);
    console.log(`   Content: ${doc.content.substring(0, 50)}...`);
  }

  // Search documents
  console.log("\n2. Searching for 'hello'...");
  const searchResults = await db.search("hello");
  console.log(`   Found ${searchResults.length} document(s)`);
  searchResults.forEach(d => console.log(`   - ${d.path}`));

  // List all documents
  console.log("\n3. Listing all documents...");
  const allDocs = await db.list();
  console.log(`   Total: ${allDocs.length} documents`);
  allDocs.forEach(d => console.log(`   - ${d.path} (${d.type})`));

  // Show web tools system prompt
  console.log("\n\n📝 Web Tools System Prompt:\n");
  console.log(getWebToolsSystemPrompt());
}

// Run example
main().catch(console.error);
