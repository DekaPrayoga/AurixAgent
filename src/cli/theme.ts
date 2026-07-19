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

  surfaceBase: '#0a0a0a',
  surfacePanel: '#141414',
  surfaceElevated: '#1e1e1e',
  surfaceHover: '#282828',
  surfaceSelected: '#323232',
  textPrimary: '#eeeeee',
  textSecondary: '#cfcfcf',
  textSubtle: '#606060',
  intentInfo: '#56b6c2',
  intentSuccess: '#7fd88f',
  intentWarning: '#f5a742',
  intentDanger: '#e06c75',
  markdownHeading: '#9d7cd8',
  markdownLink: '#56b6c2',
  markdownCode: '#7fd88f',
  markdownQuote: '#f5a742',
  markdownStrong: '#fab283',
  toolPending: '#eeeeee',
  toolRunning: '#f5a742',
  toolSuccess: '#808080',
  toolError: '#e06c75',
  diffAddedBg: '#17351f',
  diffRemovedBg: '#3b1d22',
  diffLineNumber: '#606060',

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

let themeVersion = 0;
export function getThemeVersion(): number {
  return themeVersion;
}

export type ThemeName =
  | 'aurix'
  | 'opencode'
  | 'amber'
  | 'violet'
  | 'mono'
  | 'pink'
  | 'ocean'
  | 'dark'
  | 'green'
  | 'sunset'
  | 'nebula';

export const ALL_THEME_NAMES: ThemeName[] = [
  'aurix',
  'opencode',
  'amber',
  'violet',
  'mono',
  'pink',
  'ocean',
  'dark',
  'green',
  'sunset',
  'nebula',
];

export interface ThemePalette {
  primary: string;
  secondary?: string;
  accent: string;
  cursor: string;
  border: string;
  borderActive: string;
  bgPanel: string;
  bg?: string;
  bgElement?: string;
  text?: string;
  textMuted?: string;
  textBright?: string;
  ok?: string;
  error?: string;
  warn?: string;
  info?: string;
  tool?: string;
  toolDim?: string;
  thinking?: string;
  running?: string;
  diffAdded?: string;
  diffRemoved?: string;
  promptShell?: string;
  promptShellAlt?: string;
}

