import React, { useState, useEffect } from 'react';
import { TextAttributes } from '@opentui/core';
import { theme } from './theme.js';
import { useThinkingAnimation } from './animation/useThinking.js';
import { FileDiff, parseToolEditOutput } from './FileDiff.js';

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
    const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/);
    // Strikethrough: ~~text~~
    const strikeMatch = remaining.match(/~~(.+?)~~/);

    const matches = [
      boldMatch && { type: 'bold', match: boldMatch, text: boldMatch[1] || boldMatch[2] },
      codeMatch && { type: 'code', match: codeMatch, text: codeMatch[1] },
      italicMatch && { type: 'italic', match: italicMatch, text: italicMatch[1] || italicMatch[2] },
      strikeMatch && { type: 'strike', match: strikeMatch, text: strikeMatch[1] },
    ].filter(Boolean).sort((a, b) => (a!.match.index || 0) - (b!.match.index || 0));

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
  const segments = parseInline(text);
  const fg = baseFg || theme.text;

  return (
    <box flexDirection="row" flexWrap="wrap" flexGrow={1} flexShrink={1} minWidth={0}>
      {segments.map((seg, i) => {
        if (seg.code) {
          return (
            <text key={i} fg={theme.info} bg={theme.bgElement} attributes={TextAttributes.NONE} flexShrink={1}>
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
        return <text key={i} fg={color} attributes={attrs} wrapMode="word" flexShrink={1}>{seg.text}</text>;
      })}
    </box>
  );
}

function MarkdownText({ content }: { content: string }) {
  const lines = content.split('\n');
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
        <box key={`code-${i}`} flexDirection="column" backgroundColor={theme.bgElement} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} marginTop={1} marginBottom={1}>
          {lang && <text fg={theme.textMuted} attributes={TextAttributes.DIM}>{lang}</text>}
          {codeLines.map((cl, j) => (
            <text key={j} fg={theme.info} wrapMode="word">{cl}</text>
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
          row.split('|').slice(1, -1).map(c => c.trim());
        const isSeparator = (row: string) => /^\|[\s:-]+\|$/.test(row.replace(/[\s:-|]/g, ''));

        const headers = parseRow(tableLines[0]);
        const sepIdx = tableLines.findIndex((r, idx) => idx > 0 && /^[\s|:-]+$/.test(r));
        const dataRows = tableLines
          .filter((r, idx) => idx !== 0 && idx !== sepIdx)
          .map(parseRow);

        const colCount = headers.length;
        const colWidths = headers.map((h, c) => {
          let max = h.length;
          for (const row of dataRows) {
            if (row[c] && row[c].length > max) max = row[c].length;
          }
          return Math.min(max + 2, 40);
        });

        const padCell = (text: string, width: number) => {
          const clean = (text || '').slice(0, width);
          return clean + ' '.repeat(Math.max(0, width - clean.length));
        };

        const topBorder = colWidths.map(w => '─'.repeat(w + 2)).join('┬');
        const midBorder = colWidths.map(w => '─'.repeat(w + 2)).join('┼');
        const botBorder = colWidths.map(w => '─'.repeat(w + 2)).join('┴');

        const renderRow = (cells: string[], isHeader: boolean) => {
          const parts = cells.map((c, idx) => ` ${padCell(c, colWidths[idx])} `);
          const text = '│' + parts.join('│') + '│';
          return (
            <text fg={isHeader ? theme.primary : theme.text} attributes={isHeader ? TextAttributes.BOLD : TextAttributes.NONE}>{text}</text>
          );
        };

        elements.push(
          <box key={`table-${i}`} flexDirection="column" marginTop={1} marginBottom={1}>
            <text fg={theme.border}>{'╭' + topBorder + '╮'}</text>
            {renderRow(headers, true)}
            <text fg={theme.border}>{'├' + midBorder + '┤'}</text>
            {dataRows.map((row, r) => renderRow(row, false))}
            <text fg={theme.border}>{'╰' + botBorder + '╯'}</text>
          </box>
        );
      }
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
          <text fg={color} attributes={TextAttributes.BOLD} wrapMode="word">{size}</text>
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
        <box key={`q-${i}`} paddingLeft={2} border={["left"]} borderColor={theme.accent}>
          <text fg={theme.textMuted} attributes={TextAttributes.ITALIC} wrapMode="word">{quoteText}</text>
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
          <text fg={checked ? theme.text : theme.textMuted} wrapMode="word">{checkMatch[2]}</text>
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
      <box key={`p-${i}`} flexGrow={1}>
        <InlineText text={line} />
      </box>
    );
    i++;
  }

  return <box flexDirection="column">{elements}</box>;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string;
  timestamp: Date;
}

