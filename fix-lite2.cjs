const fs = require('fs');
let lite = fs.readFileSync('src/cli/LiteApp.ts', 'utf8');

lite = lite.replace(/\\n'/g, "\\n'"); // fix the literal newlines inside quotes
lite = lite.replace(/console\.log\('\\n' \+ marked\.parse\(event\.data\)\);/g, "console.log('\\n' + marked.parse(event.data));");
lite = lite.replace(/console\.log\(chalk\.red\.bold\('\\nError: '\) \+ event\.data\);/g, "console.log(chalk.red.bold('\\nError: ') + event.data);");
lite = lite.replace(/console\.log\('─────────────────────────────────────────────────────────────────────────────────────────\\n'\);/g, "console.log('─────────────────────────────────────────────────────────────────────────────────────────\\n');");

fs.writeFileSync('src/cli/LiteApp.ts', lite);
console.log('Fixed LiteApp.ts newlines');
