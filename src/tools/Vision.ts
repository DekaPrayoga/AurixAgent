import fs from 'fs';
import path from 'path';
import type { Tool } from './Registry.js';

export const visionTool: Tool = {
  name: 'vision',
  description: 'Analyze images or screenshots. Send an image path or URL to a multimodal model for description, OCR, or analysis.',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Image file path or URL to analyze',
      },
      question: {
        type: 'string',
        description: 'What to ask about the image (default: describe this image)',
      },
    },
    required: ['source'],
  },
  async execute(args) {
    const source = args.source as string;
    const question = (args.question as string) || 'Describe this image in detail.';

    let imageBase64: string | null = null;
    let imageUrl: string | null = null;

    if (source.startsWith('http://') || source.startsWith('https://')) {
      imageUrl = source;
    } else {
      const filePath = path.resolve(source);
      if (!fs.existsSync(filePath)) {
        return `File not found: ${filePath}`;
      }
      const data = fs.readFileSync(filePath);
      imageBase64 = data.toString('base64');
    }

    const provider = process.env.AURIX_PROVIDER || 'openai';
    const apiKey = process.env.AURIX_API_KEY || '';
    const model = process.env.AURIX_VISION_MODEL || process.env.AURIX_MODEL || 'gpt-4o';

    if (!apiKey) {
      return 'No API key set. Set AURIX_API_KEY to use vision.';
    }

    if (provider === 'anthropic') {
      return analyzeWithAnthropic(apiKey, model, question, imageBase64, imageUrl);
    }

    return analyzeWithOpenAI(apiKey, model, question, imageBase64, imageUrl);
  },
};

async function analyzeWithOpenAI(
  apiKey: string, model: string, question: string,
  imageBase64: string | null, imageUrl: string | null
): Promise<string> {
  const content: any[] = [{ type: 'text', text: question }];

  if (imageBase64) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${imageBase64}` },
    });
  } else if (imageUrl) {
    content.push({ type: 'image_url', image_url: { url: imageUrl } });
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      max_tokens: 1024,
    }),
  });

  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content || 'No response from vision model.';
}

async function analyzeWithAnthropic(
  apiKey: string, model: string, question: string,
  imageBase64: string | null, imageUrl: string | null
): Promise<string> {
  const content: any[] = [];

  if (imageBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: imageBase64 },
    });
  }

  content.push({ type: 'text', text: question });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    }),
  });

  const data = await res.json() as any;
  return data.content?.[0]?.text || 'No response from vision model.';
}
