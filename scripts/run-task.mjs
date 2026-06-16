#!/usr/bin/env node
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = join(LOG_DIR, `task-${timestamp}.log`);

const task = process.argv[2];
if (!task) {
  console.log(`
Usage: node scripts/run-task.mjs "<task description>"

Examples:
  node scripts/run-task.mjs "Go to example.com and fill the signup form"
  node scripts/run-task.mjs "Solve the CAPTCHA on google.com/recaptcha/api2/demo"
  node scripts/run-task.mjs "Navigate to github.com and star the repo"

Options:
  --gui        Show browser window for monitoring
  --proxy=H:P  Use proxy (host:port:user:pass)

Logs saved to: ${LOG_DIR}/
`);
  process.exit(0);
}

const args = process.argv.slice(2);
const useGui = args.includes('--gui');
const proxyArg = args.find(a => a.startsWith('--proxy='));
const taskText = args.filter(a => !a.startsWith('--')).join(' ');

const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(logFile, line + '\n');
};

log(`=== Task: "${taskText}" ===`);
log(`Log file: ${logFile}`);
if (useGui) log('GUI mode: browser window visible');
if (proxyArg) log(`Proxy: ${proxyArg.replace('--proxy=', '')}`);

const { browserTool } = await import('../dist/tools/Browser.js');

if (proxyArg) {
  const proxy = proxyArg.replace('--proxy=', '');
  log(`Setting proxy: ${proxy}`);
  await browserTool.execute({ action: 'set-proxy', value: proxy });
}

if (useGui) {
  await browserTool.execute({ action: 'set-ui', value: 'on' });
}

const { AgentLoop } = await import('../dist/agent/AgentLoop.js');
const { loadConfig } = await import('../dist/agent/Config.js');
const { Registry } = await import('../dist/tools/Registry.js');

const config = loadConfig();
const registry = new Registry(config);
const agent = new AgentLoop(config, registry);

log('Starting agent...');
try {
  for await (const event of agent.run(taskText)) {
    if (event.type === 'text') {
      log(`[AI] ${event.data}`);
    } else if (event.type === 'tool_start') {
      log(`[TOOL] ${event.toolName}(${JSON.stringify(event.toolArgs || {}).substring(0, 100)})`);
    } else if (event.type === 'tool_end') {
      const data = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
      log(`[RESULT] ${data.substring(0, 200)}`);
    } else if (event.type === 'error') {
      log(`[ERROR] ${event.data}`);
    }
  }
  log('=== Task complete ===');
} catch (e) {
  log(`[FATAL] ${e.message}`);
  process.exit(1);
}
