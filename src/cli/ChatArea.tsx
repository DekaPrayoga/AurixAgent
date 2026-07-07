import React, { useState, useEffect } from 'react';
import { TextAttributes, type ScrollAcceleration } from '@opentui/core';
import { theme } from './theme.js';
import { useThinkingAnimation } from './animation/useThinking.js';
import { FileDiff, parseToolEditOutput } from './FileDiff.js';
import { renderToolSpinnerText } from '../agent/ToolEventRenderer.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';

class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}
  tick(_now?: number): number {
    return this.speed;
  }
  reset(): void {}
}

const scrollAcceleration = new CustomSpeedScroll(3);

interface TextSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strikethrough?: boolean;
}

function parseInline(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Bold: **text** or __text__
    const boldMatch = remaining.match(/\*\*(.+?)\*\*|__(.+?)__/);
    // Inline code: `text`
    const codeMatch = remaining.match(/`([^`]+)`/);
    // Italic: *text* or _text_
    const italicMatch = remaining.match(
      /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/
    );
    // Strikethrough: ~~text~~
    const strikeMatch = remaining.match(/~~(.+?)~~/);

    const matches = [
      boldMatch && { type: 'bold', match: boldMatch, text: boldMatch[1] || boldMatch[2] },
      codeMatch && { type: 'code', match: codeMatch, text: codeMatch[1] },
      italicMatch && { type: 'italic', match: italicMatch, text: italicMatch[1] || italicMatch[2] },
      strikeMatch && { type: 'strike', match: strikeMatch, text: strikeMatch[1] },
    ]
      .filter(Boolean)
      .sort((a, b) => (a!.match.index || 0) - (b!.match.index || 0));

    if (matches.length === 0) {
      segments.push({ text: remaining });
      break;
    }

    const first = matches[0]!;
    const idx = first.match.index || 0;

    if (idx > 0) {
      segments.push({ text: remaining.slice(0, idx) });
    }

    segments.push({
      text: first.text,
      bold: first.type === 'bold',
      italic: first.type === 'italic',
      code: first.type === 'code',
      strikethrough: first.type === 'strike',
    });

    remaining = remaining.slice(idx + first.match[0].length);
  }

  return segments;
}

function InlineText({ text, baseFg }: { text: string; baseFg?: string }) {
  const segments = parseInline(safeDisplayText(text));
  const fg = baseFg || theme.text;

  return (
    <box flexDirection="row" flexWrap="wrap" flexGrow={1} flexShrink={1} minWidth={0}>
      {segments.map((seg, i) => {
        if (seg.code) {
          return (
            <text
              key={i}
              fg={theme.info}
              bg={theme.bgElement}
              attributes={TextAttributes.NONE}
              flexShrink={1}
            >
              {` ${seg.text} `}
            </text>
          );
        }
        let attrs = TextAttributes.NONE;
        if (seg.bold && seg.italic) attrs = TextAttributes.BOLD | TextAttributes.ITALIC;
        else if (seg.bold) attrs = TextAttributes.BOLD;
        else if (seg.italic) attrs = TextAttributes.ITALIC;
        else if (seg.strikethrough) attrs = TextAttributes.STRIKETHROUGH;
        const color = seg.bold ? theme.textBright : fg;
        return (
          <text key={i} fg={color} attributes={attrs} wrapMode="word" flexShrink={1}>
            {seg.text}
          </text>
        );
      })}
    </box>
  );
}

function charWidth(char: string): number {
  const code = char.codePointAt(0) || 0;
  if (code === 0x200d || (code >= 0x0300 && code <= 0x036f) || (code >= 0xfe00 && code <= 0xfe0f)) {
    return 0;
  }
  if (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff))
  ) {
    return 2;
  }
  return 1;
}

function displayWidth(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + charWidth(char), 0);
}

function truncateDisplay(text: string, width: number): string {
  let out = '';
  let used = 0;
  for (const char of Array.from(text)) {
    const next = used + charWidth(char);
    if (next > width) break;
    out += char;
    used = next;
  }
  return out;
}

function wrapDisplay(text: string, width: number): string[] {
  const value = (text || '').trim();
  if (!value) return [''];

  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  const pushHardWrapped = (word: string) => {
    let remaining = word;
    while (displayWidth(remaining) > width) {
      const part = truncateDisplay(remaining, width);
      lines.push(part);
      remaining = Array.from(remaining).slice(Array.from(part).length).join('');
    }
    current = remaining;
  };

  for (const word of words) {
    if (!current) {
      if (displayWidth(word) > width) pushHardWrapped(word);
      else current = word;
      continue;
    }

    const candidate = `${current} ${word}`;
    if (displayWidth(candidate) <= width) {
      current = candidate;
    } else {
      lines.push(current);
      if (displayWidth(word) > width) pushHardWrapped(word);
      else current = word;
    }
  }

  if (current || lines.length === 0) lines.push(current);
  return lines.slice(0, 6);
}

function isRuleLine(line: string): boolean {
  return /^[\s|:─━═—\-]+$/.test(line.trim()) && displayWidth(line.trim()) >= 3;
}

function parseLabelValue(line: string): { label: string; value: string } | null {
  const match = line.match(/^\s*([A-Za-z][A-Za-z0-9 /()._$-]{0,32})\s*:\s*(.*)$/);
  if (!match) return null;
  return { label: match[1].trim(), value: match[2].trim() };
}

function collectLabeledTable(
  lines: string[],
  start: number
): { headers: string[]; rows: string[][]; nextIndex: number } | null {
  const first = parseLabelValue(lines[start] || '');
  if (!first || first.label.toLowerCase() !== 'provider') return null;

  const blocks: Record<string, string>[] = [];
  let current: Record<string, string> = {};
  const headers: string[] = [];
  let i = start;

  const addHeader = (label: string) => {
    if (!headers.includes(label)) headers.push(label);
  };

  const flush = () => {
    if (Object.keys(current).length > 0) {
      blocks.push(current);
      current = {};
    }
  };

  while (i < lines.length) {
    const raw = lines[i];
    if (raw.trim() === '') break;
    if (isRuleLine(raw)) {
      flush();
      i++;
      continue;
    }

    const pair = parseLabelValue(raw);
    if (!pair) break;

    if (pair.label === first.label && Object.keys(current).length > 0) flush();
    addHeader(pair.label);
    current[pair.label] = pair.value || '—';
    i++;
  }
  flush();

  if (blocks.length < 2 || headers.length < 2) return null;
  const rows = blocks.map((block) => headers.map((header) => block[header] || ''));
  return { headers, rows, nextIndex: i };
}

function renderTable(headers: string[], rows: string[][], key: string): React.ReactNode {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length));
  const normalizedHeaders = Array.from(
    { length: colCount },
    (_, i) => headers[i] || `Column ${i + 1}`
  );
  const normalizedRows = rows.map((row) =>
    Array.from({ length: colCount }, (_, i) => row[i] || '')
  );
  const maxTableWidth = 92;
  const colWidths = normalizedHeaders.map((h, c) => {
    let max = displayWidth(h);
    for (const row of normalizedRows) {
      const width = displayWidth(row[c] || '');
      if (width > max) max = width;
    }
    return Math.min(Math.max(max, 6), 24);
  });

  let totalWidth = colWidths.reduce((sum, w) => sum + w + 3, 1);
  while (totalWidth > maxTableWidth && colWidths.some((w) => w > 10)) {
    let widest = 0;
    for (let idx = 1; idx < colWidths.length; idx++) {
      if (colWidths[idx] > colWidths[widest]) widest = idx;
    }
    colWidths[widest] -= 1;
    totalWidth = colWidths.reduce((sum, w) => sum + w + 3, 1);
  }

  const padCell = (text: string, width: number) => {
    const clean = truncateDisplay(text || '', width);
    return clean + ' '.repeat(Math.max(0, width - displayWidth(clean)));
  };

  const border = (left: string, mid: string, right: string) =>
    left + colWidths.map((w) => '─'.repeat(w + 2)).join(mid) + right;

  const renderRow = (cells: string[], isHeader: boolean, rowKey: string) => {
    const wrapped = colWidths.map((width, idx) => wrapDisplay(cells[idx] || '', width));
    const height = Math.max(...wrapped.map((cell) => cell.length), 1);
    return Array.from({ length: height }, (_, lineIdx) => {
      const parts = colWidths.map(
        (width, idx) => ` ${padCell(wrapped[idx][lineIdx] || '', width)} `
      );
      const text = '│' + parts.join('│') + '│';
      return (
        <text
          key={`${rowKey}-${lineIdx}`}
          fg={isHeader ? theme.primary : theme.text}
          attributes={isHeader ? TextAttributes.BOLD : TextAttributes.NONE}
        >
          {text}
        </text>
      );
    });
  };

  return (
    <box key={key} flexDirection="column" marginTop={1} marginBottom={1} flexShrink={0}>
      <text fg={theme.border}>{border('╭', '┬', '╮')}</text>
      {renderRow(normalizedHeaders, true, 'header')}
      <text fg={theme.border}>{border('├', '┼', '┤')}</text>
      {normalizedRows.flatMap((row, r) => renderRow(row, false, `row-${r}`))}
      <text fg={theme.border}>{border('╰', '┴', '╯')}</text>
    </box>
  );
}

function MarkdownText({ content }: { content: string }) {
  const lines = safeDisplayText(content).split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block: ```
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <box
          key={`code-${i}`}
          flexDirection="column"
          backgroundColor={theme.bgElement}
          border={['left']}
          borderColor={theme.accent}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          marginTop={1}
          marginBottom={1}
          flexShrink={0}
          minWidth={0}
        >
          {lang && (
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              {lang}
            </text>
          )}
          {codeLines.map((cl, j) => (
            <text key={j} fg={theme.info} wrapMode="word" minWidth={0}>
              {cl}
            </text>
          ))}
        </box>
      );
      continue;
    }

    // Table: | col1 | col2 | col3 |
    if (line.trimStart().startsWith('|') && line.includes('|', 1)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 2) {
        const parseRow = (row: string) =>
          row
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim());
        const headers = parseRow(tableLines[0]);
        const sepIdx = tableLines.findIndex((r, idx) => idx > 0 && /^[\s|:-]+$/.test(r));
        const dataRows = tableLines.filter((r, idx) => idx !== 0 && idx !== sepIdx).map(parseRow);
        elements.push(renderTable(headers, dataRows, `table-${i}`));
      }
      continue;
    }

    const labeledTable = collectLabeledTable(lines, i);
    if (labeledTable) {
      elements.push(renderTable(labeledTable.headers, labeledTable.rows, `kv-table-${i}`));
      i = labeledTable.nextIndex;
      continue;
    }

    // Headers: # ## ###
    const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const text = headerMatch[2];
      const color = level <= 2 ? theme.primary : level <= 4 ? theme.secondary : theme.text;
      const size = level === 1 ? `━━ ${text} ━━` : level === 2 ? `── ${text} ──` : text;
      elements.push(
        <box key={`h-${i}`} paddingTop={level <= 2 ? 1 : 0}>
          <text fg={color} attributes={TextAttributes.BOLD} wrapMode="word">
            {size}
          </text>
        </box>
      );
      i++;
      continue;
    }

    // Horizontal rule: ---, ***, ___
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      elements.push(
        <box key={`hr-${i}`}>
          <text fg={theme.border}>{'─'.repeat(40)}</text>
        </box>
      );
      i++;
      continue;
    }

    // Blockquote: > text
    if (line.trimStart().startsWith('>')) {
      const quoteText = line.replace(/^\s*>\s?/, '');
      elements.push(
        <box
          key={`q-${i}`}
          paddingLeft={2}
          border={['left']}
          borderColor={theme.accent}
          flexShrink={0}
          minWidth={0}
        >
          <text
            fg={theme.textMuted}
            attributes={TextAttributes.ITALIC}
            wrapMode="word"
            minWidth={0}
          >
            {quoteText}
          </text>
        </box>
      );
      i++;
      continue;
    }

    // Unordered list: - item, * item, + item
    const bulletMatch = line.match(/^(\s*)[-*+]\s+(?!\[[ xX]\])(.*)/);
    if (bulletMatch) {
      const indent = Math.floor((bulletMatch[1]?.length || 0) / 2);
      elements.push(
        <box key={`li-${i}`} paddingLeft={2 + indent * 2} flexDirection="row">
          <text fg={theme.primary}>● </text>
          <InlineText text={bulletMatch[2]} />
        </box>
      );
      i++;
      continue;
    }

    // Ordered list: 1. item
    const numMatch = line.match(/^(\s*)(\d+)[.)]\s+(.*)/);
    if (numMatch) {
      elements.push(
        <box key={`ol-${i}`} paddingLeft={2} flexDirection="row">
          <text fg={theme.secondary}>{numMatch[2]}. </text>
          <InlineText text={numMatch[3]} />
        </box>
      );
      i++;
      continue;
    }

    // Checkbox: - [ ] or - [x]
    const checkMatch = line.match(/^\s*-\s+\[([ xX])\]\s+(.*)/);
    if (checkMatch) {
      const checked = checkMatch[1] !== ' ';
      elements.push(
        <box key={`cb-${i}`} paddingLeft={2} flexDirection="row">
          <text fg={checked ? theme.ok : theme.textMuted}>{checked ? '✓ ' : '○ '}</text>
          <text fg={checked ? theme.text : theme.textMuted} wrapMode="word">
            {checkMatch[2]}
          </text>
        </box>
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Regular text with inline markdown
    elements.push(
      <box key={`p-${i}`} flexShrink={0}>
        <InlineText text={line} />
      </box>
    );
    i++;
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      {elements}
    </box>
  );
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string;
  model?: string;
  timestamp: Date;
  checkpointId?: string;
}

