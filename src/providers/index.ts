import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import type { AurixConfig } from '../agent/Config.js';
import { anthropicBaseUrl, anthropicMessagesEndpoint, openAIBaseUrl, openAIEndpoint } from '../utils/base-url.js';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  images?: string[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  usage?: { promptTokens: number; completionTokens: number };
  finishReason?: string;
  rawSnippet?: string;
}

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface Provider {
  name: string;
  chat(messages: Message[], tools?: ToolDef[]): Promise<ChatResponse>;
  streamChat?(messages: Message[], tools?: ToolDef[]): AsyncIterable<string>;
}

// ─── Image Utilities ────────────────────────────────────────────────────────

const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
};

function imageToBase64(filePath: string): { data: string; mediaType: string } | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase();
    const mediaType = IMAGE_MIME[ext];
    if (!mediaType) return null;
    const buffer = fs.readFileSync(filePath);
    if (buffer.length > 20 * 1024 * 1024) return null; // skip images > 20MB
    return { data: buffer.toString('base64'), mediaType };
  } catch {
    return null;
  }
}

// ─── OpenAI Compatible Provider ────────────────────────────────────────────

export class OpenAIProvider implements Provider {
  name = 'openai';
  private client: OpenAI;
  private model: string;
  private maxTokens: number;
  private temperature: number;
  private endpointMode: 'chat' | 'completion' | null = null;
  private baseUrl: string;
  private apiKey: string;

