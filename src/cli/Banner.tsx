import React from 'react';
import { TextAttributes } from '@opentui/core';
import { theme } from './theme.js';
import { logoLines, wordmark } from '../utils/ascii-logo.js';

interface BannerProps {
  model: string;
  provider: string;
  version?: string;
  toolCount?: number;
  skillCount?: number;
  researchMode?: string;
  compact?: boolean;
}

export function Banner({ model, provider, version = '0.1.0', toolCount = 0, skillCount = 0, researchMode = 'low', compact = false }: BannerProps) {
  const isDeep = researchMode === 'ultra' || researchMode === 'max' || researchMode === 'xhigh';
  return (
    <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={compact ? 0 : 1} paddingY={1} backgroundColor={theme.bg}>
      <box flexDirection="column" alignItems="center">
        <text fg={theme.primary}>{asciiLogoText()}</text>
      </box>

      <box marginTop={1}>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>AURIX</text>
        <text fg={theme.text}> AGENTIC AI</text>
        <text fg={theme.accent}>{'  ::  '}</text>
        <text fg={theme.textMuted}>terminal autonomy workspace</text>
      </box>

      <box marginTop={1}>
        <text fg={theme.textMuted}>{toolCount} tools</text>
        <text fg={theme.border}>{'  ·  '}</text>
        <text fg={theme.textMuted}>{skillCount} skills</text>
        <text fg={theme.border}>{'  ·  '}</text>
        <text fg={theme.textMuted}>model </text>
        <text fg={theme.text}>{model.slice(0, 22)}</text>
        <text fg={theme.border}>{'  ·  '}</text>
        <text fg={theme.textMuted}>depth </text>
        <text fg={isDeep ? theme.accent : theme.textMuted}>{researchMode}</text>
        <text fg={theme.border}>{'  ·  '}</text>
        <text fg={theme.textMuted}>v{version}</text>
      </box>

      {isDeep && (
        <box marginTop={1}>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>● DEEP RESEARCH ACTIVE</text>
          <text fg={theme.textMuted}> — multi-agent + ultra depth</text>
        </box>
      )}
    </box>
  );
}

function asciiLogoText(): string {
  return logoLines().join('\n');
}
