/**
 * Multi-Model Agentic Engine
 *
 * Supports multiple LLM providers:
 * - Anthropic Claude
 * - OpenAI GPT
 * - Google Gemini
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  ToolDefinition,
  ToolHandlerContext,
  QueryMessage
} from './types.js';

// Provider types
export type ModelProvider = 'anthropic' | 'openai' | 'gemini';

export interface MultiModelEngineOptions {
  // Provider selection
  provider: ModelProvider;

  // API Keys (provide the one for your provider)
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;

  // Model name
  model?: string;

  // Common options
  maxTurns?: number;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

// Unified message format
interface UnifiedMessage {
  role: 'user' | 'assistant';
  content: string | any[];
}

// Unified tool format
interface UnifiedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Multi-Model Agentic Engine
 *
 * Abstracts different LLM providers behind a unified interface
 */
export class MultiModelEngine {
  private provider: ModelProvider;
  private model: string;
  private maxTurns: number;
  private maxTokens: number;
  private temperature: number;
  private systemPrompt?: string;

  // Provider clients
  private anthropicClient?: Anthropic;
  private openaiClient?: any;  // OpenAI type
  private geminiClient?: any;  // Gemini type

  // State
  private messages: UnifiedMessage[] = [];
  private currentTurn: number = 0;
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;
  private abortController: AbortController;

  constructor(options: MultiModelEngineOptions) {
    this.provider = options.provider;
    this.maxTurns = options.maxTurns || 10;
    this.maxTokens = options.maxTokens || 4096;
    this.temperature = options.temperature || 1.0;
    this.systemPrompt = options.systemPrompt;
    this.abortController = new AbortController();

    // Initialize provider client
    switch (options.provider) {
      case 'anthropic':
        if (!options.anthropicApiKey) {
          throw new Error('anthropicApiKey is required for Anthropic provider');
        }
        this.anthropicClient = new Anthropic({
          apiKey: options.anthropicApiKey
        });
        this.model = options.model || 'claude-3-opus-20240229';
        break;

      case 'openai':
        if (!options.openaiApiKey) {
          throw new Error('openaiApiKey is required for OpenAI provider');
        }
        // Dynamic import to avoid requiring OpenAI SDK if not used
        this.initializeOpenAI(options.openaiApiKey);
        this.model = options.model || 'gpt-4-turbo-preview';
        break;

      case 'gemini':
        if (!options.geminiApiKey) {
          throw new Error('geminiApiKey is required for Gemini provider');
        }
        this.initializeGemini(options.geminiApiKey);
        this.model = options.model || 'gemini-pro';
        break;

      default:
        throw new Error(`Unsupported provider: ${options.provider}`);
    }
  }

  /**
   * Initialize OpenAI client
   */
  private async initializeOpenAI(apiKey: string) {
    try {
      const { default: OpenAI } = await import('openai');
      this.openaiClient = new OpenAI({ apiKey });
    } catch (error) {
      throw new Error(
        'OpenAI SDK not installed. Run: npm install openai'
      );
    }
  }

