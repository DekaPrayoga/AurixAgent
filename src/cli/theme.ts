import type { AurixConfig } from '../agent/Config.js';

export const theme = {
  primary: '#fab283',
  secondary: '#5c9cf5',
  accent: '#9d7cd8',

  text: '#eeeeee',
  textMuted: '#808080',
  textBright: '#ffffff',
  label: '#808080',

  ok: '#7fd88f',
  error: '#e06c75',
  warn: '#f5a742',
  info: '#56b6c2',

  border: '#484848',
  borderActive: '#606060',
  borderSubtle: '#3c3c3c',
  prompt: '#fab283',
  cursor: '#fab283',

  tool: '#f5a742',
  toolDim: '#808080',
  thinking: '#9d7cd8',
  running: '#f5a742',

  diffAdded: '#7fd88f',
  diffRemoved: '#e06c75',

  bg: '#0a0a0a',
  bgPanel: '#141414',
  bgElement: '#1e1e1e',
  bgMenu: '#282828',
  bgSelected: '#323232',

  promptShell: '#5c9cf5',
  promptShellAlt: '#56b6c2',
  selectionBg: '#323232',

  panel: '#141414',
  panelInner: '#1e1e1e',

  // Legacy aliases for backward compat during migration
  navy: '#0a0a0a',
  light: '#56b6c2',
  muted: '#808080',
  bright: '#ffffff',
  borderAccent: '#606060',
};

export const brand = {
  name: 'AURIX Agent',
  icon: '>',
  prompt: '>',
  welcome: 'Ask anything...',
  goodbye: 'Goodbye!',
  tool: '|',
};

export type Theme = typeof theme;

export function applyTheme(config: Pick<AurixConfig, 'themeName' | 'accentColor'>): void {
  const name = config.themeName || 'aurix';
  const accents: Record<string, { primary: string; accent: string; cursor: string; border: string; borderActive: string; bgPanel: string }> = {
    aurix:    { primary: '#fab283', accent: '#9d7cd8', cursor: '#fab283', border: '#484848', borderActive: '#606060', bgPanel: '#141414' },
    opencode: { primary: '#fab283', accent: '#9d7cd8', cursor: '#fab283', border: '#484848', borderActive: '#606060', bgPanel: '#141414' },
    amber:    { primary: '#FFB020', accent: '#7fd88f', cursor: '#FFB020', border: '#3A3420', borderActive: '#8C7A30', bgPanel: '#14140a' },
    violet:   { primary: '#9d7cd8', accent: '#fab283', cursor: '#9d7cd8', border: '#302850', borderActive: '#6B5BAE', bgPanel: '#140a14' },
    mono:     { primary: '#eeeeee', accent: '#808080', cursor: '#eeeeee', border: '#3c3c3c', borderActive: '#606060', bgPanel: '#141414' },
  };
  const next = accents[name] || accents.aurix;
  theme.primary = config.accentColor || next.primary;
  theme.borderActive = next.borderActive;
  theme.prompt = theme.primary;
  theme.cursor = next.cursor;
  theme.accent = next.accent;
  theme.border = next.border;
  theme.panel = next.bgPanel;
}

export const box = {
  border: 'rounded' as const,
  glyphs: {
    tl: '╭', tr: '╮', bl: '╰', br: '╯',
    h: '─', v: '│',
  },
};
