// AURIX ANSI logo — braille phoenix art
// Left half: warm teal (#fab283 palette) | Right half: ocean blue (#2980b9 palette)
// logoLines() strips ANSI for OpenTUI React; asciiLogo() keeps colors

const T = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;

// Each line: first 25 chars teal, last 25 chars ocean
function splitColor(line: string): string {
  const chars = [...line]; // spread to handle multi-byte braille
  const mid = Math.floor(chars.length / 2);
  // Teal phase colors (warm peach → teal)
  const tealColors = [
    [250,178,131], [240,170,125], [180,200,195],
    [150,195,190], [120,185,185], [100,181,190],
    [80,170,175],  [60,155,160],  [45,140,148],
    [30,100,155],  [28,95,145],   [26,80,130],
    [20,50,110],   [15,40,95],    [12,30,80],
    [10,20,65],
  ];
  // Ocean phase colors
  const oceanColors = [
    [64,180,180],  [52,152,182], [41,128,185],
    [33,115,170],  [29,130,181], [26,80,165],
    [24,65,140],   [41,128,185], [41,128,185],
    [26,80,165],   [24,65,140],  [20,50,110],
    [15,40,95],    [12,30,80],   [10,20,65],
    [10,20,65],
  ];
  const lineIdx = ART_LINES.indexOf(line);
  const tc = tealColors[lineIdx] || tealColors[0];
  const oc = oceanColors[lineIdx] || oceanColors[0];
  return T(tc[0],tc[1],tc[2]) + chars.slice(0,mid).join('') + T(oc[0],oc[1],oc[2]) + chars.slice(mid).join('') + '\x1b[0m';
}

const ART_LINES: string[] = [
  '⡀⡀⡀⡀⣀⣀⡀⡀⡀⡀⡀⡀⣀⣀⡀⡀⡀⡀⡀⡀⣀⣀⡀⡀⡀⣀⣀⣀⣀⣀⣀⡀⡀⡀⡀⡀⣀⣀⡀⡀⡀⣀⡀⡀⡀⡀⡀⡀⣀⣀',
  '⡀⡀⡀⡀⣾⡿⣿⡀⡀⡀⡀⡀⢸⣿⡀⡀⡀⡀⡀⡀⢸⣿⡀⡀⡀⣿⣿⠛⠛⠛⠛⢿⣿⡄⡀⡀⢸⣿⡀⡀⡀⠹⣿⡄⡀⡀⡀⣼⣿⡀',
  '⡀⡀⡀⣠⣿⡀⣿⣇⡀⡀⡀⡀⢸⣿⡀⡀⡀⡀⡀⡀⢸⣿⡀⡀⡀⣿⣿⡀⡀⡀⡀⡀⣿⣿⡀⡀⢸⣿⡀⡀⡀⡀⠹⣿⡀⡀⣰⣿⠁⡀',
  '⡀⡀⡀⣿⡏⡀⠸⣿⡀⡀⡀⡀⢸⣿⡀⡀⡀⡀⡀⡀⢸⣿⡀⡀⡀⣿⣿⡀⡀⡀⡀⡀⣿⡿⡀⡀⢸⣿⡀⡀⡀⡀⡀⢻⣿⣠⣿⠁⡀⡀',
  '⡀⡀⣸⣿⡀⡀⡀⣿⣧⡀⡀⡀⢸⣿⡀⡀⡀⡀⡀⡀⢸⣿⡀⡀⡀⣿⣿⣶⣶⣶⣶⣿⠟⡀⡀⡀⢸⣿⡀⡀⡀⡀⡀⡀⣿⣿⡃⡀⡀⡀',
  '⡀⡀⣿⣷⣶⣶⣶⣾⣿⡀⡀⡀⢸⣿⡀⡀⡀⡀⡀⡀⣼⣿⡀⡀⡀⣿⣿⡀⡀⠙⣿⣄⡀⡀⡀⡀⢸⣿⡀⡀⡀⡀⡀⣼⡿⠹⣿⡀⡀⡀',
  '⡀⣼⣿⡀⡀⡀⡀⡀⣿⣷⡀⡀⡀⣿⡆⡀⡀⡀⡀⡀⣿⡿⡀⡀⡀⣿⣿⡀⡀⡀⠹⣿⡄⡀⡀⡀⢸⣿⡀⡀⡀⡀⣼⣿⡀⡀⠹⣿⡀⡀',
  '⣀⣿⠇⡀⡀⡀⡀⡀⠘⣿⡄⡀⡀⠻⣿⣦⣀⣀⣠⣾⣿⠁⡀⡀⡀⣿⣿⡀⡀⡀⡀⠹⣿⡄⡀⡀⢸⣿⡀⡀⡀⣴⣿⠁⡀⡀⡀⢻⣿⡀',
  '⠚⠛⡀⡀⡀⡀⡀⡀⡀⠛⠛⡀⡀⡀⠈⠛⠻⠿⠛⠋⡀⡀⡀⡀⡀⠛⠛⡀⡀⡀⡀⡀⠙⠛⡀⡀⠘⠛⡀⡀⠐⠛⠁⡀⡀⡀⡀⡀⠛⠛',
];

// Colored version for stdout / LiteApp
const ANSI_LOGO = ART_LINES.map(splitColor).join('\n');

// Plain version for OpenTUI React (no ANSI)
const PLAIN_LINES = ART_LINES.slice();

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
  return ANSI_LOGO + '\n' + wordmark() + '\nprovider ' + provider + ' · model ' + model + ' · v' + version;
}
