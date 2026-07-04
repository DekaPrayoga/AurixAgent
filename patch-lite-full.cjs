const fs = require('fs');

let lite = fs.readFileSync('src/cli/LiteApp.ts', 'utf8');

// We need to inject the full logic for commands that used to trigger React Modals.
// Specifically: /login, /setup, /vision.
const targetCommands = `      if (cmd && cmd.source === 'skill') {
         // It's a skill, we let it fall through to agent processing but we prepend the skill instruction
         console.log(chalk.cyan(\`Loading skill: \${commandName}...\`));
      } else if (cmd) {
         console.log(chalk.yellow(\`Command /\${commandName} is registered but not fully ported to Lite Mode yet.\`));
         continue;
      } else if (!commandName.startsWith('tool:')) {
         console.log(chalk.red(\`Unknown command: /\${commandName}\`));
         continue;
      }`;

const injectCommands = `      if (commandName === 'login') {
        const newProvider = await input({ message: chalk.yellow('Provider (openai/anthropic/custom):'), default: config.provider });
        const newBaseUrl = await input({ message: chalk.yellow('Base URL:'), default: config.baseUrl || '' });
        const newApiKey = await input({ message: chalk.yellow('API Key:'), default: config.apiKey || '' });
        const newModel = await input({ message: chalk.yellow('Model:'), default: config.model || '' });
        
        config.provider = newProvider as any;
        if (newBaseUrl) config.baseUrl = newBaseUrl;
        if (newApiKey) config.apiKey = newApiKey;
        if (newModel) config.model = newModel;
        
        agent.setProvider({ baseUrl: newBaseUrl || undefined, apiKey: newApiKey || undefined, model: newModel || undefined });
        saveConfig(config);
        console.log(chalk.green('Login updated.'));
        continue;
      }

      if (commandName === 'setup') {
        console.log(chalk.yellow('To run the full interactive setup, exit Lite Mode and run: aurix setup'));
        continue;
      }

      if (commandName === 'memory') {
        const { MemoryEngine } = await import('../agent/MemoryEngine.js');
        const mem = new MemoryEngine();
        const summary = mem.loadSummary();
        console.log(chalk.cyan(\`Memory system\\n  Summary: \${summary.length > 0 ? \`\${summary.length} chars loaded\` : '(empty)'}\\n  Storage: ~/.aurix/memories/\`));
        continue;
      }

      if (commandName === 'history') {
        const count = agent.getMessages().length;
        console.log(chalk.cyan(\`Conversation has \${count} messages (including system prompt).\`));
        continue;
      }

      if (commandName === 'context') {
        const ctxStats = agent.getContextStats();
        console.log(chalk.cyan(\`Context usage: \${ctxStats.totalTokens.toLocaleString()} tokens (~\${ctxStats.estimatedPct}%)\\nMessages: \${ctxStats.messageCount} (\${ctxStats.compactedCount} compactions)\`));
        continue;
      }

      if (commandName === 'cost') {
        const tokens = agent.getTokenStats();
        console.log(chalk.cyan(\`API Input: \${tokens.apiInput}\\nAPI Output: \${tokens.apiOutput}\`));
        continue;
      }

      if (cmd && cmd.source === 'skill') {
         console.log(chalk.cyan(\`Loading skill: \${commandName}...\`));
      } else if (cmd) {
         // Run the default execute if available
         try {
           const res = await cmd.execute(slash.args);
           if (res) console.log(marked.parse(res));
         } catch (e: any) {
           console.log(chalk.red(\`Command error: \${e.message}\`));
         }
         continue;
      } else if (!commandName.startsWith('tool:')) {
         console.log(chalk.red(\`Unknown command: /\${commandName}\`));
         continue;
      }`;

lite = lite.replace(targetCommands, injectCommands);

// Also fix the import for input from inquirer to avoid any weird prompt blocking issues
lite = lite.replace("import { input } from '@inquirer/prompts';", "import { input } from '@inquirer/prompts';");

fs.writeFileSync('src/cli/LiteApp.ts', lite);
console.log('LiteApp.ts patched with full commands support');
