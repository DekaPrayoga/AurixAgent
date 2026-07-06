import React, { useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { theme } from './theme.js';
import type { ChatMessage } from './ChatArea.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';

interface OutputPanelProps {
  messages: ChatMessage[];
  onClose: () => void;
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

export function OutputPanel({ messages, onClose }: OutputPanelProps) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const [scrollOffset, setScrollOffset] = useState(0);

  const toolMessages = React.useMemo(() => {
    return messages.filter((m) => m.role === 'tool' || (m.role === 'assistant' && m.toolName));
  }, [messages]);

  const totalLines = toolMessages.length;
  const visibleLines = termHeight - 4;

  useKeyboard((evt) => {
    const name = evt.name;
    if (name === 'escape') {
      evt.preventDefault();
      onClose();
      return;
    }
    if (name === 'up') {
      evt.preventDefault();
      setScrollOffset((prev) => Math.min(prev + 1, Math.max(0, totalLines - 1)));
      return;
    }
    if (name === 'down') {
      evt.preventDefault();
      setScrollOffset((prev) => Math.max(0, prev - 1));
      return;
    }
    if (name === 'pageup') {
      evt.preventDefault();
      setScrollOffset((prev) => Math.min(prev + 10, Math.max(0, totalLines - 1)));
      return;
    }
    if (name === 'pagedown') {
      evt.preventDefault();
      setScrollOffset((prev) => Math.max(0, prev - 10));
      return;
    }
  });

  const visible = toolMessages.slice(
    Math.max(0, totalLines - visibleLines - scrollOffset),
    totalLines - scrollOffset
  );

  return (
    <box
      flexDirection="column"
      width={termWidth}
      height={termHeight}
      borderStyle="single"
      borderColor={theme.border}
    >
      <box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          Tool Outputs
        </text>
        <text attributes={TextAttributes.DIM}>
          {totalLines} items | ESC to close | ↑↓ to scroll
        </text>
      </box>
      <box flexDirection="column" flexGrow={1} minHeight={0} paddingX={1}>
        {visible.length === 0 ? (
          <text attributes={TextAttributes.DIM}>No tool outputs yet.</text>
        ) : (
          visible.map((msg, i) => {
            const color = toolColor(msg.toolName);
            const content = safeDisplayText(msg.content);
            const preview = content.slice(0, 500);
            return (
              <box key={i} flexDirection="column" marginBottom={1}>
                <text fg={color} attributes={TextAttributes.BOLD}>
                  {msg.toolName || 'tool'}
                </text>
                {preview.split('\n').map((line, lineIdx) => (
                  <text
                    key={lineIdx}
                    fg={outputLineColor(line, lineIdx === 0 ? color : theme.textMuted)}
                  >
                    {line}
                  </text>
                ))}
                {content.length > 500 && (
                  <text attributes={TextAttributes.DIM}>... (truncated)</text>
                )}
              </box>
            );
          })
        )}
      </box>
      <box flexDirection="row" justifyContent="center" paddingX={1}>
        <text attributes={TextAttributes.DIM}>
          Scroll: {scrollOffset}/{Math.max(0, totalLines - visibleLines)}
        </text>
      </box>
    </box>
  );
}
