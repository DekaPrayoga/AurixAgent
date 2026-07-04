const fs = require('fs');

let agent = fs.readFileSync('src/agent/AgentLoop.ts', 'utf8');

const target = `result = await withTimeout(this.registry.execute(call.name, call.arguments), getToolTimeout(call.name, call.arguments), call.name);`;
const inject = `if (call.name === 'ask_user') {
              call.arguments._sessionKey = this.agentKey || 'default';
            }
            result = await withTimeout(this.registry.execute(call.name, call.arguments), getToolTimeout(call.name, call.arguments), call.name);`;

if (!agent.includes("call.arguments._sessionKey = this.agentKey")) {
  agent = agent.replace(target, inject);
}

// same for the parallel executions
const target2 = `const result = await withTimeout(this.registry.execute(call.name, call.arguments), getToolTimeout(call.name, call.arguments), call.name);`;
const inject2 = `if (call.name === 'ask_user') {
                  call.arguments._sessionKey = this.agentKey || 'default';
                }
                const result = await withTimeout(this.registry.execute(call.name, call.arguments), getToolTimeout(call.name, call.arguments), call.name);`;

if (!agent.includes("call.name === 'ask_user'")) {
  agent = agent.replace(target2, inject2);
  agent = agent.replace(target2, inject2);
}

fs.writeFileSync('src/agent/AgentLoop.ts', agent);
console.log('AgentLoop patched');