interface ChatAreaProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  activeTool?: { name: string; args?: Record<string, unknown> };
  scrollOffset: number;
  todos?: { text: string; done: boolean }[];
}

function ThinkingIndicator() {
  const frame = useThinkingAnimation(true, 90);
  return (
    <box paddingX={2}>
      <text fg={theme.thinking}>{frame} thinking</text>
    </box>
  );
}

function toolColor(name?: string): string {
  const tool = (name || '').toLowerCase();
  if (tool.includes('read') || tool.includes('search') || tool.includes('grep')) return theme.info;
  if (tool.includes('write') || tool.includes('edit') || tool.includes('delete')) return theme.warn;
  if (tool.includes('terminal') || tool.includes('bash') || tool.includes('code_exec'))
    return theme.secondary;
  if (tool.includes('browser') || tool.includes('captcha')) return theme.accent;
  if (tool.includes('research') || tool.includes('web')) return theme.primary;
  if (tool.includes('git') || tool.includes('github')) return theme.ok;
  if (tool.includes('ask')) return theme.thinking;
  return theme.tool;
}

function outputLineColor(line: string, fallback: string): string {
  const lower = line.toLowerCase();
  if (/\b(error|failed|exception|traceback|fatal|denied)\b/.test(lower)) return theme.error;
  if (/\b(warn|warning|caution|skipped)\b/.test(lower)) return theme.warn;
  if (/\b(success|done|written|deleted|created|updated|passed|built|published)\b/.test(lower))
    return theme.ok;
  if (/^(\s*(>|\$|npm|bun|node|python|git|pm2)\b)|\b(file|saved|path|output)\b/.test(lower))
    return theme.info;
  return fallback;
}

