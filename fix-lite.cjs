const fs = require('fs');
let lite = fs.readFileSync('src/cli/LiteApp.ts', 'utf8');

// Fix the escaped backticks from the bash cat EOF bug
lite = lite.replace(/\\\`Unknown command: \/\\\$\\{slash\\.name\\}\\\`/g, "`Unknown command: /${slash.name}`");
lite = lite.replace(/\\\`Running tool: \\\$\\{event\\.toolName\\}\\.\\.\\.\\`/g, "`Running tool: ${event.toolName}...`");
lite = lite.replace(/\\n/g, "\n");

fs.writeFileSync('src/cli/LiteApp.ts', lite);
console.log('Fixed syntax errors in LiteApp.ts');
