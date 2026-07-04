const fs = require('fs');
let agent = fs.readFileSync('src/agent/AgentLoop.ts', 'utf8');

const targetClassify = `  if (status === 401 || status === 403 || msg.includes('invalid api key') || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('authentication')) {
    return 'auth';
  }`;

const injectClassify = `  if (msg.includes('connect proxy') || msg.includes('9router') || msg.includes('upstream') || msg.includes('tunnel')) {
    return 'network';
  }
  if (status === 401 || status === 403 || msg.includes('invalid api key') || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('authentication')) {
    return 'auth';
  }`;

if (agent.includes(targetClassify)) {
  agent = agent.replace(targetClassify, injectClassify);
  fs.writeFileSync('src/agent/AgentLoop.ts', agent);
  console.log('Classify patched properly');
}
