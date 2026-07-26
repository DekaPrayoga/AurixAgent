import React, { useMemo } from 'react';
import { SyntaxStyle, TextAttributes, type ScrollAcceleration } from '@opentui/core';
import { theme } from './theme.js';
import { toolColor, toolIcon } from './visual.js';
import { useThinkingAnimation, useScanner, useElapsedSeconds } from './animation/useThinking.js';
import { FileDiff, parseToolEditOutput } from './FileDiff.js';
import { renderToolSpinnerText } from '../agent/ToolEventRenderer.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';
import {
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
  // A pulsing glyph alone looks the same at second 1 and second 90. The elapsed counter is
  // what tells you whether a long wait is progress or a hang.
  const seconds = useElapsedSeconds(true);
  return (
    <box paddingX={2} flexDirection="row">
      <text fg={theme.thinking}>{frame} thinking</text>
      {seconds >= 2 && <text fg={theme.textMuted}>{`  ${seconds}s`}</text>}
    </box>
  );
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

function stripIncompleteControlTail(content: string): string {
  const starts = [
    content.lastIndexOf('\x1b]'),
    content.lastIndexOf('\x1bP'),
    content.lastIndexOf('\x1b^'),
    content.lastIndexOf('\x1b_'),
    content.lastIndexOf('\x1bX'),
    content.lastIndexOf('\x9d'),
  ];
  const start = Math.max(...starts);
  if (start >= 0) {
    const introducerLength = content.charCodeAt(start) === 0x1b ? 2 : 1;
    const rest = content.slice(start + introducerLength);
    const terminated = rest.includes('\x07') || rest.includes('\x1b\\') || rest.includes('\x9c');
    if (!terminated) return content.slice(0, start);
  }
  return content
    .replace(/\x1b(?:\[[0-?]*[ -/]*)?$/g, '')
    .replace(/\x9b[0-?]*[ -/]*$/g, '');
}

function truncateRawPreview(
  content: string,
  maxLines: number = 14,
  maxChars: number = 8_000,
): string {
  let prefix = content;
  let hiddenChars = 0;
  if (content.length > maxChars) {
    prefix = content.slice(0, maxChars);
    const lastCodeUnit = prefix.charCodeAt(prefix.length - 1);
    if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
      prefix = prefix.slice(0, -1);
    }
    prefix = stripIncompleteControlTail(prefix);
    hiddenChars = content.length - prefix.length;
  }

  const lines = prefix.split('\n');
  let bounded = lines.slice(0, maxLines).join('\n');
  const hiddenLines = Math.max(0, lines.length - maxLines);
  if (hiddenLines > 0) bounded += `\n  ... (${hiddenLines} more lines)`;
  if (hiddenChars > 0) bounded += `\n  ... (${hiddenChars} more characters)`;
  return bounded;
}

function sanitizeToolPreview(content: string): string {
  return safeDisplayText(truncateOutput(content));
}

function previewToolArgs(
  args?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!args) return undefined;
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if (typeof value === 'string') return [key, truncateRawPreview(value, 3, 600)];
      if (Array.isArray(value)) {
        return [
          key,
          value.slice(0, 12).map((item) =>
            typeof item === 'string' ? truncateRawPreview(item, 1, 120) : item,
          ),
        ];
      }
      return [key, value];
    }),
  );
}

function ToolOutputText({
  content,
  color,
  markdown = false,
}: {
  content: string;
  color: string;
  markdown?: boolean;
}) {
  const lines = useMemo(() => sanitizeToolPreview(content).split('\n'), [content]);
  return (
    <box flexDirection="column">
      {lines.map((line, i) => {
        const lineColor = outputLineColor(line, i === 0 ? color : theme.textMuted);
        return markdown ? (
          <InlineText key={i} text={line} baseFg={lineColor} />
        ) : (
          <text key={i} fg={lineColor} wrapMode="word">
            {line}
          </text>
        );
      })}
    </box>
  );
}