  /**
   * Initialize Gemini client
   */
  private async initializeGemini(apiKey: string) {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      this.geminiClient = new GoogleGenerativeAI(apiKey);
    } catch (error) {
      throw new Error(
        'Google Generative AI SDK not installed. Run: npm install @google/generative-ai'
      );
    }
  }

  /**
   * Run agentic loop with provider abstraction
   */
  async *runAgenticLoop(
    userPrompt: string,
    tools: ToolDefinition[]
  ): AsyncGenerator<QueryMessage> {
    // Reset state
    this.messages = [];
    this.currentTurn = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;

    // Add user message
    this.messages.push({
      role: 'user',
      content: userPrompt
    });

    yield {
      type: 'user',
      content: userPrompt
    } as QueryMessage;

    // Convert tools to provider format
    const providerTools = this.convertToolsForProvider(tools);

    // Main loop
    while (this.currentTurn < this.maxTurns) {
      this.currentTurn++;

      // Call provider API based on type
      let response;
      switch (this.provider) {
        case 'anthropic':
          response = await this.callAnthropic(providerTools);
          break;
        case 'openai':
          response = await this.callOpenAI(providerTools);
          break;
        case 'gemini':
          response = await this.callGemini(providerTools);
          break;
      }

      // Add assistant message
      this.messages.push({
        role: 'assistant',
        content: response.content
      });

      yield {
        type: 'assistant',
        content: response.content
      } as QueryMessage;

      // Extract tool calls
      const toolCalls = this.extractToolCalls(response.content);

      if (toolCalls.length === 0) {
        // No tool calls, done
        break;
      }

      // Execute tools
      const toolResults = await this.executeTools(toolCalls, tools);

      // Yield results
      for (const result of toolResults) {
        yield {
          type: 'tool_result',
          tool_use_id: result.id,
          content: result.content,
          is_error: result.is_error
        } as QueryMessage;
      }

      // Add tool results to conversation
      this.messages.push({
        role: 'user',
        content: this.formatToolResults(toolResults)
      });
    }

    // Done
    yield {
      type: 'done',
      reason: this.currentTurn >= this.maxTurns ? 'max_turns' : 'completed',
      numTurns: this.currentTurn,
      totalTokens: {
        input: this.totalInputTokens,
        output: this.totalOutputTokens
      }
    } as QueryMessage;
  }

  /**
   * Call Anthropic Claude API
   */
  private async callAnthropic(tools: any) {
    if (!this.anthropicClient) {
      throw new Error('Anthropic client not initialized');
    }

    const stream = await this.anthropicClient.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: this.systemPrompt,
      messages: this.convertMessagesForAnthropic(),
      tools: tools,
      stream: true
    });

    const contentBlocks: any[] = [];
    let usage = { input_tokens: 0, output_tokens: 0 };

    for await (const event of stream) {
      if (event.type === 'message_start') {
        usage.input_tokens = event.message.usage.input_tokens;
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          if (!contentBlocks[event.index]) {
            contentBlocks[event.index] = { type: 'text', text: '' };
          }
          contentBlocks[event.index].text += event.delta.text;
        }
      } else if (event.type === 'message_delta') {
        usage.output_tokens = event.usage.output_tokens;
      }
    }

    this.totalInputTokens += usage.input_tokens;
    this.totalOutputTokens += usage.output_tokens;

    return { content: contentBlocks };
  }

  /**
   * Call OpenAI GPT API
   */
  private async callOpenAI(tools: any) {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    const response = await this.openaiClient.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages: this.convertMessagesForOpenAI(),
      tools: tools,
      tool_choice: 'auto'
    });

    const message = response.choices[0].message;
    this.totalInputTokens += response.usage.prompt_tokens;
    this.totalOutputTokens += response.usage.completion_tokens;

    return {
      content: message.tool_calls
        ? message.tool_calls.map((tc: any) => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments)
          }))
        : [{ type: 'text', text: message.content }]
    };
  }

  /**
   * Call Google Gemini API
   */
  private async callGemini(tools: any) {
    if (!this.geminiClient) {
      throw new Error('Gemini client not initialized');
    }

    const model = this.geminiClient.getGenerativeModel({
      model: this.model,
      tools: tools
    });

    const chat = model.startChat({
      history: this.convertMessagesForGemini(),
      generationConfig: {
        maxOutputTokens: this.maxTokens,
        temperature: this.temperature
      }
    });

    const lastMessage = this.messages[this.messages.length - 1];
    const result = await chat.sendMessage(
      typeof lastMessage.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage.content)
    );

    const response = result.response;
    const text = response.text();

    // Note: Gemini token counting requires additional API call
    // Simplified for now
    this.totalOutputTokens += text.length / 4; // Rough estimate

    return {
      content: [{ type: 'text', text }]
    };
  }

  /**
   * Convert tools to provider-specific format
   */
  private convertToolsForProvider(tools: ToolDefinition[]): any {
    switch (this.provider) {
      case 'anthropic':
        return tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: {
            type: 'object',
            properties: {},
            required: []
          }
        }));

      case 'openai':
        return tools.map(tool => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: {
              type: 'object',
              properties: {},
              required: []
            }
          }
        }));

      case 'gemini':
        return tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }));

      default:
        return [];
    }
  }

  /**
   * Convert messages for Anthropic format
   */
  private convertMessagesForAnthropic(): any[] {
    return this.messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string'
        ? msg.content
        : msg.content
    }));
  }

  /**
   * Convert messages for OpenAI format
   */
  private convertMessagesForOpenAI(): any[] {
    const messages: any[] = [];

    if (this.systemPrompt) {
      messages.push({
        role: 'system',
        content: this.systemPrompt
      });
    }

    messages.push(...this.messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content)
    })));

    return messages;
  }

  /**
   * Convert messages for Gemini format
   */
  private convertMessagesForGemini(): any[] {
    return this.messages.slice(0, -1).map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [
        {
          text: typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content)
        }
      ]
    }));
  }

  /**
   * Extract tool calls from response
   */
  private extractToolCalls(content: any[]): any[] {
    return content.filter(block => block.type === 'tool_use');
  }

  /**
   * Execute tools
   */
  private async executeTools(
    toolCalls: any[],
    availableTools: ToolDefinition[]
  ): Promise<Array<{ id: string; content: string; is_error: boolean }>> {
    return Promise.all(
      toolCalls.map(async (call) => {
        try {
          const tool = availableTools.find(t => t.name === call.name);

          if (!tool) {
            return {
              id: call.id,
              content: `Error: Tool '${call.name}' not found`,
              is_error: true
            };
          }

          const context: ToolHandlerContext = {
            signal: this.abortController.signal,
            toolName: call.name
          };

          const result = await tool.handler(call.input, context);
          const contentText = result.content
            .map(block => block.text)
            .join('\n');

          return {
            id: call.id,
            content: contentText,
            is_error: result.isError || false
          };
        } catch (error) {
          return {
            id: call.id,
            content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            is_error: true
          };
        }
      })
    );
  }

  /**
   * Format tool results for next turn
   */
  private formatToolResults(results: any[]): any {
    switch (this.provider) {
      case 'anthropic':
        return results.map(r => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: r.content,
          is_error: r.is_error
        }));

      case 'openai':
        return results.map(r => ({
          tool_call_id: r.id,
          role: 'tool',
          name: r.name,
          content: r.content
        }));

      case 'gemini':
        return results.map(r => r.content).join('\n\n');

      default:
        return results;
    }
  }

  /**
   * Get conversation history
   */
  getConversationHistory(): UnifiedMessage[] {
    return [...this.messages];
  }

  /**
   * Get token usage
   */
  getTokenUsage(): { input: number; output: number; total: number } {
    return {
      input: this.totalInputTokens,
      output: this.totalOutputTokens,
      total: this.totalInputTokens + this.totalOutputTokens
    };
  }

  /**
   * Abort operation
   */
  abort(): void {
    this.abortController.abort();
  }
}
