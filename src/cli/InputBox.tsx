import React, { useEffect, useMemo, useState } from 'react';
import { TextAttributes, decodePasteBytes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions, usePaste } from '@opentui/react';
import { theme } from './theme.js';
import { isPasteKey, readClipboard, readClipboardImage, writeClipboard } from './Clipboard.js';
import type { SlashCommand } from './commands.js';
import { completeCommand, filterSlashCommands } from './commands.js';
import { filterFiles } from './fileList.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';

interface InputBoxProps {
  onSubmit: (value: string) => void;
  disabled: boolean;
  commands?: SlashCommand[];
  home?: boolean;
  model?: string;
  contextPct?: number;
  cwd?: string;
  mode?: 'auto' | 'ask' | 'deny';
  onModeCycle?: () => void;
  onExit?: () => void;
  onRewind?: () => boolean;
}

const MODE_LABEL: Record<'auto' | 'ask' | 'deny', string> = {
  auto: 'Auto',
  ask: 'Ask',
  deny: 'Deny',
};
const MODE_COLOR: Record<'auto' | 'ask' | 'deny', string> = {
  auto: theme.ok,
  ask: theme.secondary,
  deny: theme.error,
};

const MAX_VISIBLE_SUGGESTIONS = 8;

let pasteInProgress = false;
let lastPasteStart = -1;
let lastPasteLen = 0;
let lastCtrlCEmpty = 0;
const pastedBlocks = new Map<string, string>();

