import { input } from '@inquirer/prompts';
import { marked } from 'marked';
import markedTerminal from 'marked-terminal';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { AgentLoop } from '../agent/AgentLoop.js';
import { ToolRegistry } from '../tools/Registry.js';
import type { AurixConfig } from '../agent/Config.js';
import { saveConfig, CONFIG_PATH } from '../agent/Config.js';
import { createSlashCommands, findCommand, parseSlash, formatCommandHelp } from './commands.js';
import { loadTodos as loadTodosFromFile, addTodo as addTodoToFile, completeTodo as completeTodoInFile, getTodoStats } from '../utils/TodoManager.js';
import { mcpManager } from '../mcp/McpRegistry.js';
import { loadSkillsFromDir } from '../skills/SkillRegistry.js';
import { Metrics } from '../agent/Metrics.js';

// Suppress type errors for markedTerminal by not calling it directly in a type-checked context if it fails.
// @ts-ignore
const TerminalRenderer = markedTerminal;
// @ts-ignore
marked.setOptions({ renderer: new TerminalRenderer({
  heading: chalk.cyan.bold,
  code: chalk.yellow,
  blockquote: chalk.gray.italic,
  html: chalk.gray
}) });

export async function runLiteApp(config: AurixConfig, registry: ToolRegistry) {
  let researchMode = config.researchMode || 'low';
  let planMode = 'normal';
  let sessionName = 'New session';
  let sessionRules: string[] = [];
  let sessionGoal: string | null = null;
  const agent = new AgentLoop(config, registry);
  
  const root = process.env.AURIX_HOME || process.cwd();
  const skills = loadSkillsFromDir(path.join(root, 'skills'));
  const commands = createSlashCommands({ 
    toolCount: registry.list().length, 
    skillCount: skills.length, 
    registry 
  });

  console.clear();
  console.log(chalk.cyan.bold('AURIX Lite (v3.0.0-lite)'));
  console.log(chalk.gray('Type /help for commands. Use standard mouse selection for copy/paste.'));

  while (true) {
    // Print the context usage block like Claude Code does before the prompt
    const stats = agent.getContextStats();
    const tokenStats = agent.getTokenStats();
    const pct = stats.estimatedPct;
    const color = pct > 75 ? chalk.red : pct > 50 ? chalk.yellow : chalk.green;
    const userInput = await input({ message: chalk.cyan.bold('aurix >') });
    const text = userInput.trim();
    if (!text) continue;

    // Mimic Claude Code CLI style separator and task info
    const termWidth = process.stdout.columns || 100;
    const nameStr = ' aurix ──';
    const lineLen = Math.max(10, termWidth - nameStr.length);
    console.log(chalk.gray('─'.repeat(lineLen)) + chalk.yellow(nameStr));
    
    // Status info block
    // variables removed to prevent redeclaration
    console.log();
    console.log(`  ${chalk.bold('tasks')} (0 done, 0 in progress, 0 open) \t\t ${chalk.bold('context')} ${color(pct + '%')} used`);
    console.log(`    ${chalk.gray('◼ System Ready')} \t\t\t\t ${chalk.gray('uptime')} ${Metrics.getUptimeFormatted()}`);
    console.log();


    const slash = parseSlash(text);
    if (slash) {
      const commandName = slash.name;
      
      if (commandName === 'exit' || commandName === 'quit' || commandName === 'q') {
        console.log(chalk.gray('Session ended.'));
        process.exit(0);
      }

      if (commandName === 'clear') {
        agent.clearHistory();
        console.clear();
        console.log(chalk.green('Transcript cleared.'));
        continue;
      }

      if (commandName === 'help') {
        console.log(chalk.cyan(`AURIX Agent Commands\n\n${formatCommandHelp(commands)}`));
        continue;
      }

      if (commandName === 'depth' || commandName === 'effort') {
        const VALID_DEPTHS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
        if (!slash.args) {
          console.log(`Current depth: ${researchMode}\nUsage: /depth <mode>\nModes: ${VALID_DEPTHS.join(', ')}`);
          continue;
        }
        const mode = slash.args.toLowerCase();
        if (!VALID_DEPTHS.includes(mode)) {
          console.log(chalk.red(`Invalid depth. Valid: ${VALID_DEPTHS.join(', ')}`));
          continue;
        }
        researchMode = mode as any;
        config.researchMode = mode as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
        console.log(chalk.green(`Research depth set to: ${mode}`));
        continue;
      }

      if (commandName === 'status') {
        console.log(`Model: ${agent.getModel()}\nProvider: ${agent.getProviderName()}\nResearch: ${researchMode}\nMulti-agent: ${agent.isMultiAgent() ? 'ON' : 'OFF'}\nTools: ${registry.list().length}`);
        continue;
      }

      if (commandName === 'model') {
        if (!slash.args) {
          console.log(`Current model: ${agent.getModel()}\nProvider: ${agent.getProviderName()}\nBase URL: ${config.baseUrl || '(default)'}\n\nUsage: /model <model-id>`);
          continue;
        }
        const newModel = slash.args.trim();
        agent.setProvider({ model: newModel });
        config.model = newModel;
        saveConfig(config);
        console.log(chalk.green(`Model switched to: ${newModel}`));
        continue;
      }

      // If it's an unhandled command in Lite mode, fallback to treating it as normal text or warning
      const cmd = findCommand(commands, commandName);
      if (cmd && cmd.source === 'skill') {
         // It's a skill, we let it fall through to agent processing but we prepend the skill instruction
         console.log(chalk.cyan(`Loading skill: ${commandName}...`));
      } else if (cmd) {
         console.log(chalk.yellow(`Command /${commandName} is registered but not fully ported to Lite Mode yet.`));
         continue;
      } else if (!commandName.startsWith('tool:')) {
         console.log(chalk.red(`Unknown command: /${commandName}`));
         continue;
      }
    }

    const spinner = ora({ text: 'Thinking...', color: 'yellow' }).start();

    try {
      const stream = agent.run(text);
      for await (const event of stream) {
        if (event.type === 'text') {
          spinner.text = event.data;
        } else if (event.type === 'tool_start') {
          spinner.text = `Running tool: ${event.toolName}...`;
        } else if (event.type === 'tool_end') {
          spinner.text = 'Thinking...';
        } else if (event.type === 'error') {
          spinner.stop();
          console.log(chalk.red.bold('\\nError: ') + event.data);
          spinner.start('Thinking...');
        } else if (event.type === 'done') {
          spinner.stop();
          console.log('\\n' + marked.parse(event.data));
          break;
        }
      }
    } catch (e: any) {
      spinner.fail(chalk.red('Failed: ' + e.message));
    }
  }
}
