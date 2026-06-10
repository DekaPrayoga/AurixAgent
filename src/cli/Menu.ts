import readline from 'readline';
import chalk from 'chalk';

const teal = chalk.hex('#00897B');
const orange = chalk.hex('#FF8A3D');
const dim = chalk.hex('#647184');
const light = chalk.hex('#4DD0E1');
const green = chalk.hex('#4CAF50');
const red = chalk.hex('#FF5252');

export interface MenuItem {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  checked?: boolean;
}

export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

export function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

export function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim()));
  });
}

export function maskedPrompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => {
    const stdin = process.stdin;
    let buf = '';

    process.stdout.write(question);

    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    function onData(ch: string) {
      const c = ch.charCodeAt(0);

      if (c === 13 || c === 10) {
        stdin.removeListener('data', onData);
        if (stdin.isTTY && !wasRaw) stdin.setRawMode(false);
        process.stdout.write('\n');
        resolve(buf);
        return;
      }

      if (c === 127 || c === 8) {
        if (buf.length > 0) {
          buf = buf.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }

      if (c === 3) process.exit(0);

      buf += ch;
      process.stdout.write('*');
    }

    stdin.on('data', onData);
  });
}

export async function showMenu(
  rl: readline.Interface,
  title: string,
  items: MenuItem[],
  options?: { multi?: boolean; allowSkip?: boolean }
): Promise<string | string[]> {
  console.log(`\n  ${orange(title)}`);
  console.log(`  ${dim('='.repeat(title.length + 4))}\n`);

  items.forEach((item, i) => {
    const num = teal(String(i + 1).padStart(2));
    const check = item.checked ? green('[x] ') : dim('[ ] ');
    const label = item.disabled ? dim(item.label + ' (unavailable)') : light(item.label);
    const desc = item.description ? dim(' -- ' + item.description) : '';

    if (options?.multi) {
      console.log(`  ${num} ${check}${label}${desc}`);
    } else {
      console.log(`  ${num} ${label}${desc}`);
    }
  });

  if (options?.allowSkip) {
    console.log(`\n  ${teal(' 0')} ${dim('Skip for now')}`);
  }

  console.log();

  if (options?.multi) {
    const answer = await prompt(rl, `  ${light('Select')} ${dim('(comma-separated, e.g. 1,3,5)')}: `);

    if (answer === '0' && options?.allowSkip) return [];

    const indices = answer.split(',').map(s => parseInt(s.trim()) - 1).filter(i => i >= 0 && i < items.length);
    return indices.map(i => items[i].id);
  }

  const answer = await prompt(rl, `  ${light('Choose')} ${dim('[1-' + items.length + ']')}: `);

  if (answer === '0' && options?.allowSkip) return '__skip__';

  const idx = parseInt(answer) - 1;
  if (idx >= 0 && idx < items.length && !items[idx].disabled) {
    return items[idx].id;
  }

  return items[0].id;
}

export async function confirm(rl: readline.Interface, question: string, defaultYes: boolean = true): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await prompt(rl, `  ${light(question)} ${dim(hint)}: `);

  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

export function header(text: string): void {
  const line = ':'.repeat(text.length + 8);
  console.log(`\n  ${dim(line)}`);
  console.log(`  ${dim(':::')} ${orange(text)} ${dim(':::')}`);
  console.log(`  ${dim(line)}\n`);
}

export function success(msg: string): void {
  console.log(`  ${green('>')} ${msg}`);
}

export function warning(msg: string): void {
  console.log(`  ${orange('>')} ${msg}`);
}

export function error(msg: string): void {
  console.log(`  ${red('>')} ${msg}`);
}

export function info(msg: string): void {
  console.log(`  ${teal('>')} ${msg}`);
}
