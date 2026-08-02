export interface ParsedTextToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface TextToolCallParseResult {
  calls: ParsedTextToolCall[];
  visibleText: string;
  recognizedProtocol: boolean;
  requiresRepair: boolean;
}

interface JsonSpan {
  start: number;
  end: number;
  raw: string;
}

const XML_CALL = /<function=([a-zA-Z0-9_-]+)>([\s\S]*?)<\/function(?:=[a-zA-Z0-9_-]+)?>/g;
const XML_PARAMETER = /<parameter=([a-zA-Z0-9_-]+)>([\s\S]*?)<\/parameter(?:=[a-zA-Z0-9_-]+)?>/g;
const PROTOCOL_MARKER = /<\/?(?:tool_call|function(?:=[a-zA-Z0-9_-]+)?|parameter(?:=[a-zA-Z0-9_-]+)?)(?:\s[^>]*)?>/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseArguments(value: unknown): Record<string, unknown> | null {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function callsFromEnvelope(value: unknown): { recognized: boolean; calls: ParsedTextToolCall[] } {
  if (!isPlainObject(value)) return { recognized: false, calls: [] };
  const rawCalls: unknown[] = Array.isArray(value.tool_calls)
    ? value.tool_calls
    : value.name || value.function
      ? [value]
      : [];
  if (!rawCalls.length) return { recognized: false, calls: [] };

  const calls: ParsedTextToolCall[] = [];
  for (const raw of rawCalls) {
    if (!isPlainObject(raw)) return { recognized: true, calls: [] };
    const fn = isPlainObject(raw.function) ? raw.function : raw;
    const name = typeof fn.name === 'string' ? fn.name.trim() : '';
    const args = parseArguments(fn.arguments ?? raw.arguments);
    if (!name || !args) return { recognized: true, calls: [] };
    calls.push({ name, arguments: args });
  }
  return { recognized: true, calls };
}

function scanBalancedObject(text: string, start: number): JsonSpan | null {
  if (text[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return { start, end: index + 1, raw: text.slice(start, index + 1) };
    }
  }
  return null;
}

function findTopLevelJsonSequence(text: string): JsonSpan[] {
  if (/```/.test(text)) return [];
  const spans: JsonSpan[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const objectStart = text.indexOf('{', cursor);
    if (objectStart < 0) break;
    const prefix = text.slice(cursor, objectStart);
    if (spans.length > 0 && prefix.trim()) break;
    const linePrefix = text.slice(text.lastIndexOf('\n', objectStart - 1) + 1, objectStart);
    if (linePrefix.trim()) {
      cursor = objectStart + 1;
      continue;
    }
    const span = scanBalancedObject(text, objectStart);
    if (!span) break;
    spans.push(span);
    cursor = span.end;
    if (text.slice(cursor).trim() && !/^\s*\{/.test(text.slice(cursor))) break;
  }
  return spans;
}

function parseXmlArguments(raw: string): Record<string, unknown> | null {
  const args: Record<string, unknown> = {};
  const parameterPattern = new RegExp(XML_PARAMETER.source, 'g');
  let parameter: RegExpExecArray | null;
  while ((parameter = parameterPattern.exec(raw))) args[parameter[1]] = parameter[2].trim();
  if (Object.keys(args).length) return args;
  return parseArguments(raw.trim() || '{}');
}

export function parseTextToolCalls(
  text: string,
  allowedNames: ReadonlySet<string>
): TextToolCallParseResult {
  const parsedCalls: ParsedTextToolCall[] = [];
  let recognizedProtocol = false;
  let requiresRepair = false;
  let visibleText = text;

  const xmlPattern = new RegExp(XML_CALL.source, 'g');
  const xmlSpans: Array<{ start: number; end: number }> = [];
  let xml: RegExpExecArray | null;
  while ((xml = xmlPattern.exec(text))) {
    recognizedProtocol = true;
    const args = parseXmlArguments(xml[2]);
    if (!allowedNames.has(xml[1]) || !args) requiresRepair = true;
    else parsedCalls.push({ name: xml[1], arguments: args });
    xmlSpans.push({ start: xml.index, end: xml.index + xml[0].length });
  }
  if (xmlSpans.length) {
    visibleText = xmlSpans.reduceRight(
      (current, span) => current.slice(0, span.start) + current.slice(span.end),
      text
    ).replace(/<tool_call>|<\/tool_call>/g, '').trim();
  }

  if (!xmlSpans.length && PROTOCOL_MARKER.test(text)) {
    recognizedProtocol = true;
    requiresRepair = true;
    visibleText = text.replace(/<tool_call>[\s\S]*$/i, '').trim();
  }

  if (!xmlSpans.length && !recognizedProtocol) {
    const spans = findTopLevelJsonSequence(text);
    const accepted: JsonSpan[] = [];
    for (const span of spans) {
      let value: unknown;
      try {
        value = JSON.parse(span.raw);
      } catch {
        continue;
      }
      const envelope = callsFromEnvelope(value);
      if (!envelope.recognized) continue;
      recognizedProtocol = true;
      accepted.push(span);
      if (!envelope.calls.length || envelope.calls.some((call) => !allowedNames.has(call.name))) {
        requiresRepair = true;
        continue;
      }
      parsedCalls.push(...envelope.calls);
    }
    if (accepted.length) {
      visibleText = accepted.reduceRight(
        (current, span) => current.slice(0, span.start) + current.slice(span.end),
        text
      ).trim();
    }
  }

  return {
    calls: requiresRepair ? [] : parsedCalls,
    visibleText: recognizedProtocol ? visibleText : text,
    recognizedProtocol,
    requiresRepair,
  };
}
