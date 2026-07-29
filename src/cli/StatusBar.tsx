import React from 'react';
import { getAurixVersion } from '../utils/RuntimeInfo.js';
import { theme } from './theme.js';

interface StatusBarProps {
  model?: string;
  provider?: string;
  tokenCount?: number;
  researchMode?: string;
  version?: string;
  cwd?: string;
}

export function StatusBar({
  model,
  provider,
  tokenCount,
  researchMode,
  version: _version = getAurixVersion(),
  cwd,
}: StatusBarProps) {
  const home = (cwd || process.cwd()).replace(/^\/root\//, '~/');
  const mode = researchMode && researchMode !== 'low' ? researchMode : 'agent';
  const right = [provider, model, typeof tokenCount === 'number' ? `ctx ${tokenCount}%` : '']
    .filter(Boolean)
    .join(' · ');
  return (
    <box paddingX={2} paddingY={0} flexShrink={0} backgroundColor={theme.bg} flexDirection="row" justifyContent="space-between">
      <box flexDirection="row">
        <text fg={theme.primary}>{mode}</text>
        <text fg={theme.textMuted}>  {home}</text>
      </box>
      <text fg={theme.textMuted}>{right}</text>
    </box>
  );
}