  constructor(config: AurixConfig) {
    this.baseUrl = openAIBaseUrl(config.baseUrl);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: this.baseUrl,
    });
    this.model = config.model;
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature ?? 0.7;
    this.apiKey = config.apiKey;
  }

  async chat(messages: Message[], tools?: ToolDef[]): Promise<ChatResponse> {
    if (this.endpointMode === 'completion') {
      return this.completionFallback(messages);
    }

    const clean = sanitizeMessages(messages);

    try {
      const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
        model: this.model,
        messages: clean.map(m => {
          if (m.role === 'tool') {
            return { role: 'tool' as const, content: m.content, tool_call_id: m.toolCallId || '' };
          }
          if (m.role === 'assistant' && m.toolCalls?.length) {
            return {
              role: 'assistant' as const,
              content: m.content || null,
              tool_calls: m.toolCalls.map(tc => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            };
          }
          if (m.images?.length) {
            const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
              { type: 'text', text: m.content },
            ];
            for (const imgPath of m.images) {
              const img = imageToBase64(imgPath);
              if (img) {
                content.push({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}` } });
              }
            }
            return { role: m.role as 'user', content };
          }
          return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
        }),
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      };

      if (tools?.length) {
        params.tools = tools;
        params.tool_choice = 'auto';
      }

      const res = await this.client.chat.completions.create(params);
      this.endpointMode = 'chat';
      return this.parseChatResponse(res);
    } catch (e: any) {
      if ((e.status === 404 || e.status === 405) && !this.endpointMode) {
        this.endpointMode = 'completion';
        return this.completionFallback(messages);
      }
      
      // If it's a 403 or API error, try to extract the real response body from 9router/OpenAI SDK
      let errorMsg = e.message || String(e);
      if (e.response && e.response.data) {
        try {
          const parsed = typeof e.response.data === 'string' ? JSON.parse(e.response.data) : e.response.data;
          errorMsg = parsed.error?.message || parsed.errorMsg || JSON.stringify(parsed);
        } catch (_) {}
      } else if (e.error?.message) {
        errorMsg = e.error.message;
      } else if (e.errorMsg) {
        errorMsg = e.errorMsg;
      }
      
      // Fallback extraction for custom OpenAI wrapper errors
      if (errorMsg.includes('errorMsg: connect proxy error')) {
        throw new Error(`9Router Error: ${errorMsg}. Please check your 9router upstream proxy settings.`);
      }
      
      throw new Error(errorMsg);
    }
  }

  private parseChatResponse(res: OpenAI.ChatCompletion): ChatResponse {
    if (!res.choices || res.choices.length === 0) {
      return { text: '', toolCalls: [], usage: undefined, finishReason: 'no_choices', rawSnippet: JSON.stringify(res).slice(0, 300) };
    }
    const choice = res.choices[0];
    const toolCalls: ToolCall[] = [];

    if (choice.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || '{}'),
        });
      }
    }

    return {
      text: choice.message?.content || '',
      toolCalls,
      usage: res.usage ? {
        promptTokens: res.usage.prompt_tokens,
        completionTokens: res.usage.completion_tokens,
      } : undefined,
      finishReason: choice.finish_reason || undefined,
      rawSnippet: (!choice.message?.content && !choice.message?.tool_calls)
        ? JSON.stringify({ finish_reason: choice.finish_reason, message: choice.message }).slice(0, 300)
        : undefined,
    };
  }

  private async completionFallback(messages: Message[]): Promise<ChatResponse> {
    const prompt = messagesToPrompt(messages);

    const url = openAIEndpoint(this.baseUrl, 'completions');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Completion endpoint failed (${res.status}): ${err}`);
    }

    const data = await res.json() as any;
    const text = data.choices?.[0]?.text || '';

    return {
      text,
      toolCalls: [],
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
      } : undefined,
    };
  }
}

// ─── Anthropic Provider ────────────────────────────────────────────────────

export class AnthropicProvider implements Provider {
  name = 'anthropic';
  private apiKey: string;
  private model: string;
  private maxTokens: number;
  private baseUrl: string;
  private endpointMode: 'anthropic' | 'openai-compat' | null = null;

  constructor(config: AurixConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.maxTokens = config.maxTokens || 4096;
    this.baseUrl = anthropicBaseUrl(config.baseUrl);
  }

  async chat(messages: Message[], tools?: ToolDef[]): Promise<ChatResponse> {
    if (this.endpointMode === 'openai-compat') {
      return this.openAICompatFallback(messages, tools);
    }

    try {
      return await this.anthropicNative(messages, tools);
    } catch (e: any) {
      if ((e.message?.includes('404') || e.message?.includes('Not Found')) && !this.endpointMode) {
        this.endpointMode = 'openai-compat';
        return this.openAICompatFallback(messages, tools);
      }
      throw e;
    }
  }

  private async anthropicNative(messages: Message[], tools?: ToolDef[]): Promise<ChatResponse> {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      stream: false,
      messages: nonSystem.map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: m.toolCallId || '',
              content: m.content,
            }],
          };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          const content: unknown[] = [];
          if (m.content) content.push({ type: 'text', text: m.content });
          for (const tc of m.toolCalls) {
            content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
          }
          return { role: 'assistant', content };
        }
        if (m.images?.length) {
          const content: unknown[] = [{ type: 'text', text: m.content }];
          for (const imgPath of m.images) {
            const img = imageToBase64(imgPath);
            if (img) {
              content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
            }
          }
          return { role: m.role, content };
        }
        return { role: m.role, content: m.content };
      }),
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }

    if (tools?.length) {
      body.tools = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    const res = await fetch(anthropicMessagesEndpoint(this.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errText}`);
    }

    let data: any;
    const rawText = await res.text();
    const trimmed = rawText.trim();
    if (trimmed.startsWith('data:') || trimmed.startsWith('event:')) {
      const lines = trimmed.split('\n');
      let textParts: string[] = [];
      let toolUses: any[] = [];
      let usage: any = null;
      let lastMessage: any = null;
      for (const line of lines) {
        const d = line.replace(/^data:\s*/, '').trim();
        if (!d || d === '[DONE]') continue;
        try {
          const evt = JSON.parse(d);
          if (evt.type === 'message_start' && evt.message) {
            lastMessage = evt.message;
            usage = evt.message.usage || null;
          }
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            textParts.push(evt.delta.text);
          }
          if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
            toolUses.push(evt.content_block);
          }
          if (evt.type === 'content_block_stop' && evt.content_block?.type === 'tool_use') {
            // already captured in content_block_start
          }
          if (evt.type === 'message_delta' && evt.usage) {
            usage = { ...usage, ...evt.usage };
          }
        } catch {}
      }
      if (lastMessage || textParts.length > 0) {
        data = {
          content: [
            ...(textParts.length > 0 ? [{ type: 'text', text: textParts.join('') }] : []),
            ...toolUses.map(t => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input || {} })),
          ],
          usage: usage || lastMessage?.usage || null,
        };
      }
      if (!data) throw new Error('Proxy returned SSE stream but no valid message data found. Try a different proxy or add stream:false to your proxy config.');
    } else {
      try {
        data = JSON.parse(trimmed);
      } catch {
        throw new Error(`Proxy returned non-JSON response: ${trimmed.slice(0, 200)}. Check your proxy URL and model ID.`);
      }
    }
    this.endpointMode = 'anthropic';

    const toolCalls: ToolCall[] = [];
    let text = '';

    for (const block of data.content || []) {
      if (block.type === 'text') text += block.text;
      if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, arguments: block.input || {} });
      }
    }

    return {
      text,
      toolCalls,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
      } : undefined,
      finishReason: data.stop_reason || undefined,
      rawSnippet: (!text && toolCalls.length === 0)
        ? JSON.stringify({ stop_reason: data.stop_reason, type: data.type, content: data.content }).slice(0, 300)
        : undefined,
    };
  }

  private async openAICompatFallback(messages: Message[], tools?: ToolDef[]): Promise<ChatResponse> {
    const client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: openAIBaseUrl(this.baseUrl),
    });

    const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: messages.map(m => {
        if (m.role === 'tool') {
          return { role: 'tool' as const, content: m.content, tool_call_id: m.toolCallId || '' };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          };
        }
        if (m.images?.length) {
          const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
            { type: 'text', text: m.content },
          ];
          for (const imgPath of m.images) {
            const img = imageToBase64(imgPath);
            if (img) {
              content.push({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}` } });
            }
          }
          return { role: m.role as 'user', content };
        }
        return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
      }),
      max_tokens: this.maxTokens,
    };

    if (tools?.length) {
      params.tools = tools;
      params.tool_choice = 'auto';
    }

    const res = await client.chat.completions.create(params);
    if (!res.choices || res.choices.length === 0) {
      return { text: '', toolCalls: [], usage: undefined, finishReason: 'no_choices', rawSnippet: JSON.stringify(res).slice(0, 300) };
    }
    const choice = res.choices[0];
    const toolCalls: ToolCall[] = [];

    if (choice.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || '{}'),
        });
      }
    }

    return {
      text: choice.message?.content || '',
      toolCalls,
      usage: res.usage ? {
        promptTokens: res.usage.prompt_tokens,
        completionTokens: res.usage.completion_tokens,
      } : undefined,
      finishReason: choice.finish_reason || undefined,
      rawSnippet: (!choice.message?.content && !choice.message?.tool_calls)
        ? JSON.stringify({ finish_reason: choice.finish_reason, message: choice.message }).slice(0, 300)
        : undefined,
    };
  }
}

