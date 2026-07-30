import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { loadConfig, type AurixConfig } from '../agent/Config.js';
import type { Gateway } from '../gateway/Gateway.js';
import type { Tool } from './Registry.js';

type ImageConfig = NonNullable<AurixConfig['imageGeneration']>;

type ImagePayload = {
  data?: Buffer;
  url?: string;
  mediaType?: string;
};

const IMAGE_OUTPUT_DIR = path.join(os.homedir(), '.aurix', 'generated-images');

export function hasImageGenerationConfig(config: AurixConfig): config is AurixConfig & {
  imageGeneration: Required<Pick<ImageConfig, 'baseUrl' | 'apiKey' | 'format'>> & ImageConfig;
} {
  const image = config.imageGeneration;
  return Boolean(
    image?.baseUrl &&
      isAllowedImageEndpoint(image.baseUrl) &&
      image.apiKey &&
      (image.format === 'openai' || image.format === 'anthropic')
  );
}

export function createImageGeneratorTool(config: AurixConfig, gateway: Gateway): Tool {
  return {
    name: 'image_generator',
    displayName: 'Image Generator',
    description:
      'Image Generator: generate an image from a text description in Discord or Telegram gateway chats. Use this when the user asks to create/generate/draw an image. This is gateway-only and unsupported in CLI.',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Text description/prompt for the image to generate',
        },
        size: {
          type: 'string',
          description: 'Optional image size such as 1024x1024',
        },
      },
      required: ['description'],
    },
    async execute(args) {
      const description = String(args.description || '').trim();
      const size = args.size ? String(args.size) : undefined;
      if (!description) return 'Error: description is required.';

      const context = gateway.getMostRecentContext();
      if (!context) {
        return 'Error: Image generation is gateway-only and requires a Discord or Telegram conversation context.';
      }
      if (context.platform !== 'discord' && context.platform !== 'telegram') {
        return 'Error: Image generation is only supported in Discord and Telegram.';
      }
      const currentConfig = loadConfig();
      const effectiveConfig = hasImageGenerationConfig(currentConfig) ? currentConfig : config;
      if (!hasImageGenerationConfig(effectiveConfig)) {
        return 'Error: Image generation is not configured. Use /image:gen <description> in Telegram or /image gen in Discord to set it up.';
      }

      const filePath = await generateImageToFile(effectiveConfig.imageGeneration, description, {
        size,
      });
      return `Generated image saved.\nFile: ${filePath}`;
    },
  };
}

export async function generateImageToFile(
  config: ImageConfig,
  description: string,
  options: { size?: string } = {}
): Promise<string> {
  if (!config.baseUrl || !config.apiKey || !config.format) {
    throw new Error('Image generation is not configured.');
  }

  const payload =
    config.format === 'anthropic'
      ? await requestAnthropicImage(config, description, options)
      : await requestOpenAIImage(config, description, options);

  const data = payload.data || (payload.url ? await fetchImageUrl(payload.url) : undefined);
  if (!data) {
    throw new Error(
      'Image endpoint returned no supported image payload. Expected base64 image data or image URL.'
    );
  }

  const mediaType = payload.mediaType || detectMediaType(data) || 'image/png';
  const ext = extensionForMediaType(mediaType);
  fs.mkdirSync(IMAGE_OUTPUT_DIR, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-');
  const filePath = path.join(
    IMAGE_OUTPUT_DIR,
    `aurix-image-${stamp}-${randomUUID().slice(0, 8)}${ext}`
  );
  fs.writeFileSync(filePath, data);
  return filePath;
}

async function requestOpenAIImage(
  config: ImageConfig,
  description: string,
  options: { size?: string }
): Promise<ImagePayload> {
  const endpoint = imageEndpoint(config.baseUrl!, 'openai');
  const body = {
    model: config.model || 'gpt-image-1',
    prompt: description,
    n: 1,
    size: options.size || config.size || '1024x1024',
    response_format: 'b64_json',
  };

  let json = await postJson(
    endpoint,
    {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body
  );

  if (!extractImagePayload(json).data && !extractImagePayload(json).url) {
    json = await postJson(
      endpoint,
      {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      { ...body, response_format: undefined }
    );
  }

  return extractImagePayload(json);
}

async function requestAnthropicImage(
  config: ImageConfig,
  description: string,
  options: { size?: string }
): Promise<ImagePayload> {
  const endpoint = imageEndpoint(config.baseUrl!, 'anthropic');
  const json = await postJson(
    endpoint,
    {
      'x-api-key': config.apiKey!,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    {
      prompt: description,
      model: config.model,
      size: options.size || config.size,
      response_format: 'base64',
    }
  );

  return extractImagePayload(json);
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
): Promise<any> {
  const cleanedBody = Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined && value !== '')
  );
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(cleanedBody),
  });
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const message = json?.error?.message || json?.message || text || `HTTP ${res.status}`;
    throw new Error(`Image endpoint failed: ${String(message).slice(0, 500)}`);
  }
  return json;
}

function isAllowedImageEndpoint(baseUrl: string): boolean {
  return /\/v1\/(responses|chat\/completions|image\/generations)$/i.test(
    baseUrl.replace(/\/+$/, '')
  );
}

function imageEndpoint(baseUrl: string, _format: 'openai' | 'anthropic'): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (isAllowedImageEndpoint(trimmed)) return trimmed;
  throw new Error(
    'Invalid image endpoint. Must end with /v1/responses, /v1/chat/completions, or /v1/image/generations.'
  );
}

function extractImagePayload(value: any): ImagePayload {
  const direct = parseImageCandidate(value);
  if (direct.data || direct.url) return direct;

  const candidates = [
    value?.data?.[0],
    value?.image,
    value?.result,
    value?.output?.[0],
    ...(Array.isArray(value?.content) ? value.content : []),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const parsed = parseImageCandidate(candidate);
    if (parsed.data || parsed.url) return parsed;
  }

  return {};
}

function parseImageCandidate(candidate: any): ImagePayload {
  if (!candidate) return {};
  const base64 =
    candidate.b64_json ||
    candidate.base64 ||
    candidate.data ||
    candidate.image_base64 ||
    candidate.source?.data;
  const mediaType = candidate.media_type || candidate.mime_type || candidate.source?.media_type;
  if (typeof base64 === 'string' && looksLikeBase64(base64)) {
    return { data: Buffer.from(stripDataUrlPrefix(base64), 'base64'), mediaType };
  }
  const url = candidate.url || candidate.image_url || candidate.source?.url;
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) return { url, mediaType };
  if (candidate.type === 'text' && typeof candidate.text === 'string') {
    const match = candidate.text.match(/https?:\/\/\S+/);
    if (match) return { url: match[0].replace(/[).,;]+$/, '') };
  }
  return {};
}

function looksLikeBase64(value: string): boolean {
  const stripped = stripDataUrlPrefix(value);
  return stripped.length > 80 && /^[A-Za-z0-9+/=\r\n]+$/.test(stripped);
}

function stripDataUrlPrefix(value: string): string {
  return value.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
}

async function fetchImageUrl(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download generated image: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function detectMediaType(data: Buffer): string | undefined {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return undefined;
}

function extensionForMediaType(mediaType: string): string {
  const lower = mediaType.toLowerCase();
  if (lower.includes('jpeg') || lower.includes('jpg')) return '.jpg';
  if (lower.includes('webp')) return '.webp';
  if (lower.includes('gif')) return '.gif';
  return '.png';
}
