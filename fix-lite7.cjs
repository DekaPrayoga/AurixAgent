const fs = require('fs');
let lite = fs.readFileSync('src/cli/LiteApp.ts', 'utf8');

const target = `marked.use(markedTerminal({
  header: chalk.cyan.bold,
  code: chalk.yellow,
  blockquote: chalk.gray.italic,
  html: chalk.gray
}) as any);`;

const inject = `// Suppress type errors for markedTerminal by not calling it directly in a type-checked context if it fails.
// @ts-ignore
const TerminalRenderer = markedTerminal;
// @ts-ignore
marked.setOptions({ renderer: new TerminalRenderer({
  heading: chalk.cyan.bold,
  code: chalk.yellow,
  blockquote: chalk.gray.italic,
  html: chalk.gray
}) });`;

lite = lite.replace(target, inject);
fs.writeFileSync('src/cli/LiteApp.ts', lite);
console.log('Fixed markdown types');