export function InputBox({
  onSubmit,
  disabled,
  commands = [],
  home = false,
  model,
  contextPct = 0,
  cwd,
  mode = 'auto',
  onModeCycle,
  onExit,
  onRewind,
}: InputBoxProps) {
  const { width: termWidth } = useTerminalDimensions();

  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const cursorRef = React.useRef(0);
  const valueRef = React.useRef('');

  React.useEffect(() => {
    cursorRef.current = cursor;
    valueRef.current = value;
  }, [cursor, value]);
  const [selStart, setSelStart] = useState(-1);
  const [selEnd, setSelEnd] = useState(-1);
  const selStartRef = React.useRef(-1);
  const selEndRef = React.useRef(-1);

  const setInputState = React.useCallback((nextValue: string, nextCursor: number) => {
    const clamped = Math.max(0, Math.min(nextCursor, nextValue.length));
    valueRef.current = nextValue;
    cursorRef.current = clamped;
    setValue(nextValue);
    setCursor(clamped);
  }, []);

  const clearSelection = React.useCallback(() => {
    selStartRef.current = -1;
    selEndRef.current = -1;
    setSelStart(-1);
    setSelEnd(-1);
  }, []);

  const setSelectionState = React.useCallback((start: number, end: number) => {
    selStartRef.current = start;
    selEndRef.current = end;
    setSelStart(start);
    setSelEnd(end);
  }, []);
  const hasActiveSelection = React.useCallback(() => {
    return (
      selStartRef.current >= 0 &&
      selEndRef.current >= 0 &&
      selStartRef.current !== selEndRef.current
    );
  }, []);

  const replaceSelectionOrInsert = React.useCallback(
    (text: string) => {
      const currentValue = valueRef.current;
      const currentCursor = cursorRef.current;
      if (hasActiveSelection()) {
        const start = Math.min(selStartRef.current, selEndRef.current);
        const end = Math.max(selStartRef.current, selEndRef.current);
        setInputState(
          currentValue.slice(0, start) + text + currentValue.slice(end),
          start + text.length
        );
        clearSelection();
        return;
      }
      setInputState(
        currentValue.slice(0, currentCursor) + text + currentValue.slice(currentCursor),
        currentCursor + text.length
      );
      clearSelection();
    },
    [clearSelection, hasActiveSelection, setInputState]
  );

  const insertPastedText = React.useCallback(
    (rawText?: string) => {
      const clean = safeDisplayText(rawText || '')
        .replace(/\r\n/g, '\n')
        .trimEnd();
      if (!clean) return;
      const lines = clean.split('\n');
      if (lines.length >= 2 || clean.length > 200) {
        const placeholder = `[pasted-${pastedBlocks.size + 1}]`;
        pastedBlocks.set(placeholder, clean);
        replaceSelectionOrInsert(placeholder);
        return;
      }
      replaceSelectionOrInsert(clean);
    },
    [replaceSelectionOrInsert]
  );

  const insertClipboardImage = React.useCallback(
    (imgPath: string) => {
      const summary = `[image: ${imgPath}]`;
      lastPasteStart = hasActiveSelection()
        ? Math.min(selStartRef.current, selEndRef.current)
        : cursorRef.current;
      lastPasteLen = summary.length;
      replaceSelectionOrInsert(summary);
    },
    [hasActiveSelection, replaceSelectionOrInsert]
  );

  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [spinnerTick, setSpinnerTick] = useState(0);
  const lastEscRef = React.useRef<number>(0);

  // Only animate spinner when input is disabled — avoids render contention
  // with keystrokes during normal typing (was causing ~500ms input lag)
  useEffect(() => {
    if (!disabled) return;
    const id = setInterval(() => setSpinnerTick((n) => n + 1), 530);
    return () => clearInterval(id);
  }, [disabled]);

  useEffect(() => {
    if (process.stdin.isTTY) {
      process.stdout.write('\x1b[?2004h');
    }
    const onContinue = () => {
      if (process.stdin.isTTY) process.stdout.write('\x1b[?2004h');
    };
    process.on('SIGCONT', onContinue);
    return () => {
      process.removeListener('SIGCONT', onContinue);
      if (process.stdin.isTTY) process.stdout.write('\x1b[?2004l');
    };
  }, []);

  usePaste((event) => {
    if (disabled) return;
    pasteInProgress = true;
    const text = safeDisplayText(decodePasteBytes(event.bytes)).replace(/\r\n/g, '\n').trimEnd();
    pasteInProgress = false;
    insertPastedText(text);
  });

  const frame = () => {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    return frames[spinnerTick % frames.length];
  };

  const commandQuery = value.startsWith('/') && !/\s/.test(value.slice(1)) ? value.slice(1) : null;

  const suggestions = useMemo(() => {
    if (commandQuery === null || commands.length === 0) return [];
    return filterSlashCommands(commands, commandQuery, commands.length);
  }, [commandQuery, commands]);

  const suggestionsVisible = suggestions.length > 0;
  useEffect(() => {
    setSelectedCommand(0);
  }, [commandQuery]);

  // @-mention: detect a trailing @token (no whitespace after the @) to attach a file.
  const atQuery = (() => {
    const m = value.match(/(?:^|\s)@([^\s]*)$/);
    return m ? m[1] : null;
  })();
  const fileSuggestions = useMemo(() => {
    if (atQuery === null) return [];
    return filterFiles(atQuery, 12);
  }, [atQuery]);
  const fileSuggestionsVisible = fileSuggestions.length > 0;
  useEffect(() => {
    setSelectedCommand(0);
  }, [atQuery]);

  function applyFileCompletion(index = selectedCommand) {
    const file = fileSuggestions[index];
    if (!file) return;
    const next = value.replace(/(^|\s)@([^\s]*)$/, `$1@${file} `);
    setInputState(next, next.length);
  }

  function applyCommandCompletion(index = selectedCommand) {
    const command = suggestions[index];
    if (!command) return;
    const next = completeCommand(command);
    setInputState(next, next.length);
  }

  useKeyboard((evt) => {
    const name = evt.name;

    // ESC must always propagate to App.tsx for interrupt handling
    if (name === 'escape') {
      return; // Don't preventDefault, don't handle - let App.tsx handle it
    }

    if (disabled || pasteInProgress) return;

    if (name === 'return') {
      evt.preventDefault();
      evt.stopPropagation();
      lastPasteStart = -1;
      lastPasteLen = 0;
      if (suggestionsVisible) {
        applyCommandCompletion();
        return;
      }
      if (fileSuggestionsVisible) {
        applyFileCompletion();
        return;
      }
      const currentValue = valueRef.current;
      const trimmed = currentValue.trim();
      if (trimmed) {
        let expanded = trimmed;
        for (const [placeholder, fullText] of pastedBlocks) {
          expanded = expanded.split(placeholder).join(fullText);
        }
        pastedBlocks.clear();
        onSubmit(expanded);
        setHistory((prev) => [...prev, trimmed]);
        setInputState('', 0);
        setHistoryIdx(-1);
      }
      return;
    }
    if (name === 'tab') {
      evt.preventDefault();
      evt.stopPropagation();
      if (evt.shift && onModeCycle) {
        onModeCycle();
        return;
      }
      if (suggestionsVisible) {
        applyCommandCompletion();
        return;
      }
      if (fileSuggestionsVisible) {
        applyFileCompletion();
        return;
      }
      return;
    }
    if (evt.ctrl && name === 'p') {
      evt.preventDefault();
      const next = valueRef.current.startsWith('/') ? '' : '/';
      setInputState(next, next.length);
      return;
    }
    if (evt.ctrl && name === 'c') {
      evt.preventDefault();
      evt.stopPropagation();
      // Copy selected text or all text
      const currentValue = valueRef.current;
      if (hasActiveSelection()) {
        const start = Math.min(selStartRef.current, selEndRef.current);
        const end = Math.max(selStartRef.current, selEndRef.current);
        writeClipboard(currentValue.slice(start, end));
      } else if (currentValue && currentValue !== 'press Ctrl+C again to exit') {
        writeClipboard(currentValue);
      }
      const isHintText = currentValue === 'press Ctrl+C again to exit';
      if (!currentValue || isHintText) {
        const now = Date.now();
        if (now - lastCtrlCEmpty < 1000) {
          if (onExit) {
            onExit();
          } else {
            process.exit(0);
          }
        } else {
          lastCtrlCEmpty = now;
          setInputState('press Ctrl+C again to exit', 0);
          clearSelection();
          setTimeout(() => {
            if (valueRef.current === 'press Ctrl+C again to exit') setInputState('', 0);
          }, 1500);
        }
      }
      return;
    }
    if (evt.ctrl && name === 'a') {
      evt.preventDefault();
      setSelectionState(0, valueRef.current.length);
      setInputState(valueRef.current, valueRef.current.length);
      return;
    }
    if (evt.ctrl && name === 'z') {
      evt.preventDefault();
      process.stdout.write('\x1b[?2004l');
      process.kill(process.pid, 'SIGTSTP');
      return;
    }
    if (isPasteKey(evt)) {
      evt.preventDefault();
      Promise.allSettled([readClipboardImage(), readClipboard()])
        .then(([imageResult, textResult]) => {
          const imgPath = imageResult.status === 'fulfilled' ? imageResult.value : undefined;
          if (imgPath) {
            insertClipboardImage(imgPath);
            return;
          }
          const text = textResult.status === 'fulfilled' ? textResult.value : undefined;
          insertPastedText(text);
        })
        .catch(() => {});
      return;
    }
    if (name === 'backspace' || name === 'delete') {
      evt.preventDefault();
      const currentValue = valueRef.current;
      const currentCursor = cursorRef.current;
      if (hasActiveSelection()) {
        // Delete selected text
        const start = Math.min(selStartRef.current, selEndRef.current);
        const end = Math.max(selStartRef.current, selEndRef.current);
        setInputState(currentValue.slice(0, start) + currentValue.slice(end), start);
        clearSelection();
        lastPasteStart = -1;
        lastPasteLen = 0;
      } else if (
        currentCursor > 0 &&
        lastPasteStart >= 0 &&
        currentCursor === lastPasteStart + lastPasteLen
      ) {
        setInputState(
          currentValue.slice(0, lastPasteStart) + currentValue.slice(currentCursor),
          lastPasteStart
        );
        lastPasteStart = -1;
        lastPasteLen = 0;
      } else if (currentCursor > 0) {
        lastPasteStart = -1;
        lastPasteLen = 0;
        setInputState(
          currentValue.slice(0, currentCursor - 1) + currentValue.slice(currentCursor),
          currentCursor - 1
        );
      }
      return;
    }
    if (name === 'left') {
      evt.preventDefault();
      const currentCursor = cursorRef.current;
      if (evt.shift) {
        // Shift+Left: extend selection left
        if (selStartRef.current < 0) setSelectionState(currentCursor, currentCursor);
        const newCursor = Math.max(0, currentCursor - 1);
        setInputState(valueRef.current, newCursor);
        setSelectionState(selStartRef.current < 0 ? currentCursor : selStartRef.current, newCursor);
      } else {
        setInputState(valueRef.current, Math.max(0, currentCursor - 1));
        clearSelection();
      }
      return;
    }
    if (name === 'right') {
      evt.preventDefault();
      const currentValue = valueRef.current;
      const currentCursor = cursorRef.current;
      if (evt.shift) {
        // Shift+Right: extend selection right
        if (selStartRef.current < 0) setSelectionState(currentCursor, currentCursor);
        const newCursor = Math.min(currentValue.length, currentCursor + 1);
        setInputState(currentValue, newCursor);
        setSelectionState(selStartRef.current < 0 ? currentCursor : selStartRef.current, newCursor);
      } else {
        setInputState(currentValue, Math.min(currentValue.length, currentCursor + 1));
        clearSelection();
      }
      return;
    }
    if (name === 'home') {
      evt.preventDefault();
      const currentCursor = cursorRef.current;
      if (evt.shift) {
        if (selStartRef.current < 0) setSelectionState(currentCursor, currentCursor);
        setInputState(valueRef.current, 0);
        setSelectionState(selStartRef.current < 0 ? currentCursor : selStartRef.current, 0);
      } else {
        setInputState(valueRef.current, 0);
        clearSelection();
      }
      return;
    }
    if (name === 'end') {
      evt.preventDefault();
      const currentValue = valueRef.current;
      const currentCursor = cursorRef.current;
      if (evt.shift) {
        if (selStartRef.current < 0) setSelectionState(currentCursor, currentCursor);
        setInputState(currentValue, currentValue.length);
        setSelectionState(
          selStartRef.current < 0 ? currentCursor : selStartRef.current,
          currentValue.length
        );
      } else {
        setInputState(currentValue, currentValue.length);
        clearSelection();
      }
      return;
    }
    if (fileSuggestionsVisible && name === 'up') {
      evt.preventDefault();
      evt.stopPropagation();
      setSelectedCommand((prev) => (prev <= 0 ? fileSuggestions.length - 1 : prev - 1));
      return;
    }
    if (fileSuggestionsVisible && name === 'down') {
      evt.preventDefault();
      evt.stopPropagation();
      setSelectedCommand((prev) => (prev + 1) % fileSuggestions.length);
      return;
    }
    if (suggestionsVisible && name === 'up') {
      evt.preventDefault();
      evt.stopPropagation();
      setSelectedCommand((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
      return;
    }
    if (suggestionsVisible && name === 'down') {
      evt.preventDefault();
      evt.stopPropagation();
      setSelectedCommand((prev) => (prev + 1) % suggestions.length);
      return;
    }
    if (!suggestionsVisible && name === 'up') {
      if (history.length === 0 || (historyIdx < 0 && valueRef.current === '')) return;
      evt.preventDefault();
      evt.stopPropagation();
      const nextIdx = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
      const next = history[nextIdx] || '';
      setHistoryIdx(nextIdx);
      setInputState(next, next.length);
      return;
    }
    if (!suggestionsVisible && name === 'down') {
      if (historyIdx < 0) return;
      evt.preventDefault();
      evt.stopPropagation();
      const nextIdx = historyIdx + 1;
      if (nextIdx >= history.length) {
        setHistoryIdx(-1);
        setInputState('', 0);
        return;
      }
      const next = history[nextIdx] || '';
      setHistoryIdx(nextIdx);
      setInputState(next, next.length);
      return;
    }
    if (evt.ctrl || evt.meta) return;
    const printable = evt.sequence && evt.sequence.length === 1 ? evt.sequence : undefined;
    if (printable && printable >= ' ') {
      evt.preventDefault();
      replaceSelectionOrInsert(printable);
      return;
    }
    if (name === 'space' || name === ' ') {
      evt.preventDefault();
      replaceSelectionOrInsert(' ');
      return;
    }
    if (name.length === 1 && !evt.ctrl && !evt.meta) {
      const input = evt.shift ? name.toUpperCase() : name;
      replaceSelectionOrInsert(input);
    }
  });

  // Compute before/cursor/after with selection highlighting
  const hasSelection = selStart >= 0 && selEnd >= 0 && selStart !== selEnd;
  const selFrom = hasSelection ? Math.min(selStart!, selEnd!) : -1;
  const selTo = hasSelection ? Math.max(selStart!, selEnd!) : -1;

  let beforeText = '';
  let selectedText = '';
  let afterText = '';
  if (hasSelection) {
    beforeText = value.slice(0, selFrom);
    selectedText = value.slice(selFrom, selTo);
    afterText = value.slice(selTo);
  } else {
    beforeText = value.slice(0, cursor);
    afterText = value.slice(cursor + 1);
  }
  const cursorChar = value[cursor] || ' ';
  const after = value.slice(cursor + 1);
  const homeDir = (cwd || process.cwd()).replace(/^\/root\//, '~/');

  const barLen = 8;
  const filled = Math.round((contextPct / 100) * barLen);
  const barColor = contextPct > 75 ? theme.error : contextPct > 50 ? theme.warn : theme.ok;
  const ctxBar = Array.from({ length: barLen })
    .map((_, i) => (i < filled ? '█' : '░'))
    .join('');

  if (disabled) {
    return (
      <box flexDirection="column" paddingX={2} backgroundColor={theme.bg} flexShrink={0}>
        <box
          backgroundColor={theme.bgElement}
          paddingX={2}
          paddingTop={1}
          paddingBottom={1}
          minHeight={3}
        >
          <text fg={MODE_COLOR[mode]} attributes={TextAttributes.BOLD}>
            {MODE_LABEL[mode]}
          </text>
          <text fg={theme.textMuted}>
            {'  '}
            {frame()} thinking...
          </text>
          <text fg={theme.textMuted}>{'  '}esc to cancel</text>
        </box>
        <box marginTop={1} paddingX={1}>
          <text fg={theme.text}>{model || 'aurix'}</text>
          <text fg={theme.textMuted}>{' · ctx '}</text>
          <text fg={barColor}>{ctxBar}</text>
          <text fg={theme.textMuted}>{` ${Math.round(contextPct)}%`}</text>
          <text fg={theme.border}>{' · '}</text>
          <text fg={theme.textMuted}>{homeDir}</text>
        </box>
      </box>
    );
  }

  if (home) {
    const boxWidth = Math.min(termWidth - 4, 72);
    return (
      <box flexDirection="column" alignItems="center" backgroundColor={theme.bg}>
        <box
          flexDirection="column"
          border={
            suggestionsVisible || fileSuggestionsVisible ? ['top', 'left', 'right'] : undefined
          }
          borderColor={suggestionsVisible || fileSuggestionsVisible ? theme.border : undefined}
          backgroundColor={theme.bgElement}
          width={boxWidth}
        >
          {suggestionsVisible && (
            <CommandSuggestions suggestions={suggestions} selected={selectedCommand} />
          )}
          {fileSuggestionsVisible && (
            <FileSuggestions files={fileSuggestions} selected={selectedCommand} />
          )}
          <box paddingX={2} paddingTop={1} paddingBottom={1} minHeight={3}>
            {value ? (
              <text fg={theme.text} wrapMode="word">
                <span style={{ fg: theme.text }}>{beforeText}</span>
                {hasSelection ? (
                  <span style={{ bg: theme.cursor, fg: theme.bg }}>{selectedText}</span>
                ) : (
                  <span style={{ bg: theme.cursor, fg: theme.bg }}>{cursorChar}</span>
                )}
                <span style={{ fg: theme.text }}>{afterText}</span>
              </text>
            ) : (
              <text fg={theme.textMuted}>Ask anything...</text>
            )}
          </box>
          <box paddingX={2} paddingBottom={1} flexDirection="row" justifyContent="flex-end">
            <text fg={MODE_COLOR[mode]} attributes={TextAttributes.BOLD}>
              {MODE_LABEL[mode]}
            </text>
            <text fg={theme.textMuted}>{'  '}</text>
            <text fg={theme.text}>{model || 'aurix'}</text>
            <text fg={theme.textMuted}>{' · ctx '}</text>
            <text fg={barColor}>{ctxBar}</text>
            <text fg={theme.textMuted}>{` ${Math.round(contextPct)}%`}</text>
          </box>
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" paddingX={2} backgroundColor={theme.bg} flexShrink={0}>
      <box
        flexDirection="column"
        border={suggestionsVisible || fileSuggestionsVisible ? ['top', 'left', 'right'] : undefined}
        borderColor={suggestionsVisible || fileSuggestionsVisible ? theme.border : undefined}
        backgroundColor={theme.bgElement}
      >
        {suggestionsVisible && (
          <CommandSuggestions suggestions={suggestions} selected={selectedCommand} />
        )}
        {fileSuggestionsVisible && (
          <FileSuggestions files={fileSuggestions} selected={selectedCommand} />
        )}
        <box paddingX={2} paddingTop={1} paddingBottom={1} minHeight={3}>
          {value ? (
            <text fg={theme.text} wrapMode="word">
              <span style={{ fg: theme.text }}>{beforeText}</span>
              {hasSelection ? (
                <span style={{ bg: theme.cursor, fg: theme.bg }}>{selectedText}</span>
              ) : (
                <span style={{ bg: theme.cursor, fg: theme.bg }}>{cursorChar}</span>
              )}
              <span style={{ fg: theme.text }}>{afterText}</span>
            </text>
          ) : (
            <text fg={theme.textMuted}>Ask anything...</text>
          )}
        </box>
      </box>
      <box paddingX={1} marginTop={1} flexDirection="row" justifyContent="space-between">
        <box>
          <text fg={MODE_COLOR[mode]} attributes={TextAttributes.BOLD}>
            {MODE_LABEL[mode]}
          </text>
          <text fg={theme.textMuted}>{'  '}</text>
          <text fg={theme.text}>{model || 'aurix'}</text>
          <text fg={theme.textMuted}>{' · ctx '}</text>
          <text fg={barColor}>{ctxBar}</text>
          <text fg={theme.textMuted}>{` ${Math.round(contextPct)}%`}</text>
        </box>
        <box>
          <text fg={theme.textMuted}>{homeDir}</text>
        </box>
      </box>
      <box paddingX={1}>
        <text fg={theme.textMuted}>To Exit: Type /exit or Double Ctrl+C</text>
      </box>
    </box>
  );
}

function FileSuggestions({ files, selected }: { files: string[]; selected: number }) {
  const start = Math.max(
    0,
    Math.min(
      selected - Math.floor(MAX_VISIBLE_SUGGESTIONS / 2),
      Math.max(0, files.length - MAX_VISIBLE_SUGGESTIONS)
    )
  );
  const visible = files.slice(start, start + MAX_VISIBLE_SUGGESTIONS);

  return (
    <box flexDirection="column" paddingX={1} paddingTop={1} paddingBottom={1}>
      {visible.map((file, offset) => {
        const index = start + offset;
        const isSelected = index === selected;
        return (
          <box key={file}>
            <text
              fg={isSelected ? theme.bg : theme.primary}
              bg={isSelected ? theme.primary : undefined}
            >
              {` @${file} `}
            </text>
          </box>
        );
      })}
      <box>
        <text fg={theme.border}>
          {'─'.repeat(40)} {files.length > visible.length ? `${selected + 1}/${files.length}` : ''}
        </text>
      </box>
    </box>
  );
}

function CommandSuggestions({
  suggestions,
  selected,
}: {
  suggestions: SlashCommand[];
  selected: number;
}) {
  const start = Math.max(
    0,
    Math.min(
      selected - Math.floor(MAX_VISIBLE_SUGGESTIONS / 2),
      Math.max(0, suggestions.length - MAX_VISIBLE_SUGGESTIONS)
    )
  );
  const visible = suggestions.slice(start, start + MAX_VISIBLE_SUGGESTIONS);

  return (
    <box flexDirection="column" paddingX={1} paddingTop={1} paddingBottom={1}>
      {visible.map((command, offset) => {
        const index = start + offset;
        const isSelected = index === selected;
        return (
          <box key={command.name}>
            <text
              fg={isSelected ? theme.bg : theme.primary}
              bg={isSelected ? theme.primary : undefined}
            >
              {` /${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ''} `}
            </text>
            <text fg={theme.textMuted}> {safeDisplayText(command.description)}</text>
          </box>
        );
      })}
      <box>
        <text fg={theme.border}>
          {'─'.repeat(40)}{' '}
          {suggestions.length > visible.length ? `${selected + 1}/${suggestions.length}` : ''}
        </text>
      </box>
    </box>
  );
}
