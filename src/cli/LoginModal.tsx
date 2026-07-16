import React, { useState, useEffect } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions, usePaste } from '@opentui/react';
import { isPasteKey, readClipboard } from './Clipboard.js';
import { theme } from './theme.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';

interface LoginModalProps {
  currentBaseUrl?: string;
  currentModel?: string;
  currentApiStyle?: string;
  onSubmit: (baseUrl: string, apiKey: string, model?: string, apiStyle?: string) => void;
  onCancel: () => void;
}

export function LoginModal({
  currentBaseUrl,
  currentModel,
  currentApiStyle,
  onSubmit,
  onCancel,
}: LoginModalProps) {
  const [step, setStep] = useState(0);
  const [baseUrl, setBaseUrl] = useState(currentBaseUrl || '');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(currentModel || '');
  const [apiStyle, setApiStyle] = useState(currentApiStyle || '');
  const [cursor, setCursor] = useState(0);
  const { width: termWidth, height: termHeight } = useTerminalDimensions();

  const fields = [
    { label: 'Base URL', hint: 'https://api.openai.com/v1', value: baseUrl, setter: setBaseUrl },
    {
      label: 'API Key (optional)',
      hint: 'sk-... or leave blank',
      value: apiKey,
      setter: setApiKey,
      masked: true,
    },
    { label: 'Model (optional)', hint: 'gpt-4o', value: model, setter: setModel },
    {
      label: 'API Style (optional)',
      hint: '1 for openai, 2 for anthropic',
      value: apiStyle,
      setter: setApiStyle,
    },
  ];

  const current = fields[step];
  const stepRef = React.useRef(step);
  const cursorRef = React.useRef(cursor);
  const fieldSetters = [setBaseUrl, setApiKey, setModel, setApiStyle];

  useEffect(() => {
    stepRef.current = step;
    cursorRef.current = current.value.length;
    setCursor(current.value.length);
  }, [step]);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  const insertText = (rawText?: string) => {
    const text = safeDisplayText(rawText || '')
      .replace(/\r\n/g, '\n')
      .trimEnd();
    if (!text) return;
    const insertAt = cursorRef.current;
    const setter = fieldSetters[stepRef.current];
    setter((prev: string) => prev.slice(0, insertAt) + text + prev.slice(insertAt));
    cursorRef.current = insertAt + text.length;
    setCursor(insertAt + text.length);
  };

  usePaste((event) => {
    insertText(new TextDecoder().decode(event.bytes));
  });

  useKeyboard((evt) => {
    const name = evt.name;

    if (name === 'escape') {
      evt.preventDefault();
      onCancel();
      return;
    }

    if (name === 'tab') {
      evt.preventDefault();
      if (evt.shift) {
        setStep((prev) => (prev <= 0 ? fields.length - 1 : prev - 1));
      } else {
        setStep((prev) => (prev + 1) % fields.length);
      }
      return;
    }

    if (name === 'return') {
      evt.preventDefault();
      if (step < fields.length - 1) {
        setStep((prev) => prev + 1);
      } else {
        let finalApiStyle = apiStyle.trim().toLowerCase();
        if (finalApiStyle === '1') finalApiStyle = 'openai';
        if (finalApiStyle === '2') finalApiStyle = 'anthropic';
        onSubmit(baseUrl, apiKey, model || undefined, finalApiStyle || undefined);
      }
      return;
    }

    if (isPasteKey(evt)) {
      evt.preventDefault();
      readClipboard()
        .then(insertText)
        .catch(() => {});
      return;
    }

    if (name === 'backspace') {
      evt.preventDefault();
      if (cursor > 0) {
        const val = current.value;
        current.setter(val.slice(0, cursor - 1) + val.slice(cursor));
        setCursor((prev) => prev - 1);
      }
      return;
    }

    if (name === 'left') {
      evt.preventDefault();
      setCursor((prev) => Math.max(0, prev - 1));
      return;
    }

    if (name === 'right') {
      evt.preventDefault();
      setCursor((prev) => Math.min(current.value.length, prev + 1));
      return;
    }

    if (name === 'home') {
      evt.preventDefault();
      setCursor(0);
      return;
    }

    if (name === 'end') {
      evt.preventDefault();
      setCursor(current.value.length);
      return;
    }

    if (evt.ctrl && name === 'a') {
      evt.preventDefault();
      setCursor(0);
      return;
    }

    if (evt.ctrl && name === 'e') {
      evt.preventDefault();
      setCursor(current.value.length);
      return;
    }

    if (name === 'space' || name === ' ') {
      evt.preventDefault();
      const val = current.value;
      current.setter(val.slice(0, cursor) + ' ' + val.slice(cursor));
      setCursor((prev) => prev + 1);
      return;
    }

    if (evt.name.length === 1 && !evt.ctrl && !evt.meta) {
      evt.preventDefault();
      const val = current.value;
      current.setter(val.slice(0, cursor) + evt.name + val.slice(cursor));
      setCursor((prev) => prev + 1);
    }
  });

  const modalWidth = Math.min(60, termWidth - 8);
  const modalTop = Math.max(2, Math.floor(termHeight / 3));

  const displayValue = (val: string, masked: boolean) => {
    if (masked && val.length > 0) return '●'.repeat(val.length);
    return val;
  };

  const renderInput = (val: string, masked: boolean) => {
    const shown = displayValue(val, masked);
    const before = shown.slice(0, cursor);
    const after = shown.slice(cursor);
    return (
      <box flexDirection="row">
        <text fg={theme.text}>{before}</text>
        <text fg={theme.cursor} attributes={TextAttributes.BOLD}>
          │
        </text>
        <text fg={theme.text}>{after || ' '}</text>
      </box>
    );
  };

  return (
    <box
      flexDirection="column"
      position="absolute"
      top={modalTop}
      left={Math.floor((termWidth - modalWidth) / 2)}
      width={modalWidth}
      backgroundColor={theme.bgPanel}
      border={['top', 'bottom', 'left', 'right']}
      borderColor={theme.borderActive}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
    >
      <text fg={theme.primary} attributes={TextAttributes.BOLD}>
        Manually enter API Key
      </text>
      <box height={1} />

      {fields.map((field, idx) => {
        const isActive = idx === step;
        const hasValue = field.value.length > 0;
        return (
          <box key={idx} flexDirection="column" marginBottom={1}>
            <text
              fg={isActive ? theme.primary : theme.textMuted}
              attributes={isActive ? TextAttributes.BOLD : TextAttributes.NONE}
            >
              {field.label}
            </text>
            <box
              backgroundColor={theme.bgElement}
              paddingLeft={1}
              paddingRight={1}
              paddingTop={1}
              paddingBottom={1}
              marginTop={1}
              border={isActive ? ['top', 'bottom', 'left', 'right'] : undefined}
              borderColor={isActive ? theme.primary : undefined}
            >
              {isActive ? (
                renderInput(field.value, !!field.masked)
              ) : (
                <text fg={hasValue ? theme.text : theme.textMuted}>
                  {hasValue ? displayValue(field.value, !!field.masked) : field.hint}
                </text>
              )}
            </box>
          </box>
        );
      })}

      <box height={1} />
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>tab next field</text>
        <text fg={theme.textMuted}>enter submit · esc cancel</text>
      </box>
    </box>
  );
}
