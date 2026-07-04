import { input } from '@inquirer/prompts';
import { marked } from 'marked';
import markedTerminal from 'marked-terminal';
import chalk from 'chalk';
import ora from 'ora';
import { AgentLoop } from '../agent/AgentLoop.js';
import { ToolRegistry } from '../tools/Registry.js';
import type { AurixConfig } from '../agent/Config.js';
import { asciiLogo } from '../utils/ascii-logo.js';

// @ts-ignore
const TerminalRenderer = markedTerminal;
// @ts-ignore
marked.setOptions({
  renderer: new TerminalRenderer({
    heading: chalk.cyan.bold,
    code: chalk.yellow,
    blockquote: chalk.gray.italic,
    html: chalk.gray,
  }),
});

export async function runLiteApp(config: AurixConfig, registry: ToolRegistry) {
  const agent = new AgentLoop(config, registry);

  console.clear();
  console.log(asciiLogo());
  console.log(chalk.dim('AURIX Agent  ::  terminal autonomy workspace'));
  console.log(chalk.gray('provider ' + config.provider + ' · model ' + config.model));
  console.log();
  console.log(chalk.dim('Type /help for commands. Ctrl+C to exit.'));
  console.log();

  while (true) {
    const userInput = await input({ message: chalk.cyan.bold('aurix >') });
    const text = userInput.trim();
    if (!text) continue;

    if (text === '/exit' || text === '/quit' || text === '/q') {
      console.log(chalk.dim('Session ended.'));
      process.exit(0);
    }

    if (text === '/clear') {
      agent.clearHistory();
      console.clear();
      console.log(chalk.green('Transcript cleared.'));
      continue;
    }

    if (text === '/help') {
      console.log(chalk.cyan.bold('AURIX Agent — Lite Mode\n'));
      console.log('  /exit, /quit, /q     Exit session');
      console.log('  /clear               Clear transcript');
      console.log('  /help                Show this help');
      console.log();
      console.log(chalk.dim('Anything else is sent to the agent.'));
      continue;
    }

    const spinner = ora({ text: chalk.yellow('Thinking...'), color: 'yellow' }).start();

    try {
      const stream = agent.run(text);
      for await (const event of stream) {
        if (event.type === 'text') {
          spinner.text = event.data;
        } else if (event.type === 'tool_start') {
          spinner.text = chalk.dim('⚙ ' + event.toolName + '...');
        } else if (event.type === 'tool_end') {
          spinner.text = chalk.yellow('Thinking...');
        } else if (event.type === 'error') {
          spinner.stop();
          console.log(chalk.red.bold('\n✗ Error: ') + chalk.red(event.data));
          spinner.start(chalk.yellow('Thinking...'));
        } else if (event.type === 'done') {
          spinner.stop();
          console.log('\n' + marked.parse(event.data));
          console.log();
        }
      }
    } catch (e: any) {
      spinner.fail(chalk.red('Failed: ' + e.message));
    }
  }
}
