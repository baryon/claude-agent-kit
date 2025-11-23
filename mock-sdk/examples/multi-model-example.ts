/**
 * Multi-Model Example
 *
 * Demonstrates using different LLM providers:
 * - Anthropic Claude
 * - OpenAI GPT
 * - Google Gemini
 */

import {
  MultiModelEngine,
  WEB_TOOLS,
  getMockDatabase,
  getWebToolsSystemPrompt
} from '../src/index.js';

async function runWithProvider(
  provider: 'anthropic' | 'openai' | 'gemini',
  apiKey: string
) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing with ${provider.toUpperCase()}`);
  console.log('='.repeat(80));

  // Setup database
  const db = getMockDatabase();
  await db.write(
    '/data.txt',
    'Important tasks:\n1. Review code\n2. Write tests\n3. Deploy to production',
    'text'
  );

  // Create engine for specific provider
  const engineOptions: any = {
    provider,
    maxTurns: 5,
    systemPrompt: getWebToolsSystemPrompt()
  };

  // Set appropriate API key
  switch (provider) {
    case 'anthropic':
      engineOptions.anthropicApiKey = apiKey;
      engineOptions.model = 'claude-3-7-sonnet';
      break;
    case 'openai':
      engineOptions.openaiApiKey = apiKey;
      engineOptions.model = 'gpt-4-turbo-preview';
      break;
    case 'gemini':
      engineOptions.geminiApiKey = apiKey;
      engineOptions.model = 'gemini-pro';
      break;
  }

  const engine = new MultiModelEngine(engineOptions);

  // Run task
  console.log('\n📝 Task: Read data.txt and create a checklist markdown file\n');

  try {
    for await (const msg of engine.runAgenticLoop(
      'Read data.txt and create a new file tasks.md with the content as a markdown checklist',
      WEB_TOOLS
    )) {
      switch (msg.type) {
        case 'assistant':
          console.log('🤖 Assistant:');
          for (const block of msg.content) {
            if (block.type === 'text') {
              console.log(`   ${block.text}`);
            } else if (block.type === 'tool_use') {
              console.log(`   🔧 Using tool: ${block.name}`);
              console.log(`      Input: ${JSON.stringify(block.input)}`);
            }
          }
          break;

        case 'tool_result':
          console.log(`   ✅ Tool completed`);
          break;

        case 'done':
          console.log(`\n✨ Completed in ${msg.numTurns} turns`);
          console.log(`📊 Tokens: ${msg.totalTokens?.total || 0}`);
          break;

        case 'error':
          console.error(`\n❌ Error: ${msg.error}`);
          break;
      }
    }

    // Show result
    const result = await db.read('/tasks.md');
    if (result) {
      console.log('\n📄 Created file:');
      console.log(result.content);
    }

    // Show usage
    const usage = engine.getTokenUsage();
    console.log('\n💰 Token Usage:');
    console.log(`   Input:  ${usage.input.toLocaleString()}`);
    console.log(`   Output: ${usage.output.toLocaleString()}`);
    console.log(`   Total:  ${usage.total.toLocaleString()}`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

async function main() {
  console.log('🌐 Multi-Model Agentic Engine Demo\n');

  // Detect which API keys are available
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const availableProviders = [];

  if (anthropicKey) {
    availableProviders.push('anthropic');
  }
  if (openaiKey) {
    availableProviders.push('openai');
  }
  if (geminiKey) {
    availableProviders.push('gemini');
  }

  if (availableProviders.length === 0) {
    console.error('❌ No API keys found!');
    console.error('\nPlease set at least one of the following environment variables:');
    console.error('   - ANTHROPIC_API_KEY=sk-ant-...');
    console.error('   - OPENAI_API_KEY=sk-...');
    console.error('   - GEMINI_API_KEY=...');
    process.exit(1);
  }

  console.log(`Found API keys for: ${availableProviders.join(', ')}\n`);

  // Run with each available provider
  for (const provider of availableProviders) {
    const apiKey =
      provider === 'anthropic' ? anthropicKey :
      provider === 'openai' ? openaiKey :
      geminiKey;

    await runWithProvider(provider as any, apiKey!);

    // Clear database between runs
    const db = getMockDatabase();
    await db.delete('/data.txt');
    await db.delete('/tasks.md');

    // Wait a bit between providers
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ All providers tested successfully!');
  console.log('='.repeat(80));
}

main().catch(console.error);