function ToolOutputText({ content, color }: { content: string; color: string }) {
  return (
    <box flexDirection="column">
      {truncateOutput(content)
        .split('\n')
        .map((line, i) => (
          <text
            key={i}
            fg={outputLineColor(line, i === 0 ? color : theme.textMuted)}
            wrapMode="word"
          >
            {line}
          </text>
        ))}
    </box>
  );
}

function ToolSpinner({ name, args }: { name: string; args?: Record<string, unknown> }) {
  const [tick, setTick] = useState(0);
  const charsUnicode = ['·', '✢', '*', '✶', '✻', '✽'];
  const charsAscii = ['.', '*', '**', '***', '****', '***', '**', '*'];
  const chars = process.platform === 'win32' ? charsAscii : charsUnicode;
  const frames = process.platform === 'win32' ? chars : [...chars, ...[...chars].reverse()];
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 120);
    return () => clearInterval(id);
  }, []);

  const detail = renderToolSpinnerText({ toolName: name, args });
  const color = toolColor(name);

  return (
    <box paddingX={2} flexDirection="column">
      <box flexDirection="row">
        <text fg={color}>{frames[tick % frames.length]} </text>
        <text fg={theme.textMuted}>{safeDisplayText(detail)}</text>
      </box>
    </box>
  );
}

