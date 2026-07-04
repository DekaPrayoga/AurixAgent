const fs = require('fs');
let agent = fs.readFileSync('src/agent/AgentLoop.ts', 'utf8');

// Update the call to provider.chat to pass the signal
const targetCall = `response = await this.provider.chat(finalOptimizedMessages, this.registry.getToolDefs());`;
const injectCall = `response = await this.provider.chat(finalOptimizedMessages, this.registry.getToolDefs(), this.abortController.signal);`;

if (agent.includes(targetCall)) {
  agent = agent.replace(targetCall, injectCall);
  fs.writeFileSync('src/agent/AgentLoop.ts', agent);
  console.log('AgentLoop call patched');
}
