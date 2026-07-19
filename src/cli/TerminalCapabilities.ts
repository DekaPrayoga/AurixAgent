export interface TerminalCapabilities {
  color: boolean;
  unicode: boolean;
  animation: boolean;
  interactive: boolean;
}

export function detectTerminalCapabilities(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  isTTY = Boolean(process.stdout.isTTY)
): TerminalCapabilities {
  const term = (env.TERM || '').toLowerCase();
  const dumb = term === 'dumb';
  const color = isTTY && !dumb && env.NO_COLOR === undefined && env.FORCE_COLOR !== '0';
  const unicode = !dumb && (
    platform !== 'win32' ||
    Boolean(env.WT_SESSION || env.TERM_PROGRAM || env.ConEmuANSI === 'ON' || env.ANSICON)
  );
  const animation = isTTY && !dumb && env.AURIX_NO_ANIMATION !== '1' && env.CI !== 'true';
  return { color, unicode, animation, interactive: isTTY && !dumb };
}

export function statusGlyphs(capabilities: TerminalCapabilities): {
  success: string;
  error: string;
  running: string;
  tool: string;
} {
  return capabilities.unicode
    ? { success: '✓', error: '✗', running: '✢', tool: '▸' }
    : { success: '[ok]', error: '[error]', running: '*', tool: '>' };
}
