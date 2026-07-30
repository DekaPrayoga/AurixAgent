import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { AurixConfig } from '../agent/Config.js';
import {
  anthropicBaseUrl,
  anthropicMessagesEndpoint,
  openAIBaseUrl,
  openAIEndpoint,
} from '../utils/base-url.js';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  images?: string[];
  dbId?: number;
  stableId?: string;
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
  chat(messages: Message[], tools?: ToolDef[], signal?: AbortSignal): Promise<ChatResponse>;
  streamChat?(messages: Message[], tools?: ToolDef[]): AsyncIterable<string>;
}

// ─── Image Utilities ────────────────────────────────────────────────────────

const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

// Modifies the global NO_PROXY environment variables to bypass global proxy
// settings for local endpoints. This is required because Bun's native fetch
// reads NO_PROXY at the time of the request and ignores fetchOpts.dispatcher.
function bypassProxyIfLocal(url: string) {
  if (url.includes('localhost') || url.includes('127.0.0.1')) {
    const currentNoProxy = process.env.NO_PROXY || process.env.no_proxy || '';
    const locals = ['127.0.0.1', 'localhost'];
    const parts = currentNoProxy
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    let updated = false;
    for (const local of locals) {
      if (!parts.includes(local)) {
        parts.push(local);
        updated = true;
      }
    }
    if (updated) {
      process.env.NO_PROXY = parts.join(',');
      process.env.no_proxy = process.env.NO_PROXY;
    }
  }
}

