import React, { useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { theme } from './theme.js';
import type { PermissionReply, ToolPermissionRequest } from '../tools/Registry.js';

interface PermissionPromptProps {
  request: ToolPermissionRequest;
  onResolve: (reply: PermissionReply) => void;
}

const options: { id: PermissionReply; label: string; hint: string }[] = [
  { id: 'once', label: 'Yes, allow once', hint: 'y' },
  { id: 'always', label: 'Always allow', hint: 'a' },
  { id: 'deny', label: 'Deny', hint: 'n' },
];

export function PermissionPrompt({ request, onResolve }: PermissionPromptProps) {
  const destructiveDelete =
    request.toolName === 'delete_file' || request.toolName === 'delete_folder';
  const promptOptions = destructiveDelete
    ? [
        { id: 'deny' as PermissionReply, label: 'Deny', hint: 'esc/n' },
        { id: 'once' as PermissionReply, label: 'Allow delete', hint: 'enter/y' },
      ]
    : options;
  const [active, setActive] = useState(0);

  useKeyboard((evt) => {
    const name = evt.name;

    if (name === 'left' || name === 'up') {
      evt.preventDefault();
      evt.stopPropagation();
      setActive((prev) => (prev <= 0 ? promptOptions.length - 1 : prev - 1));
      return;
    }

    if (name === 'right' || name === 'down' || name === 'tab') {
      evt.preventDefault();
      evt.stopPropagation();
      setActive((prev) => (prev + 1) % promptOptions.length);
      return;
    }

    if (name === 'return') {
      evt.preventDefault();
      evt.stopPropagation();
      onResolve(promptOptions[active].id);
      return;
    }

    if (name === 'escape' || name === 'n') {
      evt.preventDefault();
      evt.stopPropagation();
      onResolve('deny');
      return;
    }

    if (name === 'y') {
      evt.preventDefault();
      evt.stopPropagation();
      onResolve('once');
    }
    if (name === 'a' && !destructiveDelete) {
      evt.preventDefault();
      evt.stopPropagation();
      onResolve('always');
    }
  });

  const riskColor =
    request.risk === 'read'
      ? theme.ok
      : request.risk === 'write'
        ? theme.warn
        : request.risk === 'execute'
          ? theme.secondary
          : theme.error;

  return (
    <box flexDirection="column" paddingX={2} marginY={1}>
      <box
        flexDirection="column"
        backgroundColor={theme.bgElement}
        border={['top', 'bottom', 'left', 'right']}
        borderColor={theme.borderActive}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <box flexDirection="row">
          <text fg={theme.warn} attributes={TextAttributes.BOLD}>
            permission
          </text>
          <text fg={theme.textMuted}>{' · '}</text>
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            {request.toolName}
          </text>
          <text fg={riskColor}> [{request.risk}]</text>
        </box>

        <box marginTop={1}>
          <text fg={theme.text} wrapMode="word">
            {request.summary || request.description}
          </text>
        </box>

        <box flexDirection="column" marginTop={1}>
          {promptOptions.map((option, index) => (
            <box key={option.id} flexDirection="row" marginTop={index > 0 ? 1 : 0}>
              <text fg={index === active ? theme.primary : theme.text} attributes={index === active ? TextAttributes.BOLD : TextAttributes.NONE}>
                {`${index === active ? '>' : ' '} ${option.label}`}
              </text>
              <text fg={theme.text}>{`  ${option.hint}`}</text>
            </box>
          ))}
        </box>

        <box marginTop={1}>
          <text fg={theme.text}>arrows/tab select · enter runs selected action · esc/n deny</text>
        </box>
      </box>
    </box>
  );
}