const themePalettes: Record<ThemeName, ThemePalette> = {
  aurix: {
    primary: '#fab283',
    accent: '#9d7cd8',
    cursor: '#fab283',
    border: '#484848',
    borderActive: '#606060',
    bgPanel: '#141414',
  },
  opencode: {
    primary: '#fab283',
    accent: '#9d7cd8',
    cursor: '#fab283',
    border: '#484848',
    borderActive: '#606060',
    bgPanel: '#141414',
  },
  amber: {
    primary: '#FFB020',
    accent: '#7fd88f',
    cursor: '#FFB020',
    border: '#3A3420',
    borderActive: '#8C7A30',
    bgPanel: '#14140a',
  },
  violet: {
    primary: '#9d7cd8',
    accent: '#fab283',
    cursor: '#9d7cd8',
    border: '#302850',
    borderActive: '#6B5BAE',
    bgPanel: '#140a14',
  },
  mono: {
    primary: '#eeeeee',
    accent: '#808080',
    cursor: '#eeeeee',
    border: '#3c3c3c',
    borderActive: '#606060',
    bgPanel: '#141414',
  },

  // --- NEW THEMES ---

  pink: {
    primary: '#ff6b9d',
    secondary: '#c792ea',
    accent: '#c792ea',
    cursor: '#ff6b9d',
    border: '#4a1942',
    borderActive: '#c74b7a',
    bgPanel: '#1a0a18',
    bg: '#0d0510',
    bgElement: '#2a1025',
    text: '#f0e0ec',
    textMuted: '#9a7090',
    textBright: '#ffffff',
    ok: '#7fdbca',
    error: '#ff5370',
    warn: '#ffc857',
    info: '#89ddff',
    tool: '#ffc857',
    toolDim: '#9a7090',
    thinking: '#c792ea',
    running: '#ffc857',
    promptShell: '#c792ea',
    promptShellAlt: '#89ddff',
  },

  ocean: {
    primary: '#64ffda',
    secondary: '#82aaff',
    accent: '#82aaff',
    cursor: '#64ffda',
    border: '#1a3a52',
    borderActive: '#3d8abf',
    bgPanel: '#0a1929',
    bg: '#060d18',
    bgElement: '#112240',
    text: '#ccd6f6',
    textMuted: '#5a7a9a',
    textBright: '#e6f1ff',
    ok: '#64ffda',
    error: '#ff6b6b',
    warn: '#ffd93d',
    info: '#82aaff',
    tool: '#ffd93d',
    toolDim: '#5a7a9a',
    thinking: '#82aaff',
    running: '#ffd93d',
    promptShell: '#82aaff',
    promptShellAlt: '#64ffda',
  },

  dark: {
    primary: '#c0c0c0',
    secondary: '#909090',
    accent: '#707070',
    cursor: '#e0e0e0',
    border: '#2a2a2a',
    borderActive: '#4a4a4a',
    bgPanel: '#0f0f0f',
    bg: '#050505',
    bgElement: '#1a1a1a',
    text: '#d0d0d0',
    textMuted: '#606060',
    textBright: '#f0f0f0',
    ok: '#70a080',
    error: '#b05050',
    warn: '#b09050',
    info: '#7090b0',
    tool: '#b09050',
    toolDim: '#606060',
    thinking: '#707070',
    running: '#b09050',
    diffAdded: '#70a080',
    diffRemoved: '#b05050',
    promptShell: '#909090',
    promptShellAlt: '#7090b0',
  },

  green: {
    primary: '#00ff41',
    secondary: '#39ff85',
    accent: '#00e676',
    cursor: '#00ff41',
    border: '#0a3a1a',
    borderActive: '#00c853',
    bgPanel: '#0a1a0f',
    bg: '#050f08',
    bgElement: '#122a1a',
    text: '#c8f0d0',
    textMuted: '#4a8a5a',
    textBright: '#e0ffe8',
    ok: '#00ff41',
    error: '#ff5252',
    warn: '#ffab40',
    info: '#40c4ff',
    tool: '#ffab40',
    toolDim: '#4a8a5a',
    thinking: '#00e676',
    running: '#ffab40',
    diffAdded: '#00ff41',
    diffRemoved: '#ff5252',
    promptShell: '#00e676',
    promptShellAlt: '#40c4ff',
  },

  sunset: {
    primary: '#ff6b35',
    secondary: '#ffc857',
    accent: '#f72585',
    cursor: '#ff6b35',
    border: '#3a1a0a',
    borderActive: '#cc5528',
    bgPanel: '#1a0f0a',
    bg: '#0d0805',
    bgElement: '#2a1a10',
    text: '#f0dcc8',
    textMuted: '#9a7a5a',
    textBright: '#ffffff',
    ok: '#7fdb8a',
    error: '#ff5370',
    warn: '#ffc857',
    info: '#82aaff',
    tool: '#ffc857',
    toolDim: '#9a7a5a',
    thinking: '#f72585',
    running: '#ffc857',
    promptShell: '#f72585',
    promptShellAlt: '#ffc857',
  },

  nebula: {
    primary: '#bd93f9',
    secondary: '#ff79c6',
    accent: '#50fa7b',
    cursor: '#bd93f9',
    border: '#2a1a3a',
    borderActive: '#8a5ac8',
    bgPanel: '#1a0f2a',
    bg: '#0a0612',
    bgElement: '#221838',
    text: '#e0d8f0',
    textMuted: '#7a6a9a',
    textBright: '#f8f8f2',
    ok: '#50fa7b',
    error: '#ff5555',
    warn: '#f1fa8c',
    info: '#8be9fd',
    tool: '#f1fa8c',
    toolDim: '#7a6a9a',
    thinking: '#bd93f9',
    running: '#f1fa8c',
    diffAdded: '#50fa7b',
    diffRemoved: '#ff5555',
    promptShell: '#ff79c6',
    promptShellAlt: '#8be9fd',
  },
};