export function imageToBase64(filePath: string): { data: string; mediaType: string } | null {
  try {
    const dataUrl = filePath.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (dataUrl) {
      const data = dataUrl[2];
      if (Buffer.byteLength(data, 'base64') > 20 * 1024 * 1024) return null;
      return { data, mediaType: dataUrl[1] };
    }

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

function messagesHaveImages(messages: Message[]): boolean {
  return messages.some((m) => m.images?.length);
}

function parseToolArguments(
  raw: string | null | undefined,
  toolName: string
): Record<string, unknown> | null {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
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

  async chat(messages: Message[], tools?: ToolDef[], signal?: AbortSignal): Promise<ChatResponse> {
    if (this.endpointMode === 'completion') {
      return this.completionFallback(messages, signal);
    }

    const clean = sanitizeMessages(messages);

    try {
      const params: any = {
        model: this.model,
        messages: clean.map((m) => {
          if (m.role === 'tool') {
            return { role: 'tool' as const, content: m.content, tool_call_id: m.toolCallId || '' };
          }
          if (m.role === 'assistant' && m.toolCalls?.length) {
            return {
              role: 'assistant' as const,
              content: m.content || null,
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            };
          }
          if (m.images?.length) {
            const content: Array<
              { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
            > = [{ type: 'text', text: m.content }];
            for (const imgPath of m.images) {
              const img = imageToBase64(imgPath);
              if (img) {
                content.push({
                  type: 'image_url',
                  image_url: { url: `data:${img.mediaType};base64,${img.data}` },
                });
              }
            }
            return { role: m.role as 'user', content };
          }
          return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
        }),
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        stream: true, // Force stream to play nice with 9Router
      };

      if (tools?.length) {
        params.tools = tools;
        params.tool_choice = 'auto';
      }

      // Bypass OpenAI SDK completely to avoid proxy-connection issues with local routers
      const url = this.baseUrl.endsWith('/chat/completions')
        ? this.baseUrl
        : `${this.baseUrl}/chat/completions`;

      let fetchOpts: any = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(params),
      };

      // Force direct connection (bypass global/system proxies)
      // This is crucial for local endpoints like 127.0.0.1 which get banned by external residential proxies.
      bypassProxyIfLocal(url);
      if (url.includes('localhost') || url.includes('127.0.0.1')) {
        try {
          const { Agent } = await import('undici');
          fetchOpts.dispatcher = new Agent({ connect: { rejectUnauthorized: false } }); // Raw socket agent, no proxy
        } catch (e) {}
      }

      if (signal) fetchOpts.signal = signal;
      const fetchRes = await fetch(url, fetchOpts);

      if (!fetchRes.ok) {
        const errorText = await fetchRes.text();
        let parsedErr;
        try {
          parsedErr = JSON.parse(errorText);
        } catch {}
        const errorMsg =
          parsedErr?.error?.message || parsedErr?.errorMsg || errorText || fetchRes.statusText;

        if (fetchRes.status === 404 || fetchRes.status === 405) {
          if (!this.endpointMode) {
            this.endpointMode = 'completion';
            return this.completionFallback(messages, signal);
          }
        }

        if (errorMsg.includes('connect proxy error') || errorMsg.includes('9router')) {
          throw new Error(`9Router Proxy Error: ${errorMsg}\n\nRaw Response:\n${errorText}`);
        }

        throw new Error(`HTTP ${fetchRes.status}: ${errorMsg}\n\nRaw Response:\n${errorText}`);
      }

      const isStream = fetchRes.headers.get('content-type')?.includes('text/event-stream');
      let res;

      if (!isStream) {
        let text = await fetchRes.text();
        try {
          res = JSON.parse(text);
        } catch {
          throw new Error('Invalid JSON response: ' + text.slice(0, 100));
        }
      } else {
        // Handle Stream manually! We collect chunks and simulate a full JSON response.
        const reader = fetchRes.body?.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let lastChunk = null;
        let usage = null;
        let toolCallsMap: Record<number, any> = {};
        let legacyFunctionCall: { name: string; arguments: string } | null = null;
        let streamBuffer = '';

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            streamBuffer += decoder.decode(value, { stream: true });
            const lines = streamBuffer.split(/\r?\n/);
            streamBuffer = lines.pop() || '';

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine.startsWith('data: ') || trimmedLine.includes('[DONE]')) continue;
              const payload = trimmedLine.replace(/^data:\s*/, '').trim();
              if (!payload) continue;

              let chunk: any;
              try {
                chunk = JSON.parse(payload);
              } catch {
                continue;
              }

              lastChunk = chunk;
              if (chunk.choices?.[0]?.delta?.content) {
                fullContent += chunk.choices[0].delta.content;
              }
              const legacy = chunk.choices?.[0]?.delta?.function_call;
              if (legacy) {
                if (!legacyFunctionCall) legacyFunctionCall = { name: '', arguments: '' };
                if (legacy.name) legacyFunctionCall.name += legacy.name;
                if (legacy.arguments) legacyFunctionCall.arguments += legacy.arguments;
              }
              const tcs = chunk.choices?.[0]?.delta?.tool_calls;
              if (tcs && Array.isArray(tcs)) {
                for (const tc of tcs) {
                  const index = tc.index ?? 0;
                  if (!toolCallsMap[index]) {
                    toolCallsMap[index] = {
                      index,
                      id: tc.id || '',
                      type: tc.type || 'function',
                      function: { name: '', arguments: '' },
                    };
                  }
                  if (tc.id) toolCallsMap[index].id = tc.id;
                  if (tc.type) toolCallsMap[index].type = tc.type;
                  if (tc.function?.name) toolCallsMap[index].function.name = tc.function.name;
                  if (tc.function?.arguments) {
                    toolCallsMap[index].function.arguments += tc.function.arguments;
                  }
                }
              }
              if (chunk.usage) usage = chunk.usage;
            }
          }
        }

        const finalToolCalls =
          Object.keys(toolCallsMap).length > 0
            ? Object.values(toolCallsMap).sort((a: any, b: any) => a.index - b.index)
            : legacyFunctionCall?.name
              ? [{
                  id: randomUUID(),
                  type: 'function',
                  function: legacyFunctionCall,
                }]
              : null;

        res = {
          choices: [
            {
              message: { content: fullContent, tool_calls: finalToolCalls },
              finish_reason: lastChunk?.choices?.[0]?.finish_reason || 'stop',
            },
          ],
          usage: usage,
        };
      }
      this.endpointMode = 'chat';
      return this.parseChatResponse(res);
    } catch (e: any) {
      if ((e.status === 404 || e.status === 405) && !this.endpointMode) {
        this.endpointMode = 'completion';
        return this.completionFallback(messages, signal);
      }

      // If it's a 403 or API error, try to extract the real response body from 9router/OpenAI SDK
      let errorMsg = e.message || String(e);
      let rawBody = '';
      if (e.response && e.response.data) {
        try {
          rawBody =
            typeof e.response.data === 'string'
              ? e.response.data
              : JSON.stringify(e.response.data, null, 2);
          const parsed =
            typeof e.response.data === 'string' ? JSON.parse(e.response.data) : e.response.data;
          errorMsg = parsed.error?.message || parsed.errorMsg || JSON.stringify(parsed);
        } catch (_) {}
      } else if (e.error) {
        rawBody = typeof e.error === 'string' ? e.error : JSON.stringify(e.error, null, 2);
        if (e.error.message) {
          errorMsg = e.error.message;
        }
      } else if (e.errorMsg) {
        errorMsg = e.errorMsg;
      }

      // Fallback extraction for custom OpenAI wrapper errors
      if (errorMsg.includes('errorMsg: connect proxy error')) {
        throw new Error(
          `9Router Error: ${errorMsg}. Please check your 9router upstream proxy settings.\n\nRaw Error:\n${String(e)}\n\nRaw Body:\n${rawBody}`
        );
      }

      throw new Error(`${errorMsg}\n\nRaw Error:\n${String(e)}\n\nRaw Body:\n${rawBody}`);
    }
  }

  private parseChatResponse(res: OpenAI.ChatCompletion): ChatResponse {
    if (!res.choices || res.choices.length === 0) {
      return {
        text: '',
        toolCalls: [],
        usage: undefined,
        finishReason: 'no_choices',
        rawSnippet: JSON.stringify(res).slice(0, 300),
      };
    }
    const choice = res.choices[0];
    const toolCalls: ToolCall[] = [];

    if (choice.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        const args = parseToolArguments(tc.function.arguments, tc.function.name);
        if (!args) continue;
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        });
      }
    }
    const legacyFunctionCall = (choice.message as any)?.function_call;
    if (legacyFunctionCall?.name) {
      const args = parseToolArguments(legacyFunctionCall.arguments, legacyFunctionCall.name);
      if (args) {
        toolCalls.push({ id: randomUUID(), name: legacyFunctionCall.name, arguments: args });
      }
    }

    return {
      text: choice.message?.content || '',
      toolCalls,
      usage: res.usage
        ? {
            promptTokens: res.usage.prompt_tokens,
            completionTokens: res.usage.completion_tokens,
          }
        : undefined,
      finishReason: choice.finish_reason || undefined,
      rawSnippet:
        !choice.message?.content && !choice.message?.tool_calls
          ? JSON.stringify({ finish_reason: choice.finish_reason, message: choice.message }).slice(
              0,
              300
            )
          : undefined,
    };
  }

  private async completionFallback(messages: Message[], signal?: AbortSignal): Promise<ChatResponse> {
    if (messagesHaveImages(messages)) {
      throw new Error('Image input requires a chat/vision endpoint; completion fallback cannot process images.');
    }
    const prompt = messagesToPrompt(messages);

    const url = openAIEndpoint(this.baseUrl, 'completions');
    bypassProxyIfLocal(url);

    let fetchOpts: any = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      }),
    };

    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      try {
        const { Agent } = await import('undici');
        fetchOpts.dispatcher = new Agent({ connect: { rejectUnauthorized: false } }); // Raw socket agent, no proxy
      } catch (e) {}
    }

    if (signal) fetchOpts.signal = signal;
    const res = await fetch(url, fetchOpts);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(
        `Completion endpoint failed (${res.status}): ${err}\n\nRaw Response:\n${err}`
      );
    }

    const data = (await res.json()) as any;
    const text = data.choices?.[0]?.text || '';

    return {
      text,
      toolCalls: [],
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
          }
        : undefined,
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

  async chat(messages: Message[], tools?: ToolDef[], signal?: AbortSignal): Promise<ChatResponse> {
    if (this.endpointMode === 'openai-compat') {
      return this.openAICompatFallback(messages, tools, signal);
    }

    try {
      return await this.anthropicNative(messages, tools, signal);
    } catch (e: any) {
      if ((e.message?.includes('404') || e.message?.includes('Not Found')) && !this.endpointMode) {
        this.endpointMode = 'openai-compat';
        return this.openAICompatFallback(messages, tools, signal);
      }
      throw e;
    }
  }

  private async anthropicNative(messages: Message[], tools?: ToolDef[], signal?: AbortSignal): Promise<ChatResponse> {
    const clean = sanitizeMessages(messages);
    const systemText = clean
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const nonSystem = clean.filter((m) => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      stream: false,
      messages: nonSystem.map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: m.toolCallId || '',
                content: m.content,
              },
            ],
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
              content.push({
                type: 'image',
                source: { type: 'base64', media_type: img.mediaType, data: img.data },
              });
            }
          }
          return { role: m.role, content };
        }
        return { role: m.role, content: m.content };
      }),
    };

    if (systemText) {
      body.system = systemText;
    }

    if (tools?.length) {
      body.tools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    const url = anthropicMessagesEndpoint(this.baseUrl);
    bypassProxyIfLocal(url);

    let fetchOpts: any = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    };

    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      try {
        const { Agent } = await import('undici');
        fetchOpts.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
      } catch (e) {}
    }

    if (signal) fetchOpts.signal = signal;
    const res = await fetch(url, fetchOpts);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `Anthropic API error (${res.status}): ${errText}\n\nRaw Response:\n${errText}`
      );
    }

    let data: any;
    const rawText = await res.text();
    const trimmed = rawText.trim();
    if (trimmed.startsWith('data:') || trimmed.startsWith('event:')) {
      const lines = trimmed.split('\n');
      let textParts: string[] = [];
      const toolUses = new Map<number, { id: string; name: string; input: string }>();
      let usage: any = null;
      let lastMessage: any = null;
      let stopReason: string | undefined;
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
            toolUses.set(evt.index ?? toolUses.size, {
              id: evt.content_block.id,
              name: evt.content_block.name,
              input: evt.content_block.input && Object.keys(evt.content_block.input).length
                ? JSON.stringify(evt.content_block.input)
                : '',
            });
          }
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'input_json_delta') {
            const tool = toolUses.get(evt.index ?? 0);
            if (tool) tool.input += evt.delta.partial_json || '';
          }
          if (evt.type === 'message_delta') {
            if (evt.usage) usage = { ...usage, ...evt.usage };
            if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
          }
        } catch {}
      }
      if (lastMessage || textParts.length > 0 || toolUses.size > 0) {
        const orderedToolUses = [...toolUses.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([index, tool]) => {
            let input: Record<string, unknown> = {};
            const raw = tool.input.trim();
            if (raw) {
              let parsed: unknown;
              try {
                parsed = JSON.parse(raw);
              } catch {
                throw new Error(`Anthropic SSE returned malformed tool input for "${tool.name}" at block ${index}`);
              }
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error(`Anthropic SSE returned non-object tool input for "${tool.name}" at block ${index}`);
              }
              input = parsed as Record<string, unknown>;
            }
            return { type: 'tool_use', id: tool.id, name: tool.name, input };
          });
        data = {
          content: [
            ...(textParts.length > 0 ? [{ type: 'text', text: textParts.join('') }] : []),
            ...orderedToolUses,
          ],
          usage: usage || lastMessage?.usage || null,
          stop_reason: stopReason || lastMessage?.stop_reason || undefined,
        };
      }
      if (!data)
        throw new Error(
          'Proxy returned SSE stream but no valid message data found. Try a different proxy or add stream:false to your proxy config.'
        );
    } else {
      try {
        data = JSON.parse(trimmed);
      } catch {
        throw new Error(
          `Proxy returned non-JSON response:\n\n${trimmed}\n\nCheck your proxy URL and model ID.`
        );
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
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
          }
        : undefined,
      finishReason: data.stop_reason || undefined,
      rawSnippet:
        !text && toolCalls.length === 0
          ? JSON.stringify({
              stop_reason: data.stop_reason,
              type: data.type,
              content: data.content,
            }).slice(0, 300)
          : undefined,
    };
  }

  private async openAICompatFallback(
    messages: Message[],
    tools?: ToolDef[],
    signal?: AbortSignal
  ): Promise<ChatResponse> {
    const clean = sanitizeMessages(messages);
    const baseUrl = openAIBaseUrl(this.baseUrl);
    bypassProxyIfLocal(baseUrl);

    const client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: baseUrl,
    });

    const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: clean.map((m) => {
        if (m.role === 'tool') {
          return { role: 'tool' as const, content: m.content, tool_call_id: m.toolCallId || '' };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          };
        }
        if (m.images?.length) {
          const content: Array<
            { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
          > = [{ type: 'text', text: m.content }];
          for (const imgPath of m.images) {
            const img = imageToBase64(imgPath);
            if (img) {
              content.push({
                type: 'image_url',
                image_url: { url: `data:${img.mediaType};base64,${img.data}` },
              });
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

    let res;
    try {
      res = await client.chat.completions.create(params, { signal });
    } catch (e: any) {
      let errorMsg = e.message || String(e);
      let rawBody = '';
      if (e.response && e.response.data) {
        try {
          rawBody =
            typeof e.response.data === 'string'
              ? e.response.data
              : JSON.stringify(e.response.data, null, 2);
          const parsed =
            typeof e.response.data === 'string' ? JSON.parse(e.response.data) : e.response.data;
          errorMsg = parsed.error?.message || parsed.errorMsg || JSON.stringify(parsed);
        } catch (_) {}
      } else if (e.error) {
        rawBody = typeof e.error === 'string' ? e.error : JSON.stringify(e.error, null, 2);
        if (e.error.message) {
          errorMsg = e.error.message;
        }
      } else if (e.errorMsg) {
        errorMsg = e.errorMsg;
      }
      throw new Error(`${errorMsg}\n\nRaw Error:\n${String(e)}\n\nRaw Body:\n${rawBody}`);
    }

    if (!res.choices || res.choices.length === 0) {
      return {
        text: '',
        toolCalls: [],
        usage: undefined,
        finishReason: 'no_choices',
        rawSnippet: JSON.stringify(res).slice(0, 300),
      };
    }
    const choice = res.choices[0];
    const toolCalls: ToolCall[] = [];

    if (choice.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        const args = parseToolArguments(tc.function.arguments, tc.function.name);
        if (!args) continue;
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        });
      }
    }
    const legacyFunctionCall = (choice.message as any)?.function_call;
    if (legacyFunctionCall?.name) {
      const args = parseToolArguments(legacyFunctionCall.arguments, legacyFunctionCall.name);
      if (args) {
        toolCalls.push({ id: randomUUID(), name: legacyFunctionCall.name, arguments: args });
      }
    }

    return {
      text: choice.message?.content || '',
      toolCalls,
      usage: res.usage
        ? {
            promptTokens: res.usage.prompt_tokens,
            completionTokens: res.usage.completion_tokens,
          }
        : undefined,
      finishReason: choice.finish_reason || undefined,
      rawSnippet:
        !choice.message?.content && !choice.message?.tool_calls
          ? JSON.stringify({ finish_reason: choice.finish_reason, message: choice.message }).slice(
              0,
              300
            )
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

  async chat(messages: Message[], tools?: ToolDef[], signal?: AbortSignal): Promise<ChatResponse> {
    if (this.resolved) {
      return this.resolved.chat(messages, tools, signal);
    }

    const apiStyle = (this.config as any).apiStyle as string | undefined;

    if (apiStyle === 'anthropic') {
      this.resolved = new AnthropicProvider(this.config);
      return this.resolved.chat(messages, tools, signal);
    }

    if (apiStyle === 'openai') {
      this.resolved = new OpenAIProvider(this.config);
      return this.resolved.chat(messages, tools, signal);
    }

    try {
      this.openai = new OpenAIProvider(this.config);
      const result = await this.openai.chat(messages, tools, signal);
      this.resolved = this.openai;
      this.name = `custom (openai-compat)`;
      return result;
    } catch (error: any) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      try {
        this.anthropic = new AnthropicProvider(this.config);
        const result = await this.anthropic.chat(messages, tools, signal);
        this.resolved = this.anthropic;
        this.name = `custom (anthropic-compat)`;
        return result;
      } catch (e: any) {
        throw new Error(
          `Auto-detect failed. Set apiStyle to 'openai' or 'anthropic' explicitly. Last error: ${e.message}`
        );
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
    case 'custom-anthropic':
      return new AnthropicProvider(config);
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

  return messages.filter((m) => {
    if (m.role === 'tool') {
      return m.toolCallId && validCallIds.has(m.toolCallId);
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const hasResults = m.toolCalls.some((tc) =>
        messages.some((other) => other.role === 'tool' && other.toolCallId === tc.id)
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
