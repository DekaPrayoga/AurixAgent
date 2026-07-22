import React, { useState, useEffect, useMemo } from 'react';
import { SyntaxStyle, TextAttributes, type ScrollAcceleration } from '@opentui/core';
import { theme } from './theme.js';
import { useThinkingAnimation } from './animation/useThinking.js';
import { FileDiff, parseToolEditOutput } from './FileDiff.js';
import { renderToolSpinnerText } from '../agent/ToolEventRenderer.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';
import {
  parseMarkdownTableBlock,
  renderMarkdownTableAsBlocks,
} from '../utils/StructuredOutputFormat.js';

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
  const segments = useMemo(() => parseInline(safeDisplayText(text)), [text]);
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
  const tableText = renderMarkdownTableAsBlocks(headers, rows);
  return (
    <box key={key} flexDirection="column" marginTop={1} marginBottom={1} flexShrink={0}>
      {tableText.split('\n').map((line, idx) => (
        <text
          key={idx}
          fg={idx === 0 ? theme.primary : isRuleLine(line) ? theme.border : theme.text}
          attributes={idx === 0 ? TextAttributes.BOLD : TextAttributes.NONE}
        >
          {line}
        </text>
      ))}
    </box>
  );
}

function MarkdownText({ content, themeVersion }: { content: string; themeVersion: number }) {
  const elements = useMemo(() => {
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
        const table = parseMarkdownTableBlock(tableLines, 0);
        if (table) {
          const blockText = renderMarkdownTableAsBlocks(table.headers, table.rows);
          elements.push(
            <box key={`table-${i}`} flexDirection="column" marginTop={1} marginBottom={1}>
              {blockText.split('\n').map((blockLine: string, j: number) =>
                isRuleLine(blockLine) ? (
                  <text key={j} fg={theme.border}>
                    {blockLine}
                  </text>
                ) : (
                  <box key={j} flexShrink={0}>
                    <InlineText text={blockLine} />
                  </box>
                )
              )}
            </box>
          );
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

    return elements;
  }, [content, themeVersion]);

  return (
    <box flexDirection="column" flexShrink={0}>
      {elements}
    </box>
  );
}

export interface ChatMessage {
  id?: string;
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
  themeVersion?: number;
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
  const lines = useMemo(() => truncateOutput(content).split('\n'), [content]);
  return (
    <box flexDirection="column">
      {lines.map((line, i) => (
        <text key={i} fg={outputLineColor(line, i === 0 ? color : theme.textMuted)} wrapMode="word">
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

function truncateOutput(content: string, maxLines: number = 14, maxChars: number = 8_000): string {
  const bounded = content.length > maxChars
    ? `${content.slice(0, maxChars)}\n  ... (${content.length - maxChars} more characters)`
    : content;
  const lines = bounded.split('\n');
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).join('\n') + `\n  ... (${lines.length - maxLines} more lines)`;
  }
  return content;
}

const UserMessage = React.memo(function UserMessage({
  msg,
}: {
  msg: ChatMessage;
  themeVersion: number;
}) {
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
});

let markdownSyntaxVersion = -1;
let markdownSyntax: SyntaxStyle | undefined;

function getMarkdownSyntax(themeVersion: number): SyntaxStyle {
  if (!markdownSyntax || markdownSyntaxVersion !== themeVersion) {
    markdownSyntax?.destroy();
    markdownSyntax = SyntaxStyle.fromStyles({
      default: { fg: theme.text },
      'markup.heading': { fg: theme.markdownHeading, bold: true },
      'markup.heading.1': { fg: theme.primary, bold: true },
      'markup.heading.2': { fg: theme.markdownHeading, bold: true },
      'markup.bold': { fg: theme.markdownStrong, bold: true },
      'markup.italic': { fg: theme.textSecondary, italic: true },
      'markup.link': { fg: theme.markdownLink, underline: true },
      'markup.raw': { fg: theme.markdownCode },
      'markup.quote': { fg: theme.markdownQuote, italic: true },
      comment: { fg: theme.textMuted, italic: true },
      keyword: { fg: theme.accent },
      string: { fg: theme.ok },
      number: { fg: theme.warn },
      function: { fg: theme.info },
      type: { fg: theme.primary },
      operator: { fg: theme.textSecondary },
      punctuation: { fg: theme.textMuted },
    });
    markdownSyntaxVersion = themeVersion;
  }
  return markdownSyntax;
}

const MARKDOWN_TABLE_OPTIONS = { style: 'columns' as const, wrapMode: 'word' as const, cellPaddingX: 1 };

export function selectVisibleMessages(
  messages: ChatMessage[],
  scrollOffset: number,
  maxMessages = messages.length,
  _maxChars?: number
): { visible: ChatMessage[]; start: number } {
  const end = Math.max(0, messages.length - scrollOffset);
  const start = Math.max(0, end - maxMessages);
  return { visible: messages.slice(start, end), start };
}

const AssistantMessage = React.memo(function AssistantMessage({
  msg,
  themeVersion,
  streaming,
}: {
  msg: ChatMessage;
  themeVersion: number;
  streaming: boolean;
}) {
  if (!msg.content) return null;
  return (
    <box flexDirection="column" paddingLeft={3} paddingRight={2} marginTop={1} flexShrink={0}>
      <markdown
        content={msg.content}
        syntaxStyle={getMarkdownSyntax(themeVersion)}
        fg={theme.text}
        streaming={streaming}
        conceal={true}
        concealCode={false}
        tableOptions={MARKDOWN_TABLE_OPTIONS}
      />
    </box>
  );
});

const ToolMessage = React.memo(function ToolMessage({
  msg,
}: {
  msg: ChatMessage;
  themeVersion: number;
}) {
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
});

const SystemMessage = React.memo(function SystemMessage({
  msg,
}: {
  msg: ChatMessage;
  themeVersion: number;
}) {
  const completion = /^Model: .* · Duration: .* · Tools: \d+$/.test(msg.content);
  return (
    <box paddingLeft={completion ? 3 : 4} paddingRight={2} marginTop={completion ? 1 : 0} flexShrink={0}>
      <text fg={completion ? theme.textMuted : theme.warn} wrapMode="word">
        {completion ? `▣ ${safeDisplayText(msg.content)}` : safeDisplayText(msg.content)}
      </text>
    </box>
  );
});

export function ChatArea({
  messages,
  isProcessing,
  activeTool,
  scrollOffset,
  todos,
  themeVersion = 0,
}: ChatAreaProps) {
  const { visible, start } = useMemo(
    () => selectVisibleMessages(messages, scrollOffset),
    [messages, scrollOffset]
  );

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
        <box flexDirection="column">
          {visible.length === 0 ? (
            <box justifyContent="center" paddingY={2}>
              <text fg={theme.textMuted}>no messages yet</text>
            </box>
          ) : (
            visible.map((msg, i) => (
              <box key={msg.id || `${start + i}:${msg.role}`} flexDirection="column" flexShrink={0}>
                {msg.role === 'user' && <UserMessage msg={msg} themeVersion={themeVersion} />}
                {msg.role === 'assistant' && (
                  <AssistantMessage
                    msg={msg}
                    themeVersion={themeVersion}
                    streaming={isProcessing && start + i === messages.length - 1}
                  />
                )}
                {msg.role === 'tool' && <ToolMessage msg={msg} themeVersion={themeVersion} />}
                {msg.role === 'system' && <SystemMessage msg={msg} themeVersion={themeVersion} />}
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
