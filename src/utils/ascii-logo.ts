// AURIX ANSI logo — braille art phoenix, teal-to-ocean gradient
// https://github.com/DekaPrayoga/AurixAgent
// logoLines() strips ANSI for OpenTUI React; asciiLogo() keeps colors for stdout

const T = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;

const LINES: string[] = [
  // Padding
  T(80,203,196) + '⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀',
  // Decorative bar
  T(250,178,131) + '⡀⡀⡀⡀⣀⣀⡀⡀⡀⡀⡀⡀⣀⣀⡀⡀⡀⡀⡀⡀⣀⣀⡀⡀⡀⣀⣀⣀⣀⣀⣀⡀⡀⡀⡀⡀⣀⣀⡀⡀⡀⣀⡀⡀⡀⡀⡀⡀⣀⣀',
  // Main art — top row
  T(100,181,190) + '⡀⡀⡀⡀⣾⡿⣿⡀⡀⡀⡀⡀⢸⣿⡀⡀⡀⡀⡀⡀⢸⣿⡀⡀⡀' + T(64,180,180) + '⣿⣿⠛⠛⠛⠛⢿⣿⡄⡀⡀⢸⣿⡀⡀⡀⠹⣿⡄⡀⡀⡀⣼⣿⡀',
  T(80,170,175) + '⡀⡀⡀⣠⣿⡀⣿⣇⡀⡀⡀⡀⢸⣿⡀⡀⡀⡀⡀⡀⢸⣿⡀⡀⡀' + T(52,152,182) + '⣿⣿⡀⡀⡀⡀⡀⣿⣿⡀⡀⢸⣿⡀⡀⡀⡀⠹⣿⡀⡀⣰⣿⠁⡀',
  T(60,155,160) + '⡀⡀⡀⣿⡏⡀⠸⣿⡀⡀⡀⡀⢸⣿⡀⡀⡀⡀⡀⡀⢸⣿⡀⡀⡀' + T(41,128,185) + '⣿⣿⡀⡀⡀⡀⡀⣿⡿⡀⡀⢸⣿⡀⡀⡀⡀⡀⢻⣿⣠⣿⠁⡀⡀',
  T(45,140,148) + '⡀⡀⣸⣿⡀⡀⡀⣿⣧⡀⡀⡀⢸⣿⡀⡀⡀⡀⡀⡀⢸⣿⡀⡀⡀' + T(33,115,170) + '⣿⣿⣶⣶⣶⣶⣿⠟⡀⡀⡀⢸⣿⡀⡀⡀⡀⡀⡀⣿⣿⡃⡀⡀⡀',
  // Ocean blue section
  T(30,100,155) + '⡀⡀⣿⣷⣶⣶⣶⣾⣿⡀⡀⡀⢸⣿⡀⡀⡀⡀⡀⡀⣼⣿⡀⡀⡀' + T(29,130,181) + '⣿⣿⡀⡀⠙⣿⣄⡀⡀⡀⡀⢸⣿⡀⡀⡀⡀⡀⣼⡿⠹⣿⡀⡀⡀',
  T(28,95,145) + '⡀⣼⣿⡀⡀⡀⡀⡀⣿⣷⡀⡀⡀⣿⡆⡀⡀⡀⡀⡀⣿⡿⡀⡀⡀' + T(26,80,165) + '⣿⣿⡀⡀⡀⠹⣿⡄⡀⡀⡀⢸⣿⡀⡀⡀⡀⣼⣿⡀⡀⠹⣿⡀⡀',
  T(26,80,130) + '⣀⣿⠇⡀⡀⡀⡀⡀⠘⣿⡄⡀⡀⠻⣿⣦⣀⣀⣠⣾⣿⠁⡀⡀⡀' + T(24,65,140) + '⣿⣿⡀⡀⡀⡀⠹⣿⡄⡀⡀⢸⣿⡀⡀⡀⣴⣿⠁⡀⡀⡀⢻⣿⡀',
  T(20,50,110) + '⠚⠛⡀⡀⡀⡀⡀⡀⡀⠛⠛⡀⡀⡀⠈⠛⠻⠿⠛⠋⡀⡀⡀⡀⡀⠛⠛⡀⡀⡀⡀⡀⠙⠛⡀⡀⠘⠛⡀⡀⠐⠛⠁⡀⡀⡀⡀⡀⠛⠛',
  // Bottom fade
  T(15,40,95)  + '⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀',
  T(12,30,80)  + '⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀',
  T(10,20,65)  + '⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀',
].map(l => l + '\x1b[0m');

const ANSI_LOGO = LINES.join('\n');

// Plain-text version for OpenTUI React (no ANSI escape codes)
const PLAIN_LINES = LINES.map(l => l.replace(/\x1b\[[0-9;]*m/g, ''));

export function asciiLogo(): string {
  return ANSI_LOGO;
}

export function logoLines(): string[] {
  return PLAIN_LINES;
}

export function aurixLogoMark(): string {
  return '\x1b[38;2;250;178;131m▟▛▜▞\x1b[0m \x1b[38;2;100;169;180mA U R I X\x1b[0m';
}

export function wordmark(): string {
  return 'AURIX AGENTIC AI  ::  terminal autonomy workspace';
}

export function compactLogo(): string {
  return '\x1b[38;2;250;178;131m▟█\x1b[0m \x1b[38;2;100;169;180mAURIX\x1b[0m';
}

export function logoSymbol(): [string, string][] {
  return [['#fab283', 'teal + warm peach phoenix pixel mark']];
}

export function miniLogo(): string {
  return '\x1b[38;2;250;178;131m▸\x1b[0m';
}

export function banner(model: string, provider: string, version: string = '0.1.0'): string {
  const meta = 'provider ' + provider + ' · model ' + model + ' · v' + version;
  return ANSI_LOGO + '\n' + wordmark() + '\n' + meta;
}
