import React, { useMemo } from 'react';
import { SyntaxStyle, TextAttributes, type ScrollAcceleration } from '@opentui/core';
import { theme } from './theme.js';
import { formatDuration, humanToolName, statusColor, statusIcon, toolColor, toolIcon, toolSummary } from './visual.js';
import { useThinkingAnimation, useScanner, useElapsedSeconds } from './animation/useThinking.js';
import { FileDiff, parseToolEditOutput } from './FileDiff.js';
import { renderToolSpinnerText } from '../agent/ToolEventRenderer.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';
import { expandAurixHighlights } from './MarkdownExtensions.js';
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
  toolArgs?: Record<string, unknown>;
  toolCallId?: string;
  toolStatus?: 'running' | 'success' | 'error' | 'timeout' | 'cancelled';
  durationMs?: number;
  errorType?: string;
  model?: string;
  timestamp: Date;
  checkpointId?: string;
}

interface ChatAreaProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  activeTool?: { name: string; args?: Record<string, unknown> };
  scrollOffset: number;
  onJumpToBottom?: () => void;
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

function sanitizeToolPreview(content: string, maxLines = 50): string {
  return safeDisplayText(truncateOutput(content, maxLines));
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
      {lines.map((line, i) => markdown ? (
        <InlineText key={i} text={line} baseFg={color} />
      ) : (
        <text key={i} fg={i === 0 ? color : theme.textMuted} wrapMode="word">
          {line}
        </text>
      ))}
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

function truncateOutput(content: string, maxLines: number = 50): string {
  const bounded = truncateRawPreview(content, maxLines, Number.MAX_SAFE_INTEGER);
  const lines = content.split('\n');
  if (lines.length <= maxLines) return bounded;
  const head = lines.slice(0, Math.max(2, maxLines - 2));
  const tail = lines.slice(-2);
  return [...head, `  … ${lines.length - head.length - tail.length} more lines`, ...tail].join('\n');
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
      default: { fg: theme.markdownText },
      'markup.heading': { fg: theme.markdownHeading, bold: true },
      'markup.heading.1': { fg: theme.primary, bold: true },
      'markup.heading.2': { fg: theme.markdownHeading, bold: true },
      'markup.bold': { fg: theme.markdownStrong, bold: true },
      'markup.strong': { fg: theme.markdownStrong, bold: true },
      'markup.italic': { fg: theme.markdownEmphasis, italic: false },
      'markup.emphasis': { fg: theme.markdownEmphasis, italic: false },
      'markup.link': { fg: theme.markdownLink, underline: true },
      'markup.link.url': { fg: theme.markdownLinkText, underline: true },
      'markup.raw': { fg: theme.markdownCode },
      'markup.quote': { fg: theme.markdownQuote, italic: true },
      comment: { fg: theme.syntaxComment, italic: true },
      keyword: { fg: theme.syntaxKeyword },
      string: { fg: theme.syntaxString },
      number: { fg: theme.syntaxNumber },
      function: { fg: theme.syntaxFunction },
      'function.call': { fg: theme.syntaxFunction },
      'function.method': { fg: theme.syntaxFunction },
      type: { fg: theme.syntaxType },
      constructor: { fg: theme.syntaxType },
      variable: { fg: theme.markdownText },
      'variable.builtin': { fg: theme.primary },
      property: { fg: theme.info },
      constant: { fg: theme.syntaxNumber },
      tag: { fg: theme.syntaxKeyword },
      attribute: { fg: theme.syntaxFunction },
      embedded: { fg: theme.syntaxString },
      operator: { fg: theme.syntaxOperator },
      punctuation: { fg: theme.syntaxPunctuation },
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
        content={expandAurixHighlights(msg.content)}
        syntaxStyle={getMarkdownSyntax(themeVersion)}
        fg={theme.markdownText}
        streaming={streaming}
        conceal={true}
        concealCode={false}
        tableOptions={getTableOptions(themeVersion)}
      />
    </box>
  );
});

function isTerminalTool(name?: string): boolean {
  return /^(terminal|bash|shell|code_exec|terminal_)/i.test(name || '');
}

