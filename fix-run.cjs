const fs = require('fs');

// Fix API
let api = fs.readFileSync('src/api/Server.ts', 'utf8');
api = api.replace(/agent\.run\(\)\.catch/g, "agent.start(prompt).catch");
api = api.replace(/await agent\.run\(\);/g, "await agent.start(prompt);");

if (!api.includes("agent.start(prompt)")) {
  api = api.replace(/agent\.run\(\)/g, `(async () => { for await (const _ of agent.run(prompt)) {} })()`);
}

fs.writeFileSync('src/api/Server.ts', api);

// Fix CronDaemon
let cronScript = fs.readFileSync('src/agent/CronDaemon.ts', 'utf8');
if (!cronScript.includes("import * as cron")) {
  cronScript = cronScript.replace("import cron from 'node-cron';", "import * as cron from 'node-cron';");
}
cronScript = cronScript.replace(/await agent\.run\(\);/g, `for await (const _ of agent.run(job.prompt)) {}`);

fs.writeFileSync('src/agent/CronDaemon.ts', cronScript);

console.log('Fixed run() and namespace errors');
