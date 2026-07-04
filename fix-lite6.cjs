const fs = require('fs');
let lite = fs.readFileSync('src/cli/LiteApp.ts', 'utf8');

lite = lite.replace("new markedTerminal({", "markedTerminal({");

fs.writeFileSync('src/cli/LiteApp.ts', lite);
console.log('Fixed markedTerminal');
