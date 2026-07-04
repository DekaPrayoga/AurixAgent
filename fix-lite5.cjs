const fs = require('fs');
let lite = fs.readFileSync('src/cli/LiteApp.ts', 'utf8');

lite = lite.replace("marked.use(markedTerminal({", "marked.use(new markedTerminal({");
lite = lite.replace("researchMode = mode;", "researchMode = mode as any;");

fs.writeFileSync('src/cli/LiteApp.ts', lite);
console.log('Fixed types');