interface ChatAreaProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  activeTool?: { name: string; args?: Record<string, unknown> };
  scrollOffset: number;
}

function ThinkingIndicator() {
  const frame = useThinkingAnimation(true, 90);
  return (
    <box paddingX={2}>
      <text fg={theme.thinking}>{frame} thinking</text>
    </box>
  );
}

function ToolSpinner({ name, args }: { name: string; args?: Record<string, unknown> }) {
  const [tick, setTick] = useState(0);
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 120);
    return () => clearInterval(id);
  }, []);

  let detail = '';
  if (args) {
    if (name === 'bash' && args.command) {
      const cmd = String(args.command);
      detail = cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
    } else if (args.file_path || args.path) {
      detail = String(args.file_path || args.path || '');
    } else if (args.pattern) {
      detail = String(args.pattern);
    } else if (args.url) {
      detail = String(args.url);
    } else if (args.query) {
      detail = String(args.query);
    }
  }

  return (
    <box paddingX={2} flexDirection="column">
      <box flexDirection="row">
        <text fg={theme.tool}>{frames[tick % frames.length]} {name}</text>
        {detail && <text fg={theme.textMuted}> {detail}</text>}
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
    <box flexDirection="column" paddingX={2} flexGrow={1}>
      <box
        border={["left"]}
        borderColor={theme.primary}
        backgroundColor={theme.bgPanel}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexGrow={1}
      >
        <text fg={theme.text} wrapMode="word">{msg.content}</text>
      </box>
    </box>
  );
}

function AssistantMessage({ msg }: { msg: ChatMessage }) {
  if (!msg.content) return null;
  return (
    <box flexDirection="column" paddingX={2} flexGrow={1}>
      <box
        border={["left"]}
        borderColor={theme.secondary}
        backgroundColor={theme.bgPanel}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexGrow={1}
      >
        <MarkdownText content={msg.content} />
      </box>
    </box>
  );
}

function ToolMessage({ msg }: { msg: ChatMessage }) {
  const diff = parseToolEditOutput(msg.content);
  if (diff) {
    return (
      <box flexDirection="column">
        <box paddingLeft={4} paddingRight={2}>
          <text fg={theme.tool}>▸ </text>
          <text fg={theme.toolDim}>{msg.toolName || 'tool'}</text>
        </box>
        <FileDiff filePath={diff.filePath} oldLines={diff.oldLines} newLines={diff.newLines} lineStart={diff.lineStart} />
      </box>
    );
  }
  return (
    <box flexDirection="column" paddingLeft={4} paddingRight={2}>
      <box>
        <text fg={theme.tool}>▸ </text>
        <text fg={theme.toolDim}>{msg.toolName || 'tool'}</text>
      </box>
      <box paddingLeft={2}>
        <text fg={theme.textMuted} wrapMode="word">{truncateOutput(msg.content)}</text>
      </box>
    </box>
  );
}

function SystemMessage({ msg }: { msg: ChatMessage }) {
  return (
    <box paddingLeft={4} paddingRight={2}>
      <text fg={theme.warn} wrapMode="word">{msg.content}</text>
    </box>
  );
}

export function ChatArea({ messages, isProcessing, activeTool, scrollOffset }: ChatAreaProps) {
  const maxVisible = 100;
  const end = Math.max(0, messages.length - scrollOffset);
  const start = Math.max(0, end - maxVisible);
  const visible = messages.slice(start, end);

  return (
    <box flexDirection="column" minHeight={0} backgroundColor={theme.bg}>
      <scrollbox
        stickyScroll={true}
        stickyStart="bottom"
        flexGrow={1}
        verticalScrollbarOptions={{ visible: false }}
      >
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
          {isProcessing && activeTool && <ToolSpinner name={activeTool.name} args={activeTool.args} />}
          {isProcessing && !activeTool && <ThinkingIndicator />}
        </box>
      </scrollbox>
    </box>
  );
}
