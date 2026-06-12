import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Encoding = 'cl100k_base' | 'o200k_base';

interface NativeModule {
  countTokens(text: string, encoding?: string): number;
  countTokensBatch(texts: string[], encoding?: string): number[];
}

let native: NativeModule | null = null;

function loadNative(): NativeModule | null {
  if (native) return native;
  const candidates = [
    join(__dirname, '..', 'native', 'token-counter', `token-counter.${process.platform}-${process.arch}-gnu.node`),
    join(__dirname, '..', 'native', 'token-counter', `token-counter.${process.platform}-${process.arch}.node`),
    join(__dirname, 'token-counter.node'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      native = require(p) as NativeModule;
      return native;
    }
  }
  return null;
}

function fallbackCount(text: string): number {
  let tokens = 0;
  let i = 0;
  while (i < text.length) {
    const code = text.codePointAt(i)!;
    if (code > 0xffff) { i += 2; tokens += 2; }
    else if (code >= 0x4e00 && code <= 0x9fff) { i += 1; tokens += 2; }
    else if (code === 32 || code === 10) { i += 1; tokens += 1; }
    else if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      let wordLen = 1;
      while (i + wordLen < text.length) {
        const c = text.codePointAt(i + wordLen)!;
        if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) wordLen++;
        else break;
      }
      i += wordLen;
      tokens += Math.ceil(wordLen / 4) + (wordLen > 4 ? 1 : 0);
    } else { i += 1; tokens += 1; }
  }
  return tokens;
}

export function countTokens(text: string, encoding?: Encoding): number {
  const mod = loadNative();
  if (mod) return mod.countTokens(text, encoding);
  return fallbackCount(text);
}

export function countTokensBatch(texts: string[], encoding?: Encoding): number[] {
  const mod = loadNative();
  if (mod) return mod.countTokensBatch(texts, encoding);
  return texts.map(t => fallbackCount(t));
}

export function isNativeLoaded(): boolean {
  return loadNative() !== null;
}
