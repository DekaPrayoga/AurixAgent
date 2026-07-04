const fs = require('fs');
let agent = fs.readFileSync('src/agent/AgentLoop.ts', 'utf8');

// Fix the bad block
agent = agent.replace(
`              const if (call.name === 'ask_user') {
              call.arguments._sessionKey = this.agentKey || 'default';
            }
            result = await withTimeout(this.registry.execute(call.name, call.arguments), getToolTimeout(call.name, call.arguments), call.name);`,
`              if (call.name === 'ask_user') {
                call.arguments._sessionKey = this.agentKey || 'default';
              }
              const result = await withTimeout(this.registry.execute(call.name, call.arguments), getToolTimeout(call.name, call.arguments), call.name);`
);

fs.writeFileSync('src/agent/AgentLoop.ts', agent);
