/**
 * Complete Agentic Loop Example
 *
 * This example demonstrates the full agentic loop with real Anthropic API calls,
 * tool execution, and multi-turn conversations.
 */

import {
  AgenticEngine,
  WEB_TOOLS,
  getMockDatabase,
  getWebToolsSystemPrompt
} from '../src/index.js';

async function main() {
  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY environment variable is required');
    console.error('   Set it with: export ANTHROPIC_API_KEY=sk-ant-...');
    process.exit(1);
  }

  console.log('🤖 Agentic Loop Example - Full Implementation\n');

  // 1. Setup: Prepare mock database with documents
  const db = getMockDatabase();

  console.log('📦 Setting up mock database...');
  await db.write(
    '/project/README.md',
    `# My Awesome Project

This is a test project that demonstrates the agentic loop.

## Features
- Real Anthropic API integration
- Tool calling with document_read, document_write, document_search
- Multi-turn conversations
- Streaming responses

## Installation
\`\`\`bash
npm install
npm run build
\`\`\`
`,
    'markdown'
  );

  await db.write(
    '/project/src/index.ts',
    `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export function add(a: number, b: number): number {
  return a + b;
}
`,
    'code'
  );

  await db.write(
    '/project/src/utils.ts',
    `export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
`,
    'code'
  );

  console.log('✅ Created 3 documents in database\n');

  // 2. Create agentic engine
  console.log('🔧 Initializing Agentic Engine...');
  const engine = new AgenticEngine({
    apiKey,
    model: 'claude-3-7-sonnet',
    maxTurns: 10,
    maxTokens: 4096,
    systemPrompt: getWebToolsSystemPrompt()
  });

  console.log('✅ Engine initialized\n');

  // 3. Run agentic loop with a complex task
  const userPrompt = `Please help me with the following tasks:
1. Read the README.md file and tell me what this project is about
2. Search for functions that contain "string" in their signature
3. Create a new file called SUMMARY.md that summarizes what you found`;

  console.log('💬 User Prompt:');
  console.log(`   ${userPrompt.split('\n').join('\n   ')}\n`);
  console.log('─'.repeat(80));
  console.log('🔄 Starting Agentic Loop...\n');

  try {
    let turnNumber = 0;

    for await (const message of engine.runAgenticLoop(userPrompt, WEB_TOOLS)) {
      switch (message.type) {
        case 'user':
          console.log(`\n👤 User (Turn ${++turnNumber}):`);
          console.log(`   ${message.content}\n`);
          break;

        case 'assistant':
          console.log(`\n🤖 Assistant (Turn ${turnNumber}):`);

          // Display assistant's message
          for (const block of message.content) {
            if (block.type === 'text') {
              console.log(`   ${block.text}\n`);
            } else if (block.type === 'tool_use') {
              console.log(`   🔧 Tool Use: ${block.name}`);
              console.log(`      ID: ${block.id}`);
              console.log(`      Input: ${JSON.stringify(block.input, null, 2).split('\n').join('\n      ')}`);
            }
          }
          break;

        case 'tool_result':
          console.log(`\n   ✅ Tool Result (ID: ${message.tool_use_id}):`);
          const preview = message.content.substring(0, 200);
          const suffix = message.content.length > 200 ? '...' : '';
          console.log(`      ${preview}${suffix}\n`);
          if (message.is_error) {
            console.log(`      ⚠️  Error: ${message.content}\n`);
          }
          break;

        case 'error':
          console.error(`\n❌ Error: ${message.error}\n`);
          break;

        case 'done':
          console.log('\n' + '─'.repeat(80));
          console.log('\n✅ Agentic Loop Completed!\n');
          console.log('📊 Statistics:');
          console.log(`   Turns: ${message.numTurns}`);
          console.log(`   Reason: ${message.reason}`);
          if (message.totalTokens) {
            console.log(`   Input Tokens: ${message.totalTokens.input}`);
            console.log(`   Output Tokens: ${message.totalTokens.output}`);
            console.log(`   Total Tokens: ${message.totalTokens.input + message.totalTokens.output}`);
          }
          break;
      }
    }

    // 4. Display final database state
    console.log('\n' + '─'.repeat(80));
    console.log('\n📁 Final Database State:\n');

    const allDocs = await db.list();
    for (const doc of allDocs) {
      console.log(`   📄 ${doc.path} (${doc.type})`);
      if (doc.path === '/project/SUMMARY.md') {
        console.log(`\n   Content Preview:\n   ${doc.content.split('\n').join('\n   ')}\n`);
      }
    }

    // 5. Display conversation history
    console.log('\n' + '─'.repeat(80));
    console.log('\n💬 Conversation History:\n');

    const history = engine.getConversationHistory();
    console.log(`   Total messages: ${history.length}`);

    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      console.log(`\n   Message ${i + 1} (${msg.role}):`);

      if (typeof msg.content === 'string') {
        console.log(`      ${msg.content.substring(0, 100)}...`);
      } else if (Array.isArray(msg.content)) {
        console.log(`      ${msg.content.length} content block(s)`);
        for (const block of msg.content) {
          if (block.type === 'text') {
            console.log(`      - Text: ${block.text?.substring(0, 50)}...`);
          } else if (block.type === 'tool_use') {
            console.log(`      - Tool: ${block.name}`);
          } else if (block.type === 'tool_result') {
            console.log(`      - Tool Result (${block.is_error ? 'error' : 'success'})`);
          }
        }
      }
    }

    // 6. Display token usage
    console.log('\n' + '─'.repeat(80));
    console.log('\n💰 Token Usage:\n');

    const usage = engine.getTokenUsage();
    console.log(`   Input Tokens:  ${usage.input.toLocaleString()}`);
    console.log(`   Output Tokens: ${usage.output.toLocaleString()}`);
    console.log(`   Total Tokens:  ${usage.total.toLocaleString()}`);

    // Rough cost estimation (Claude 3.5 Sonnet pricing)
    const inputCost = (usage.input / 1_000_000) * 3.0;  // $3 per 1M input tokens
    const outputCost = (usage.output / 1_000_000) * 15.0;  // $15 per 1M output tokens
    const totalCost = inputCost + outputCost;

    console.log(`\n   Estimated Cost: $${totalCost.toFixed(6)}`);

  } catch (error) {
    console.error('\n❌ Error during agentic loop:');
    console.error(error);
    process.exit(1);
  }
}

// Run the example
main().catch(console.error);