function TerminalToolMessage({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = React.useState(false);
  const status = msg.toolStatus || (msg.errorType ? 'error' : 'success');
  const stateColor = statusColor(status);
  const command = typeof msg.toolArgs?.command === 'string' ? msg.toolArgs.command : toolSummary(msg.toolName, msg.toolArgs);
  const workdir = typeof msg.toolArgs?.workdir === 'string' ? msg.toolArgs.workdir : undefined;
  const duration = formatDuration(msg.durationMs);
  const commandOverflow = (command || '').split('\n').length > 50;
  const outputOverflow = msg.content.split('\n').length > 50;
  const overflow = commandOverflow || outputOverflow;
  const visibleCommand = expanded ? safeDisplayText(command || '') : safeDisplayText((command || '').split('\n').slice(0, 50).join('\n'));
  const output = expanded ? safeDisplayText(msg.content) : sanitizeToolPreview(msg.content, 50);
  return (
    <box
      flexDirection="column"
      marginTop={1}
      marginLeft={2}
      marginRight={2}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      border={['left']}
      borderColor={stateColor}
      backgroundColor={theme.bgPanel}
      flexShrink={0}
      onMouseDown={(event) => {
        if (event.button !== 0 || !overflow) return;
        event.preventDefault();
        event.stopPropagation();
        setExpanded((value) => !value);
      }}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{workdir ? `Running in ${safeDisplayText(workdir)}` : 'Terminal'}</text>
        <text fg={stateColor}>{duration ? `${duration}  ` : ''}{statusIcon(status)}</text>
      </box>
      <box flexDirection="row" marginTop={1}>
        <text fg={theme.primary}>$ </text>
        <text fg={theme.info}>{visibleCommand}</text>
      </box>
      {output && output !== '(no output)' && (
        <box marginTop={1} paddingLeft={2} border={['left']} borderColor={theme.borderSubtle}>
          <text fg={status === 'error' || status === 'timeout' ? theme.error : theme.textMuted}>{output}</text>
        </box>
      )}
      {overflow && <text fg={theme.textMuted}>{expanded ? 'Click box to collapse' : 'Click box to show full output'}</text>}
    </box>
  );
}

const ToolMessage = React.memo(function ToolMessage({
  msg,
}: {
  msg: ChatMessage;
  themeVersion: number;
}) {
  if (isTerminalTool(msg.toolName)) return <TerminalToolMessage msg={msg} />;
  const color = toolColor(msg.toolName);
  const status = msg.toolStatus || (msg.errorType ? 'error' : 'success');
  const stateColor = statusColor(status);
  const summary = toolSummary(msg.toolName, msg.toolArgs);
  const duration = formatDuration(msg.durationMs);
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
        <box flexDirection="row" paddingLeft={3} paddingRight={2} justifyContent="space-between">
          <box flexDirection="row">
            <text fg={color}>{toolIcon(msg.toolName)} </text>
            <text fg={status === 'success' ? theme.textMuted : color} attributes={TextAttributes.BOLD}>{humanToolName(msg.toolName)}</text>
            {summary && <text fg={theme.textMuted}>  {summary}</text>}
          </box>
          <text fg={stateColor}>{duration ? `${duration}  ` : ''}{statusIcon(status)}</text>
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
    <box flexDirection="column" paddingLeft={3} paddingRight={2} flexShrink={0}>
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row">
          <text fg={color}>{toolIcon(msg.toolName)} </text>
          <text fg={status === 'success' ? theme.textMuted : color} attributes={TextAttributes.BOLD}>{humanToolName(msg.toolName)}</text>
          {summary && <text fg={theme.textMuted}>  {summary}</text>}
        </box>
        <text fg={stateColor}>{duration ? `${duration}  ` : ''}{statusIcon(status)}</text>
      </box>
      {msg.content && (
        <box paddingLeft={2} border={['left']} borderColor={status === 'error' || status === 'timeout' ? theme.error : theme.borderSubtle}>
          <ToolOutputText content={msg.content} color={stateColor} markdown={msg.toolName === 'memory'} />
        </box>
      )}
    </box>
  );
});

const SystemMessage = React.memo(function SystemMessage({
  msg,
}: {
  msg: ChatMessage;
  themeVersion: number;
}) {
  const completion = msg.content.match(/^Model: (.+?) · Duration: (.+?) · Tools: (\d+)$/);
  return (
    <box
      flexDirection="row"
      paddingLeft={completion ? 3 : 4}
      paddingRight={2}
      marginTop={completion ? 1 : 0}
      flexShrink={0}
    >
      {completion ? (
        <box flexDirection="row">
          <text fg={theme.secondary}>{'▣ '}</text>
          <text fg={theme.secondary}>Model: </text>
          <text fg={theme.textBright}>{safeDisplayText(completion[1])}</text>
          <text fg={theme.textMuted}>{` · Duration: ${safeDisplayText(completion[2])} · Tools: ${completion[3]}`}</text>
        </box>
      ) : (
        <text fg={theme.warn} wrapMode="word">{safeDisplayText(msg.content)}</text>
      )}
    </box>
  );
});

export function ChatArea({
  messages,
  isProcessing,
  activeTool,
  scrollOffset,
  onJumpToBottom,
  themeVersion = 0,
}: ChatAreaProps) {
  const { visible, start } = useMemo(
    () => selectVisibleMessages(messages, scrollOffset),
    [messages, scrollOffset]
  );

  return (
    <box flexDirection="column" minHeight={0} backgroundColor={theme.bg}>
      {scrollOffset > 0 && (
        <box flexDirection="row" justifyContent="center" flexShrink={0}>
          <box
            backgroundColor={theme.bgSelected}
            border={['left', 'right']}
            borderColor={theme.primary}
            paddingX={1}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              onJumpToBottom?.();
            }}
          >
            <text fg={theme.primary} attributes={TextAttributes.BOLD}>↓ Jump to the bottom</text>
            <text fg={theme.textMuted}>  End</text>
          </box>
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