function truncateOutput(content: string, maxLines: number = 14): string {
  const lines = content.split('\n');
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).join('\n') + `\n  ... (${lines.length - maxLines} more lines)`;
  }
  return content;
}

function UserMessage({ msg }: { msg: ChatMessage }) {
  return (
    <box flexDirection="column" paddingX={2} flexShrink={0}>
      <box
        border={['left']}
        borderColor={theme.primary}
        backgroundColor={theme.bgPanel}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexShrink={0}
        minWidth={0}
      >
        <text fg={theme.text} wrapMode="word" minWidth={0}>
          {safeDisplayText(msg.content)}
        </text>
      </box>
    </box>
  );
}

function AssistantMessage({ msg }: { msg: ChatMessage }) {
  if (!msg.content) return null;
  return (
    <box flexDirection="column" paddingX={2} flexShrink={0}>
      {msg.model && (
        <box paddingBottom={0} paddingLeft={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            {msg.model}
          </text>
        </box>
      )}
      <box
        border={['left']}
        borderColor={theme.secondary}
        backgroundColor={theme.bgPanel}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexShrink={0}
        minWidth={0}
      >
        <MarkdownText content={msg.content} />
      </box>
    </box>
  );
}

function ToolMessage({ msg }: { msg: ChatMessage }) {
  const content = safeDisplayText(msg.content);
  const color = toolColor(msg.toolName);
  const canRenderDiff = msg.toolName === 'file_edit' || msg.toolName === 'write_file';
  const diff = canRenderDiff ? parseToolEditOutput(content) : null;
  if (diff) {
    return (
      <box flexDirection="column" flexShrink={0}>
        <box paddingLeft={4} paddingRight={2}>
          <text fg={color}>▸ </text>
          <text fg={color}>{msg.toolName || 'tool'}</text>
        </box>
        <FileDiff
          filePath={diff.filePath}
          oldLines={diff.oldLines}
          newLines={diff.newLines}
          lineStart={diff.lineStart}
        />
      </box>
    );
  }
  return (
    <box flexDirection="column" paddingLeft={4} paddingRight={2} flexShrink={0}>
      <box>
        <text fg={color}>▸ </text>
        <text fg={color}>{msg.toolName || 'tool'}</text>
      </box>
      <box paddingLeft={2}>
        <ToolOutputText content={content} color={color} />
      </box>
    </box>
  );
}

function SystemMessage({ msg }: { msg: ChatMessage }) {
  return (
    <box paddingLeft={4} paddingRight={2} flexShrink={0}>
      <text fg={theme.warn} wrapMode="word">
        {safeDisplayText(msg.content)}
      </text>
    </box>
  );
}

export function ChatArea({
  messages,
  isProcessing,
  activeTool,
  scrollOffset,
  todos,
}: ChatAreaProps) {
  const maxVisible = 100;
  const end = Math.max(0, messages.length - scrollOffset);
  const start = Math.max(0, end - maxVisible);
  const visible = messages.slice(start, end);

  const todoCount = todos ? `${todos.filter((t) => t.done).length}/${todos.length}` : null;

  return (
    <box flexDirection="column" minHeight={0} backgroundColor={theme.bg}>
      {todoCount && (
        <box flexDirection="row" justifyContent="flex-end" paddingX={1}>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            Todo: {todoCount}
          </text>
        </box>
      )}
      <scrollbox
        stickyScroll={true}
        stickyStart="bottom"
        flexGrow={1}
        scrollAcceleration={scrollAcceleration}
        verticalScrollbarOptions={{ visible: false }}
      >
        <box height={1} />
        <box flexDirection="column" gap={1}>
          {visible.length === 0 ? (
            <box justifyContent="center" paddingY={2}>
              <text fg={theme.textMuted}>no messages yet</text>
            </box>
          ) : (
            visible.map((msg, i) => (
              <box key={start + i} flexDirection="column" flexShrink={0}>
                {msg.role === 'user' && <UserMessage msg={msg} />}
                {msg.role === 'assistant' && <AssistantMessage msg={msg} />}
                {msg.role === 'tool' && <ToolMessage msg={msg} />}
                {msg.role === 'system' && <SystemMessage msg={msg} />}
              </box>
            ))
          )}
          {isProcessing && activeTool && (
            <ToolSpinner name={activeTool.name} args={activeTool.args} />
          )}
          {isProcessing && !activeTool && <ThinkingIndicator />}
        </box>
      </scrollbox>
    </box>
  );
}
