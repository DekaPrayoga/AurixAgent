// AURIX compact ANSI logo — phoenix wing + flame in brand teal-to-orange
// https://github.com/DekaPrayoga/AurixAgent
const ANSI_LOGO: string =
  '\x1b[38;2;80;155;172m   ⣴⣶⣶⣶⣦⣄   \x1b[38;2;100;169;180m⣠⣶⣶⣶⣶⣤⡀   \x1b[0m\n' +
  '\x1b[38;2;60;141;156m  ⣿⣿⣿⣿⣿⣿⣿  \x1b[38;2;100;169;180m⣿⣿⣿⣿⣿⣿⣿⣿  \x1b[38;2;250;178;131m▟▛▜▞ ▝ ▚▘▟▛▜▞\x1b[0m\n' +
  '\x1b[38;2;40;120;140m ⣿⣿⣷⣶⣦⣤⣀⣀ \x1b[38;2;80;155;172m⣿⣿⣿⣿⣿⣿⣿⣶ \x1b[38;2;250;178;131m ▚ ▝ ▞ ▘ ▙\x1b[0m\n' +
  '\x1b[38;2;237;150;90m▀▀▀▀▀▀▀▀▀▀▀▀▀\x1b[38;2;234;126;56m▀▀▀▀▀▀▀▀▀▀▀▀▀▀\x1b[0m\n' +
  '\x1b[38;2;250;178;131m  ▟▛▜▞ \x1b[38;2;100;169;180mA U R I X\x1b[0m  \x1b[38;2;250;178;131m▟▛▜▞\x1b[0m\n';

export function asciiLogo(): string {
  return ANSI_LOGO;
}

export function logoLines(): string[] {
  return ANSI_LOGO.split('\n');
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