export function applyTheme(config: Pick<AurixConfig, 'themeName' | 'accentColor'>): void {
  const name = (config.themeName || 'aurix') as ThemeName;
  const palette = themePalettes[name] || themePalettes.aurix;

  theme.primary = config.accentColor || palette.primary;
  theme.prompt = theme.primary;
  theme.cursor = palette.cursor;
  theme.accent = palette.accent;
  theme.border = palette.border;
  theme.borderActive = palette.borderActive;
  theme.panel = palette.bgPanel;
  theme.borderAccent = palette.borderActive;

  if (palette.secondary) theme.secondary = palette.secondary;
  if (palette.bg) theme.bg = palette.bg;
  if (palette.bgElement) theme.bgElement = palette.bgElement;
  if (palette.bgPanel) theme.bgPanel = palette.bgPanel;
  if (palette.text) theme.text = palette.text;
  if (palette.textMuted) theme.textMuted = palette.textMuted;
  if (palette.textBright) theme.textBright = palette.textBright;
  if (palette.ok) theme.ok = palette.ok;
  if (palette.error) theme.error = palette.error;
  if (palette.warn) theme.warn = palette.warn;
  if (palette.info) theme.info = palette.info;
  if (palette.tool) theme.tool = palette.tool;
  if (palette.toolDim) theme.toolDim = palette.toolDim;
  if (palette.thinking) theme.thinking = palette.thinking;
  if (palette.running) theme.running = palette.running;
  if (palette.diffAdded) theme.diffAdded = palette.diffAdded;
  if (palette.diffRemoved) theme.diffRemoved = palette.diffRemoved;
  if (palette.promptShell) theme.promptShell = palette.promptShell;
  if (palette.promptShellAlt) theme.promptShellAlt = palette.promptShellAlt;

  theme.navy = theme.bg;
  theme.light = palette.info || theme.info;
  theme.muted = palette.textMuted || theme.textMuted;
  theme.bright = palette.textBright || theme.textBright;
  theme.surfaceBase = theme.bg;
  theme.surfacePanel = theme.bgPanel;
  theme.surfaceElevated = theme.bgElement;
  theme.surfaceHover = theme.bgMenu;
  theme.surfaceSelected = theme.bgSelected;
  theme.textPrimary = theme.text;
  theme.textSecondary = theme.textBright;
  theme.textSubtle = theme.borderActive;
  theme.intentInfo = theme.info;
  theme.intentSuccess = theme.ok;
  theme.intentWarning = theme.warn;
  theme.intentDanger = theme.error;
  theme.markdownHeading = theme.accent;
  theme.markdownLink = theme.info;
  theme.markdownCode = theme.ok;
  theme.markdownQuote = theme.warn;
  theme.markdownStrong = theme.primary;
  theme.toolPending = theme.text;
  theme.toolRunning = theme.running;
  theme.toolSuccess = theme.textMuted;
  theme.toolError = theme.error;
  theme.diffAddedBg = `${theme.diffAdded}33`;
  theme.diffRemovedBg = `${theme.diffRemoved}33`;
  theme.diffLineNumber = theme.textSubtle;
  themeVersion++;
}

export function switchTheme(name: ThemeName, accentColor?: string): void {
  applyTheme({ themeName: name as AurixConfig['themeName'], accentColor });
}

export const box = {
  border: 'rounded' as const,
  glyphs: {
    tl: '╭',
    tr: '╮',
    bl: '╰',
    br: '╯',
    h: '─',
    v: '│',
  },
};

export type BorderStyle = 'rounded' | 'single' | 'double' | 'heavy' | 'ascii' | 'none';

export const BORDER_STYLES: Record<
  BorderStyle,
  { tl: string; tr: string; bl: string; br: string; h: string; v: string }
> = {
  rounded: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  single: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
  double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
  heavy: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
  ascii: { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' },
  none: { tl: ' ', tr: ' ', bl: ' ', br: ' ', h: ' ', v: ' ' },
};

export function setBorderStyle(style: BorderStyle): void {
  const glyphs = BORDER_STYLES[style] || BORDER_STYLES.rounded;
  box.border = style === 'none' ? 'rounded' : (style as any);
  box.glyphs = glyphs;
}
