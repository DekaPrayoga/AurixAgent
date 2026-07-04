const fs = require('fs');
let lite = fs.readFileSync('src/cli/LiteApp.ts', 'utf8');

// Fix redeclared block-scoped variables
lite = lite.replace(/const stats = agent\.getContextStats\(\);\n    const pct = stats\.estimatedPct;\n    const color = pct > 75 \? chalk\.red : pct > 50 \? chalk\.yellow : chalk\.green;/g, 
  "// variables removed to prevent redeclaration");

// Re-inject once properly before the log
const properHeader = `
    const ctxStats = agent.getContextStats();
    const ctxPct = ctxStats.estimatedPct;
    const ctxColor = ctxPct > 75 ? chalk.red : ctxPct > 50 ? chalk.yellow : chalk.green;
    console.log(chalk.gray('─'.repeat(100)));
    console.log(\`  \${chalk.bold('tasks')} (0 done, 0 in progress, 0 open) \\t\\t \${chalk.bold('context')} \${ctxColor(ctxPct + '%')} used\`);
    console.log(\`    \${chalk.gray('◼ System Ready')} \\t\\t\\t\\t \${chalk.gray('uptime')} \${Metrics.getUptimeFormatted()}\`);
    console.log();
`;

lite = lite.replace(/console\.log\(\`  \$\\{chalk\.bold\('tasks'\)\}.*\n.*/, properHeader);

// Fix researchMode assignment
lite = lite.replace(/config.researchMode = mode as any;/g, "config.researchMode = mode as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';");

fs.writeFileSync('src/cli/LiteApp.ts', lite);
console.log('Fixed redeclarations');
