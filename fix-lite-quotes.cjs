const fs = require('fs');
let lite = fs.readFileSync('src/cli/LiteApp.ts', 'utf8');

lite = lite.replace(/\\\`Loading skill: \\\$\\{commandName\\}\\.\\.\\.\\\`/g, "`Loading skill: ${commandName}...`");
lite = lite.replace(/\\\`Unknown command: \/\\\$\\{commandName\\}\\\`/g, "`Unknown command: /${commandName}`");
lite = lite.replace(/\\\`Command error: \\\$\\{e\\.message\\}\\\`/g, "`Command error: ${e.message}`");

fs.writeFileSync('src/cli/LiteApp.ts', lite);
console.log('Fixed quotes in LiteApp.ts');
