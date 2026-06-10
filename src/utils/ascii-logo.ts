const LOGO_LINES = [
  ' █████╗ ██╗   ██╗██████╗ ██╗██╗  ██╗',
  '██╔══██╗██║   ██║██╔══██╗██║╚██╗██╔╝',
  '███████║██║   ██║██████╔╝██║ ╚███╔╝ ',
  '██╔══██║██║   ██║██╔══██╗██║ ██╔██╗ ',
  '██║  ██║╚██████╔╝██║  ██║██║██╔╝ ██╗',
  '╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝',
];

export function asciiLogo(): string {
  return LOGO_LINES.join('\n');
}

export function logoLines(): string[] {
  return LOGO_LINES;
}

export function aurixLogoMark(): string {
  return asciiLogo();
}

export function wordmark(): string {
  return 'AURIX AGENTIC AI  ::  terminal autonomy workspace';
}

export function compactLogo(): string {
  return '▟█ AURIX';
}

export function logoSymbol(): [string, string][] {
  return [['#fab283', 'warm peach pixel mark']];
}

export function miniLogo(): string {
  return '▸';
}

export function banner(model: string, provider: string, version: string = '0.1.0'): string {
  const meta = `provider ${provider} · model ${model} · v${version}`;
  return [asciiLogo(), '', wordmark(), meta].join('\n');
}
