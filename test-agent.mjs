const { AgentLoop } = await import('./dist/agent/AgentLoop.js');
const { ToolRegistry } = await import('./dist/tools/Registry.js');
const { loadConfig } = await import('./dist/agent/Config.js');
const { terminalTool } = await import('./dist/tools/Terminal.js');
const { readFileTool, writeFileTool, searchFilesTool } = await import('./dist/tools/FileOps.js');
const { fileEditTool } = await import('./dist/tools/FileEdit.js');
const { browserTool } = await import('./dist/tools/Browser.js');
const { webSearchTool } = await import('./dist/tools/WebSearch.js');
const { codeExecTool } = await import('./dist/tools/CodeExec.js');

const TIMEOUT_MS = 5 * 60 * 1000;

const registry = new ToolRegistry();
registry.register(terminalTool);
registry.register(readFileTool);
registry.register(writeFileTool);
registry.register(searchFilesTool);
registry.register(fileEditTool);
registry.register(browserTool);
registry.register(webSearchTool);
registry.register(codeExecTool);

const config = loadConfig();
const agent = new AgentLoop(config, registry);
agent.setMaxIterations(100);

const task = 'Sign up for a new account on webshare.io. Use email: testaurix2026@protonmail.com and password: AurixTest2026! and name: Test Aurix. Complete the entire signup process including any captchas.';

console.log(`\n=== AURIX AGENT TEST ===`);
console.log(`Task: ${task}`);
console.log(`Model: ${config.model}`);
console.log(`Timeout: 5 minutes\n`);

const timer = setTimeout(() => {
  console.log('\n\n!!! TIMEOUT: Agent did not finish within 5 minutes !!!');
  agent.interrupt();
  process.exit(1);
}, TIMEOUT_MS);

const startTime = Date.now();
let lastEventTime = startTime;

(async () => {
  try {
    for await (const event of agent.run(task)) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const gap = ((Date.now() - lastEventTime) / 1000).toFixed(1);
      lastEventTime = Date.now();
      switch (event.type) {
        case 'tool_start': {
          const args = event.toolArgs ? JSON.stringify(event.toolArgs).slice(0, 150) : '';
          console.log(`[${elapsed}s +${gap}s] TOOL_START: ${event.toolName} ${args}`);
          break;
        }
        case 'tool_end':
          console.log(`[${elapsed}s +${gap}s] TOOL_END: ${event.toolName} → ${event.data?.slice(0, 120)}`);
          break;
        case 'text':
          console.log(`[${elapsed}s +${gap}s] TEXT: ${event.data.slice(0, 300)}`);
          break;
        case 'error':
          console.log(`[${elapsed}s +${gap}s] ERROR: ${event.data}`);
          break;
        case 'compact':
          console.log(`[${elapsed}s +${gap}s] COMPACT: ${event.data}`);
          break;
        case 'done':
          console.log(`\n[${elapsed}s] === DONE ===`);
          break;
      }
    }
    clearTimeout(timer);
    const total = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nTotal time: ${total}s`);
    process.exit(0);
  } catch (e) {
    clearTimeout(timer);
    console.error(`Fatal: ${e.message}`);
    process.exit(1);
  }
})();
