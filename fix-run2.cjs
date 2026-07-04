const fs = require('fs');

let api = fs.readFileSync('src/api/Server.ts', 'utf8');
api = api.replace(/agent\.start\(prompt\)\.catch\(e => console\.error\('API Agent Background Error:', e\)\);/g, `(async () => { for await (const _ of agent.run(prompt)) {} })().catch((e: any) => console.error('API Agent Background Error:', e));`);
api = api.replace(/await agent\.start\(prompt\);/g, `for await (const _ of agent.run(prompt)) {}`);
fs.writeFileSync('src/api/Server.ts', api);

console.log('Fixed run() in API');
