import { getEncoding, type Tiktoken } from 'js-tiktoken';

type Encoding = 'cl100k_base' | 'o200k_base';

const cache = new Map<string, Tiktoken>();

function getEnc(name: Encoding): Tiktoken {
  let enc = cache.get(name);
  if (!enc) {
    enc = getEncoding(name);
    cache.set(name, enc);
  }
  return enc;
}

function fallbackCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export function countTokens(text: string, encoding?: Encoding): number {
  try {
    return getEnc(encoding || 'cl100k_base').encode(text).length;
  } catch {
    return fallbackCount(text);
  }
}

export function countTokensBatch(texts: string[], encoding?: Encoding): number[] {
  try {
    const enc = getEnc(encoding || 'cl100k_base');
    return texts.map(t => enc.encode(t).length);
  } catch {
    return texts.map(t => fallbackCount(t));
  }
}
