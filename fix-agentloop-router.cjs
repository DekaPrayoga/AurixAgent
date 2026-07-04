const fs = require('fs');
let agent = fs.readFileSync('src/agent/AgentLoop.ts', 'utf8');

const targetClassify = `function classifyError(e: any): string {
  if (e.status === 401 || e.status === 403) return 'auth';
  if (e.status === 429) return 'rate_limit';`;

const injectClassify = `function classifyError(e: any): string {
  const msg = (e.message || '').toLowerCase();
  // 9Router or custom proxy temporary failures shouldn't be hard-killed as auth errors
  if (msg.includes('connect proxy error') || msg.includes('9router')) return 'network';
  if (e.status === 401 || e.status === 403) {
    if (msg.includes('connect proxy') || msg.includes('tunnel') || msg.includes('upstream')) return 'network';
    return 'auth';
  }
  if (e.status === 429) return 'rate_limit';`;

if (agent.includes(targetClassify)) {
  agent = agent.replace(targetClassify, injectClassify);
  fs.writeFileSync('src/agent/AgentLoop.ts', agent);
  console.log('Classify patched');
}