function ToolSpinner({ name, args }: { name: string; args?: Record<string, unknown> }) {
  // A sweeping bar rather than a twirl: it shows the run is still moving even when the
  // tool name has not changed for a while.
  const scan = useScanner(true, 7, 80);

  const detail = useMemo(
    () =>
      safeDisplayText(
        renderToolSpinnerText({ toolName: name, args: previewToolArgs(args) }),
      ),
    [name, args],
  );
  const color = useMemo(() => toolColor(name), [name]);

  return (
    <box paddingX={2} flexDirection="column">
      <box flexDirection="row">
        <text fg={color}>{scan} </text>
        <text fg={theme.textMuted}>{detail}</text>
      </box>
    </box>
  );
}

function truncateOutput(content: string, maxLines: number = 14, maxChars: number = 8_000): string {
  return truncateRawPreview(content, maxLines, maxChars);
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
        <box flexDirection="row" flexShrink={0}>
          <text fg={theme.bg} bg={theme.primary} attributes={TextAttributes.BOLD}>
            {' you '}
          </text>
        </box>
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

/**
 * Tables render as a real bordered grid rather than bare aligned columns. Borderless
 * columns read as an accidental block of text once a row wraps; a grid makes the cell
 * boundaries unambiguous.
 *
 * Theme-dependent, so it is rebuilt whenever the palette changes — a plain module
 * constant would keep the old border colour after a theme switch.
 */
let tableOptionsVersion = -1;
let tableOptions: ReturnType<typeof buildTableOptions> | undefined;

function getTableOptions(themeVersion: number) {
  if (!tableOptions || tableOptionsVersion !== themeVersion) {
    tableOptions = buildTableOptions();
    tableOptionsVersion = themeVersion;
  }
  return tableOptions;
}

function buildTableOptions() {
  return {
    style: 'grid' as const,
    wrapMode: 'word' as const,
    cellPaddingX: 1,
    borderColor: theme.borderSubtle,
    borderStyle: 'rounded' as const,
  };
}

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
        tableOptions={getTableOptions(themeVersion)}
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
  const color = toolColor(msg.toolName);
  const canRenderDiff = msg.toolName === 'file_edit' || msg.toolName === 'write_file';
  const diff = canRenderDiff ? parseToolEditOutput(msg.content) : null;
  if (diff) {
    const safeDiff = {
      filePath: safeDisplayText(diff.filePath),
      oldLines: diff.oldLines.map((line) => safeDisplayText(line)),
      newLines: diff.newLines.map((line) => safeDisplayText(line)),
      lineStart: diff.lineStart,
    };
    return (
      <box flexDirection="column" flexShrink={0}>
        <box flexDirection="row" paddingLeft={4} paddingRight={2}>
          <text fg={color}>{toolIcon(msg.toolName)} </text>
          <text fg={color} attributes={TextAttributes.BOLD}>{msg.toolName || 'tool'}</text>
        </box>
        <FileDiff
          filePath={safeDiff.filePath}
          oldLines={safeDiff.oldLines}
          newLines={safeDiff.newLines}
          lineStart={safeDiff.lineStart}
        />
      </box>
    );
  }
  return (
    <box flexDirection="column" paddingLeft={4} paddingRight={2} flexShrink={0}>
      <box flexDirection="row">
        <text fg={color}>{toolIcon(msg.toolName)} </text>
        <text fg={color} attributes={TextAttributes.BOLD}>{msg.toolName || 'tool'}</text>
      </box>
      <box paddingLeft={2}>
        <ToolOutputText content={msg.content} color={color} markdown={msg.toolName === 'memory'} />
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
    <box
      flexDirection="row"
      paddingLeft={completion ? 3 : 4}
      paddingRight={2}
      marginTop={completion ? 1 : 0}
      flexShrink={0}
    >
      {completion && <text fg={theme.primary}>{'▣ '}</text>}
      <text
        fg={completion ? theme.textMuted : theme.warn}
        attributes={completion ? TextAttributes.DIM : TextAttributes.NONE}
        wrapMode="word"
      >
        {safeDisplayText(msg.content)}
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
        // No `visible` flag: passing one pins the bar on or off forever. Left unset it
        // follows the content, appearing only once the transcript overflows. Forcing it
        // visible painted a full-height solid thumb over every short session.
        verticalScrollbarOptions={{
          showArrows: false,
          trackOptions: {
            backgroundColor: theme.bgPanel,
            foregroundColor: theme.borderSubtle,
          },
        }}
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
