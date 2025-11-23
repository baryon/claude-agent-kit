/**
 * Agentic Loop Engine - Real implementation with Anthropic API
 *
 * This module implements the complete agentic loop:
 * 1. User input → Claude API
 * 2. Claude returns tool_use blocks
 * 3. Execute tools
 * 4. Send tool_result back to Claude
 * 5. Loop until Claude returns final answer
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  ToolDefinition,
  ToolHandlerContext,
  QueryMessage,
  ToolResult
} from './types.js';

// Anthropic API types
type AnthropicMessage = Anthropic.Messages.Message;
type MessageParam = Anthropic.Messages.MessageParam;
type AnthropicContentBlock = Anthropic.Messages.ContentBlock;
type ToolUseBlock = Anthropic.Messages.ToolUseBlock;
type TextBlock = Anthropic.Messages.TextBlock;
type MessageStreamEvent = Anthropic.Messages.MessageStreamEvent;
type Tool = Anthropic.Messages.Tool;

export interface AgenticEngineOptions {
  apiKey: string;
  model?: string;
  maxTurns?: number;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface AgenticLoopResult {
  finalMessage: string;
  numTurns: number;
  totalTokens: {
    input: number;
    output: number;
  };
  conversationHistory: MessageParam[];
}

export class AgenticEngine {
  private client: Anthropic;
  private model: string;
  private maxTurns: number;
  private maxTokens: number;
  private temperature: number;
  private systemPrompt?: string;

  // Conversation state
  private messages: MessageParam[] = [];
  private currentTurn: number = 0;
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;
  private abortController: AbortController;

  constructor(options: AgenticEngineOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey
    });

    this.model = options.model || 'claude-3-opus-20240229';
    this.maxTurns = options.maxTurns || 10;
    this.maxTokens = options.maxTokens || 4096;
    this.temperature = options.temperature || 1.0;
    this.systemPrompt = options.systemPrompt;
    this.abortController = new AbortController();
  }

  /**
   * Run the complete agentic loop
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

    // Add initial user message
    this.messages.push({
      role: 'user',
      content: userPrompt
    });

    // Yield initial user message
    yield {
      type: 'user',
      content: userPrompt
    } as QueryMessage;

    // Convert tools to Anthropic format
    const anthropicTools = this.convertToolsToAnthropicFormat(tools);

    // Main agentic loop
    while (this.currentTurn < this.maxTurns) {
      this.currentTurn++;

      // Call Claude API (streaming)
      const stream = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        system: this.systemPrompt,
        messages: this.messages,
        tools: anthropicTools,
        stream: true
      });

      // Process stream
      const assistantMessage = await this.processStream(stream, tools);

      // Add assistant message to history
      this.messages.push({
        role: 'assistant',
        content: assistantMessage.content
      });

      // Yield assistant message
      yield {
        type: 'assistant',
        content: assistantMessage.content
      } as QueryMessage;

      // Check if there are tool uses
      const toolUseBlocks = assistantMessage.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) {
        // No tool uses, conversation is complete
        break;
      }

      // Execute tools
      const toolResults = await this.executeTools(toolUseBlocks, tools);

      // Yield tool results
      for (const result of toolResults) {
        yield {
          type: 'tool_result',
          tool_use_id: result.tool_use_id,
          content: result.content,
          is_error: result.is_error
        } as QueryMessage;
      }

      // Add tool results to conversation
      this.messages.push({
        role: 'user',
        content: toolResults.map(result => ({
          type: 'tool_result' as const,
          tool_use_id: result.tool_use_id,
          content: result.content,
          is_error: result.is_error
        }))
      });

      // Continue loop - Claude will process tool results
    }

    // Check if we hit max turns
    if (this.currentTurn >= this.maxTurns) {
      yield {
        type: 'error',
        error: `Reached maximum number of turns (${this.maxTurns})`
      } as QueryMessage;
    }

    // Yield final result
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
   * Process streaming response from Claude API
   */
  private async processStream(
    stream: AsyncIterable<MessageStreamEvent>,
    tools: ToolDefinition[]
  ): Promise<{ content: AnthropicContentBlock[] }> {
    const contentBlocks: AnthropicContentBlock[] = [];
    let currentBlockIndex = -1;
    let currentToolUse: Partial<ToolUseBlock> | null = null;
    let currentText = '';

    for await (const event of stream) {
      // Handle different event types
      switch (event.type) {
        case 'message_start':
          // Track token usage
          if (event.message.usage) {
            this.totalInputTokens += event.message.usage.input_tokens;
          }
          break;

        case 'content_block_start':
          currentBlockIndex = event.index;

          if (event.content_block.type === 'tool_use') {
            // Start of tool_use block
            currentToolUse = {
              type: 'tool_use',
              id: event.content_block.id,
              name: event.content_block.name,
              input: {}
            };
          } else if (event.content_block.type === 'text') {
            // Start of text block
            currentText = event.content_block.text || '';
          }
          break;

        case 'content_block_delta':
          if (event.delta.type === 'text_delta') {
            // Accumulate text
            currentText += event.delta.text;
          } else if (event.delta.type === 'input_json_delta') {
            // Accumulate tool input (partial JSON)
            if (currentToolUse) {
              const inputStr = JSON.stringify(currentToolUse.input || {});
              const partialJson = inputStr.slice(0, -1) + event.delta.partial_json + '}';
              try {
                currentToolUse.input = JSON.parse(partialJson);
              } catch {
                // Partial JSON may not be valid yet, continue accumulating
              }
            }
          }
          break;

        case 'content_block_stop':
          // Finalize current block
          if (currentToolUse && currentToolUse.type === 'tool_use') {
            contentBlocks.push(currentToolUse as ToolUseBlock);
            currentToolUse = null;
          } else if (currentText) {
            contentBlocks.push({
              type: 'text',
              text: currentText
            } as TextBlock);
            currentText = '';
          }
          break;

        case 'message_delta':
          // Track output tokens
          if (event.usage) {
            this.totalOutputTokens += event.usage.output_tokens;
          }
          break;

        case 'message_stop':
          // Stream complete
          break;
      }
    }

    return { content: contentBlocks };
  }

  /**
   * Execute tools in parallel
   */
  private async executeTools(
    toolUseBlocks: ToolUseBlock[],
    availableTools: ToolDefinition[]
  ): Promise<Array<{
    tool_use_id: string;
    content: string;
    is_error: boolean;
  }>> {
    return Promise.all(
      toolUseBlocks.map(async (toolUse) => {
        try {
          // Find the tool
          const tool = availableTools.find(t => t.name === toolUse.name);

          if (!tool) {
            return {
              tool_use_id: toolUse.id,
              content: `Error: Tool '${toolUse.name}' not found`,
              is_error: true
            };
          }

          // Execute the tool
          const context: ToolHandlerContext = {
            signal: this.abortController.signal,
            toolName: toolUse.name
          };

          const result = await tool.handler(toolUse.input, context);

          // Convert result to string
          const contentText = result.content
            .map(block => block.text)
            .join('\n');

          return {
            tool_use_id: toolUse.id,
            content: contentText,
            is_error: result.isError || false
          };
        } catch (error) {
          return {
            tool_use_id: toolUse.id,
            content: `Error executing tool: ${error instanceof Error ? error.message : String(error)}`,
            is_error: true
          };
        }
      })
    );
  }

  /**
   * Convert SDK tools to Anthropic API format
   */
  private convertToolsToAnthropicFormat(
    tools: ToolDefinition[]
  ): Tool[] {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: this.extractInputSchema(tool)
    }));
  }

  /**
   * Extract input schema from tool definition
   */
  private extractInputSchema(tool: ToolDefinition): { type: 'object'; properties?: any; required?: string[] } {
    // If tool has Zod schema, convert it
    if (tool.inputSchema && 'shape' in tool.inputSchema) {
      // Simplified Zod to JSON Schema conversion
      // In production, use a proper converter like zod-to-json-schema
      return {
        type: 'object',
        properties: this.zodToJsonSchema(tool.inputSchema),
        required: Object.keys((tool.inputSchema as any).shape || {})
      };
    }

    // Default schema
    return {
      type: 'object',
      properties: {}
    };
  }

  /**
   * Simple Zod to JSON Schema converter
   * In production, use a library like zod-to-json-schema
   */
  private zodToJsonSchema(schema: any): Record<string, unknown> {
    if (!schema || !schema.shape) {
      return {};
    }

    const properties: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(schema.shape)) {
      const zodType = (value as any)._def?.typeName;

      switch (zodType) {
        case 'ZodString':
          properties[key] = { type: 'string' };
          break;
        case 'ZodNumber':
          properties[key] = { type: 'number' };
          break;
        case 'ZodBoolean':
          properties[key] = { type: 'boolean' };
          break;
        case 'ZodArray':
          properties[key] = { type: 'array' };
          break;
        case 'ZodObject':
          properties[key] = { type: 'object' };
          break;
        default:
          properties[key] = { type: 'string' };
      }
    }

    return properties;
  }

  /**
   * Abort the current operation
   */
  abort(): void {
    this.abortController.abort();
  }

  /**
   * Get conversation history
   */
  getConversationHistory(): MessageParam[] {
    return [...this.messages];
  }

  /**
   * Get current turn number
   */
  getCurrentTurn(): number {
    return this.currentTurn;
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
}
