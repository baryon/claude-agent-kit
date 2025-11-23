/**
 * Simple Agent Example
 *
 * A minimal example showing how to use the agentic engine
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
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  // Setup database
  const db = getMockDatabase();
  await db.write(
    '/notes.txt',
    'Meeting at 2pm\nBuy groceries\nCall dentist',
    'text'
  );

  // Create engine
  const engine = new AgenticEngine({
    apiKey,
    systemPrompt: getWebToolsSystemPrompt()
  });

  // Run agent
  console.log('Agent: Starting...\n');

  for await (const message of engine.runAgenticLoop(
    'Read notes.txt and create a new file called tasks.md with the items as a checklist',
    WEB_TOOLS
  )) {
    if (message.type === 'assistant') {
      for (const block of message.content) {
        if (block.type === 'text') {
          console.log('Agent:', block.text);
        }
      }
    } else if (message.type === 'done') {
      console.log('\nCompleted in', message.numTurns, 'turns');
      console.log('Tokens:', message.totalTokens);
    }
  }

  // Show result
  const tasks = await db.read('/tasks.md');
  if (tasks) {
    console.log('\nCreated file:');
    console.log(tasks.content);
  }
}

main().catch(console.error);
