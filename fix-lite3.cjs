const fs = require('fs');
let lite = fs.readFileSync('src/cli/LiteApp.ts', 'utf8');

lite = lite.replace(/\\`/g, '`');
lite = lite.replace(/\\\$/g, '$');

fs.writeFileSync('src/cli/LiteApp.ts', lite);
console.log('Fixed quotes properly');
