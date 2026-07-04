const fs = require('fs');

let lite = fs.readFileSync('src/cli/LiteApp.ts', 'utf8');

// The user wants the UI to look exactly like Claude Code:
// ─────────────────────────────────────────────────────────────────────────────────────────────── haikz ──
// [Input here]
//
// 1 tasks (0 done, 1 in progress, 0 open)
//   ◼ Fix System Bugs & Lite UI Cogitated for 46s

const targetHeader = `    console.log(chalk.gray('─'.repeat(100)));
    console.log(\`  \${chalk.bold('tasks')} (0 done, 1 in progress, 0 open)  \${chalk.bold('context')} \${color(pct + '%')} used\`);
    console.log(\`  \${chalk.gray('◼ System Ready')} \\t\\t\\t\\t \${chalk.gray('uptime')} \${Metrics.getUptimeFormatted()}\`);
    console.log(chalk.gray('─'.repeat(100)));

    const userInput = await input({ message: chalk.yellow.bold('aurix >') });`;

const injectHeader = `    const userInput = await input({ message: chalk.cyan.bold('aurix >') });`;

const targetLoop = `    const text = userInput.trim();
    if (!text) continue;

    console.log(); // Spacing after input`;

const injectLoop = `    const text = userInput.trim();
    if (!text) continue;

    // Mimic Claude Code CLI style separator and task info
    const termWidth = process.stdout.columns || 100;
    const nameStr = ' aurix ──';
    const lineLen = Math.max(10, termWidth - nameStr.length);
    console.log(chalk.gray('─'.repeat(lineLen)) + chalk.yellow(nameStr));
    
    // Status info block
    const stats = agent.getContextStats();
    const pct = stats.estimatedPct;
    const color = pct > 75 ? chalk.red : pct > 50 ? chalk.yellow : chalk.green;
    console.log();
    console.log(\`  \${chalk.bold('tasks')} (0 done, 0 in progress, 0 open) \\t\\t \${chalk.bold('context')} \${color(pct + '%')} used\`);
    console.log(\`    \${chalk.gray('◼ System Ready')} \\t\\t\\t\\t \${chalk.gray('uptime')} \${Metrics.getUptimeFormatted()}\`);
    console.log();
`;

lite = lite.replace(targetHeader, injectHeader);
lite = lite.replace(targetLoop, injectLoop);

fs.writeFileSync('src/cli/LiteApp.ts', lite);
console.log('Lite UI patched to match Claude Code style');