// ─── Auto-Detect Provider ──────────────────────────────────────────────────

export class AutoDetectProvider implements Provider {
  name = 'custom';
  private openai: OpenAIProvider | null = null;
  private anthropic: AnthropicProvider | null = null;
  private resolved: Provider | null = null;
  private config: AurixConfig;

  constructor(config: AurixConfig) {
    this.config = config;
  }

  async chat(messages: Message[], tools?: ToolDef[]): Promise<ChatResponse> {
    if (this.resolved) {
      return this.resolved.chat(messages, tools);
    }

    const apiStyle = (this.config as any).apiStyle as string | undefined;

    if (apiStyle === 'anthropic') {
      this.resolved = new AnthropicProvider(this.config);
      return this.resolved.chat(messages, tools);
    }

    if (apiStyle === 'openai') {
      this.resolved = new OpenAIProvider(this.config);
      return this.resolved.chat(messages, tools);
    }

    try {
      this.openai = new OpenAIProvider(this.config);
      const result = await this.openai.chat(messages, tools);
      this.resolved = this.openai;
      this.name = `custom (openai-compat)`;
      return result;
    } catch {
      try {
        this.anthropic = new AnthropicProvider(this.config);
        const result = await this.anthropic.chat(messages, tools);
        this.resolved = this.anthropic;
        this.name = `custom (anthropic-compat)`;
        return result;
      } catch (e: any) {
        throw new Error(`Auto-detect failed. Set apiStyle to 'openai' or 'anthropic' explicitly. Last error: ${e.message}`);
      }
    }
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────

export function createProvider(config: AurixConfig): Provider {
  const apiStyle = (config as any).apiStyle as string | undefined;

  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'custom':
      if (apiStyle === 'anthropic') {
        return new AnthropicProvider(config);
      }
      if (apiStyle === 'openai') {
        return new OpenAIProvider(config);
      }
      return new AutoDetectProvider(config);
    default:
      return new OpenAIProvider(config);
  }
}

// ─── Message Sanitizer ────────────────────────────────────────────────────

function sanitizeMessages(messages: Message[]): Message[] {
  const validCallIds = new Set<string>();

  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      for (const tc of m.toolCalls) {
        if (tc.id) validCallIds.add(tc.id);
      }
    }
  }

  return messages.filter(m => {
    if (m.role === 'tool') {
      return m.toolCallId && validCallIds.has(m.toolCallId);
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const hasResults = m.toolCalls.some(tc =>
        messages.some(other => other.role === 'tool' && other.toolCallId === tc.id)
      );
      if (!hasResults) {
        return false;
      }
    }
    return true;
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function messagesToPrompt(messages: Message[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'system':
        parts.push(`System: ${msg.content}`);
        break;
      case 'user':
        parts.push(`User: ${msg.content}`);
        break;
      case 'assistant':
        parts.push(`Assistant: ${msg.content}`);
        break;
      case 'tool':
        parts.push(`Tool: ${msg.content}`);
        break;
    }
  }

  parts.push('Assistant:');
  return parts.join('\n\n');
}
