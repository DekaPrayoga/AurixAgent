import React, { useEffect, useMemo, useState } from 'react';
import { TextAttributes, decodePasteBytes, type TextareaRenderable } from '@opentui/core';
import { useKeyboard, useTerminalDimensions, usePaste } from '@opentui/react';
import { theme } from './theme.js';
import {
  isPasteKey,
  normalizeClipboardText,
  readClipboard,
  readClipboardImage,
  writeClipboard,
} from './Clipboard.js';
import type { SlashCommand } from './commands.js';
import { filterSlashCommands, resolveCommandAction } from './commands.js';
import { filterFiles } from './fileList.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';

interface InputBoxProps {
  onSubmit: (value: string) => void;
  disabled: boolean;
  blocked?: boolean;
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
const EXIT_HINT = 'press Ctrl+C again to exit';

let pasteInProgress = false;
let lastPasteStart = -1;
let lastPasteLen = 0;
let lastCtrlCEmpty = 0;
const pastedBlocks = new Map<string, string>();

export function shouldCompactPaste(text: string): boolean {
  return text.split('\n').length >= 2 || text.length > 200;
}

export function makePastedPlaceholder(index: number): string {
  return `[pasted-${index}]`;
}

export function expandPastedPlaceholders(value: string, blocks: ReadonlyMap<string, string>): string {
  let expanded = value;
  for (const [placeholder, fullText] of blocks) {
    expanded = expanded.split(placeholder).join(fullText);
  }
  return expanded;
}

export function extractCommandQuery(value: string): string | null {
  return value.startsWith('/') && !/\s/.test(value.slice(1)) ? value.slice(1) : null;
}

export function extractAtQuery(value: string): string | null {
  const match = value.match(/(?:^|\s)@([^\s]*)$/);
  return match ? match[1] : null;
}

export function resolveCommandCompletion(
  commands: SlashCommand[],
  value: string,
  selected = 0
): string | null {
  const action = resolveCommandAction(commands, value, selected);
  return action?.type === 'complete' ? action.value : null;
}

export function resolveFileCompletion(
  value: string,
  suggestions: string[],
  selected = 0
): string | null {
  if (extractAtQuery(value) === null) return null;
  const file = suggestions[selected];
  return file ? value.replace(/(^|\s)@([^\s]*)$/, `$1@${file} `) : null;
}

function getEditorText(editor: TextareaRenderable | null): string {
  return editor?.editBuffer?.getText?.() ?? '';
}

function getEditorCursorOffset(editor: TextareaRenderable | null): number {
  if (!editor) return 0;
  const cursor = editor.editBuffer.getCursorPosition();
  return editor.editBuffer.positionToOffset(cursor.row, cursor.col) ?? getEditorText(editor).length;
}

function setEditorText(editor: TextareaRenderable | null, text: string): void {
  editor?.setText(text);
  const end = editor?.editBuffer.offsetToPosition(text.length);
  if (editor && end) editor.setCursor(end.row, end.col);
}

function insertIntoEditor(editor: TextareaRenderable | null, text: string): void {
  editor?.insertText(text);
}

function NativePromptEditor({
  editorRef,
  value,
  disabled,
  onChange,
  onNativeSubmit,
}: {
  editorRef: React.RefObject<TextareaRenderable | null>;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onNativeSubmit: () => void;
}) {
  return (
    <textarea
      ref={editorRef as React.Ref<TextareaRenderable>}
      focused={!disabled}
      initialValue={value}
      placeholder="Ask anything..."
      minHeight={3}
      wrapMode="word"
      backgroundColor={theme.bgElement}
      focusedBackgroundColor={theme.bgElement}
      textColor={theme.text}
      focusedTextColor={theme.text}
      placeholderColor={theme.textMuted}
      cursorColor={theme.cursor}
      selectionBg={theme.cursor}
      selectionFg={theme.bg}
      // Let InputBox keep owning Enter/Tab so slash/file completion and submit semantics stay stable.
      keyBindings={[
        { name: 'return', action: 'submit' },
        { name: 'tab', action: 'submit' },
      ]}
      onContentChange={() => onChange(getEditorText(editorRef.current))}
      onSubmit={onNativeSubmit}
    />
  );
}

export function InputBox({
  onSubmit,
  disabled,
  blocked = false,
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
  const valueRef = React.useRef('');
  const editorRef = React.useRef<TextareaRenderable | null>(null);
  const submitCurrentRef = React.useRef<() => void>(() => {});

  const syncValue = React.useCallback((next: string) => {
    valueRef.current = next;
    setValue(next);
  }, []);

  const setInputState = React.useCallback(
    (nextValue: string, nextCursor = nextValue.length) => {
      syncValue(nextValue);
      const editor = editorRef.current;
      if (!editor) return;
      editor.setText(nextValue);
      const pos = editor.editBuffer.offsetToPosition(Math.max(0, Math.min(nextCursor, nextValue.length)));
      if (pos) editor.setCursor(pos.row, pos.col);
    },
    [syncValue]
  );

  const replaceSelectionOrInsert = React.useCallback(
    (text: string) => {
      insertIntoEditor(editorRef.current, text);
      syncValue(getEditorText(editorRef.current));
    },
    [syncValue]
  );

  const insertPastedText = React.useCallback(
    (rawText?: string) => {
      const clean = normalizeClipboardText(safeDisplayText(rawText || '')).trimEnd();
      if (!clean) return;
      if (shouldCompactPaste(clean)) {
        const placeholder = makePastedPlaceholder(pastedBlocks.size + 1);
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
      lastPasteStart = getEditorCursorOffset(editorRef.current);
      lastPasteLen = summary.length;
      replaceSelectionOrInsert(summary);
    },
    [replaceSelectionOrInsert]
  );

  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [spinnerTick, setSpinnerTick] = useState(0);
  const submittingRef = React.useRef(false);

  useEffect(() => {
    if (!disabled) return;
    const id = setInterval(() => setSpinnerTick((n) => n + 1), 530);
    return () => clearInterval(id);
  }, [disabled]);

  useEffect(() => {
    if (process.stdin.isTTY) process.stdout.write('\x1b[?2004h');
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
    if (disabled || blocked) return;
    const pasteEvent = event as typeof event & { preventDefault?: () => void; stopPropagation?: () => void };
    pasteEvent.preventDefault?.();
    pasteEvent.stopPropagation?.();
    pasteInProgress = true;
    const text = normalizeClipboardText(safeDisplayText(decodePasteBytes(event.bytes))).trimEnd();
    pasteInProgress = false;
    if (text) {
      insertPastedText(text);
      return;
    }
    Promise.allSettled([readClipboardImage(), readClipboard()])
      .then(([imageResult, textResult]) => {
        const imgPath = imageResult.status === 'fulfilled' ? imageResult.value : undefined;
        if (imgPath) {
          insertClipboardImage(imgPath);
          return;
        }
        insertPastedText(textResult.status === 'fulfilled' ? textResult.value : undefined);
      })
      .catch(() => {});
  });

  const frame = () => {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    return frames[spinnerTick % frames.length];
  };

  const commandQuery = extractCommandQuery(value);
  const suggestions = useMemo(() => {
    if (commandQuery === null || commands.length === 0) return [];
    return filterSlashCommands(commands, commandQuery, commands.length);
  }, [commandQuery, commands]);
  const suggestionsVisible = suggestions.length > 0;
  useEffect(() => setSelectedCommand(0), [commandQuery]);

  const atQuery = extractAtQuery(value);
  const fileSuggestions = useMemo(() => {
    if (atQuery === null) return [];
    return filterFiles(atQuery, 12);
  }, [atQuery]);
  const fileSuggestionsVisible = fileSuggestions.length > 0;
  useEffect(() => setSelectedCommand(0), [atQuery]);

  function applyFileCompletion(index = selectedCommand) {
    const currentValue = getEditorText(editorRef.current) || valueRef.current;
    const currentQuery = extractAtQuery(currentValue);
    const currentSuggestions = currentQuery === null ? [] : filterFiles(currentQuery, 12);
    const next = resolveFileCompletion(currentValue, currentSuggestions, index);
    if (!next) return;
    setInputState(next, next.length);
  }

  function applyCommandCompletion(index = selectedCommand) {
    const currentValue = getEditorText(editorRef.current) || valueRef.current;
    const next = resolveCommandCompletion(commands, currentValue, index);
    if (!next) return;
    setInputState(next, next.length);
  }

  const submitCurrent = React.useCallback(() => {
    lastPasteStart = -1;
    lastPasteLen = 0;
    const currentValue = getEditorText(editorRef.current) || valueRef.current;
    const commandCompletion = resolveCommandCompletion(commands, currentValue, selectedCommand);
    if (commandCompletion) {
      setInputState(commandCompletion, commandCompletion.length);
      return;
    }
    const currentAtQuery = extractAtQuery(currentValue);
    if (currentAtQuery !== null) {
      const currentFileSuggestions = filterFiles(currentAtQuery, 12);
      const fileCompletion = resolveFileCompletion(
        currentValue,
        currentFileSuggestions,
        selectedCommand
      );
      if (fileCompletion) {
        setInputState(fileCompletion, fileCompletion.length);
        return;
      }
    }
    const trimmed = currentValue.trim();
    if (!trimmed || submittingRef.current) return;
    submittingRef.current = true;
    queueMicrotask(() => {
      submittingRef.current = false;
    });
    const expanded = expandPastedPlaceholders(trimmed, pastedBlocks);
    pastedBlocks.clear();
    onSubmit(expanded);
    setHistory((prev) => [...prev, trimmed]);
    setInputState('', 0);
    setHistoryIdx(-1);
  }, [commands, onSubmit, selectedCommand, setInputState]);
  submitCurrentRef.current = submitCurrent;

  useKeyboard((evt) => {
    const name = evt.name;
    if (name === 'escape') return;
    if (disabled || blocked || pasteInProgress) return;

    if (name === 'return') {
      evt.preventDefault();
      evt.stopPropagation();
      submitCurrentRef.current();
      return;
    }
    if (name === 'tab') {
      evt.preventDefault();
      evt.stopPropagation();
      if (evt.shift && onModeCycle) return onModeCycle();
      if (suggestionsVisible) return applyCommandCompletion();
      if (fileSuggestionsVisible) return applyFileCompletion();
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
      const editor = editorRef.current;
      const currentValue = getEditorText(editor) || valueRef.current;
      const selected = editor?.getSelectedText() || '';
      if (selected) writeClipboard(selected);
      else if (currentValue && currentValue !== EXIT_HINT) writeClipboard(currentValue);
      const isHintText = currentValue === EXIT_HINT;
      if (!currentValue || isHintText) {
        const now = Date.now();
        if (now - lastCtrlCEmpty < 1000) {
          if (onExit) onExit();
          else process.exit(0);
        } else {
          lastCtrlCEmpty = now;
          setInputState(EXIT_HINT, 0);
          setTimeout(() => {
            if (valueRef.current === EXIT_HINT) setInputState('', 0);
          }, 1500);
        }
      }
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
          if (imgPath) return insertClipboardImage(imgPath);
          insertPastedText(textResult.status === 'fulfilled' ? textResult.value : undefined);
        })
        .catch(() => {});
      return;
    }
    if (name === 'backspace' || name === 'delete') {
      const currentCursor = getEditorCursorOffset(editorRef.current);
      const currentValue = getEditorText(editorRef.current) || valueRef.current;
      if (name === 'backspace' && lastPasteStart >= 0 && currentCursor === lastPasteStart + lastPasteLen) {
        evt.preventDefault();
        setInputState(currentValue.slice(0, lastPasteStart) + currentValue.slice(currentCursor), lastPasteStart);
        lastPasteStart = -1;
        lastPasteLen = 0;
      } else {
        lastPasteStart = -1;
        lastPasteLen = 0;
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
    if (!suggestionsVisible && !fileSuggestionsVisible && name === 'up') {
      if (history.length === 0 || (historyIdx < 0 && valueRef.current === '')) return;
      evt.preventDefault();
      evt.stopPropagation();
      const nextIdx = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
      const next = history[nextIdx] || '';
      setHistoryIdx(nextIdx);
      setInputState(next, next.length);
      return;
    }
    if (!suggestionsVisible && !fileSuggestionsVisible && name === 'down') {
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
    // Printable text, cursor movement, selection, Ctrl+A, undo/redo and native edits are handled by OpenTUI TextareaRenderable.
  });

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
        <box backgroundColor={theme.bgElement} paddingX={2} paddingTop={1} paddingBottom={1} minHeight={3}>
          <text fg={MODE_COLOR[mode]} attributes={TextAttributes.BOLD}>{MODE_LABEL[mode]}</text>
          <text fg={theme.textMuted}>{'  '}{frame()} thinking...</text>
          <text fg={theme.textMuted}>{'  '}esc to cancel</text>
        </box>
        <box marginTop={1} paddingX={1}>
          <text fg={theme.text}>{model || 'aurix'}</text><text fg={theme.textMuted}>{' · ctx '}</text><text fg={barColor}>{ctxBar}</text><text fg={theme.textMuted}>{` ${Math.round(contextPct)}%`}</text><text fg={theme.border}>{' · '}</text><text fg={theme.textMuted}>{homeDir}</text>
        </box>
      </box>
    );
  }

  const editor = (
    <NativePromptEditor
      editorRef={editorRef}
      value={value}
      disabled={disabled || blocked}
      onChange={syncValue}
      onNativeSubmit={() => submitCurrentRef.current()}
    />
  );

  if (home) {
    const boxWidth = Math.max(24, Math.min(termWidth - 4, 72));
    return (
      <box flexDirection="column" alignItems="center" backgroundColor={theme.bg}>
        <box flexDirection="column" border={suggestionsVisible || fileSuggestionsVisible ? ['top', 'left', 'right'] : undefined} borderColor={suggestionsVisible || fileSuggestionsVisible ? theme.border : undefined} backgroundColor={theme.bgElement} width={boxWidth}>
          {suggestionsVisible && (
            <CommandSuggestions
              suggestions={suggestions}
              selected={selectedCommand}
              onSelect={(index) => {
                const action = resolveCommandAction(commands, valueRef.current, index);
                if (!action) return;
                if (action.type === 'submit') {
                  setInputState(action.value, action.value.length);
                  queueMicrotask(() => submitCurrentRef.current());
                  return;
                }
                setInputState(action.value, action.value.length);
              }}
            />
          )}
          {fileSuggestionsVisible && <FileSuggestions files={fileSuggestions} selected={selectedCommand} />}
          <box paddingX={2} paddingTop={1} paddingBottom={1} minHeight={3}>{editor}</box>
          <box paddingX={2} paddingBottom={1} flexDirection="row" justifyContent="flex-end">
            <text fg={MODE_COLOR[mode]} attributes={TextAttributes.BOLD}>{MODE_LABEL[mode]}</text><text fg={theme.textMuted}>{'  '}</text><text fg={theme.text}>{model || 'aurix'}</text><text fg={theme.textMuted}>{' · ctx '}</text><text fg={barColor}>{ctxBar}</text><text fg={theme.textMuted}>{` ${Math.round(contextPct)}%`}</text>
          </box>
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" paddingX={2} backgroundColor={theme.bg} flexShrink={0}>
      <box flexDirection="column" border={suggestionsVisible || fileSuggestionsVisible ? ['top', 'left', 'right'] : undefined} borderColor={suggestionsVisible || fileSuggestionsVisible ? theme.border : undefined} backgroundColor={theme.bgElement}>
        {suggestionsVisible && (
          <CommandSuggestions
            suggestions={suggestions}
            selected={selectedCommand}
            onSelect={(index) => {
              const action = resolveCommandAction(commands, valueRef.current, index);
              if (!action) return;
              if (action.type === 'submit') {
                setInputState(action.value, action.value.length);
                queueMicrotask(() => submitCurrentRef.current());
                return;
              }
              setInputState(action.value, action.value.length);
            }}
          />
        )}
        {fileSuggestionsVisible && <FileSuggestions files={fileSuggestions} selected={selectedCommand} />}
        <box paddingX={2} paddingTop={1} paddingBottom={1} minHeight={3}>{editor}</box>
      </box>
      <box paddingX={1} marginTop={1} flexDirection="row" justifyContent="space-between">
        <box><text fg={MODE_COLOR[mode]} attributes={TextAttributes.BOLD}>{MODE_LABEL[mode]}</text><text fg={theme.textMuted}>{'  '}</text><text fg={theme.text}>{model || 'aurix'}</text><text fg={theme.textMuted}>{' · ctx '}</text><text fg={barColor}>{ctxBar}</text><text fg={theme.textMuted}>{` ${Math.round(contextPct)}%`}</text></box>
        <box><text fg={theme.textMuted}>{homeDir}</text></box>
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
  onSelect,
}: {
  suggestions: SlashCommand[];
  selected: number;
  onSelect: (index: number) => void;
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
          <box
            key={command.name}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              onSelect(index);
            }}
          >
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
