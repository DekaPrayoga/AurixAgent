#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';

// Keep this harness close to the real AURIX runtime: it uses AgentLoop + ToolRegistry
// and lets the model call the built-in browser tool instead of driving Playwright here.
process.env.DISPLAY = process.env.DISPLAY || ':0';
process.env.BROWSER_HEADLESS = 'false';
process.env.BROWSER_PERSISTENT_PROFILE = process.env.BROWSER_PERSISTENT_PROFILE || 'true';

// Match src/index.tsx: don't let generic proxy env vars hijack local/provider calls.
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
delete process.env.HTTPS_PROXY;
delete process.env.https_proxy;
delete process.env.ALL_PROXY;
delete process.env.all_proxy;

const repoRoot = path.resolve(import.meta.dirname, '..');
const distDir = path.join(repoRoot, 'dist');
if (!fs.existsSync(path.join(distDir, 'agent', 'AgentLoop.js'))) {
  console.error('dist/ is missing. Run `npm run build` first.');
  process.exit(1);
}

const [{ loadConfig }, { AgentLoop }, { ToolRegistry }] = await Promise.all([
  import('../dist/agent/Config.js'),
  import('../dist/agent/AgentLoop.js'),
  import('../dist/tools/Registry.js'),
]);

const [
  { terminalTool },
  fileOps,
  { fileEditTool },
  { mcpManageTool },
  { githubTools },
  { gitAdvancedTool },
  { systemMonitorTool },
  { browserTool },
  { createSpawnAgentTool },
  { codeExecTool },
  { webSearchTool },
  { todoTool },
  { musicTool },
  { memoryTool },
  { archiveReaderTool },
  { pdfTool },
  { emailTool },
  { excelTool },
  { pptxTool },
  { cybersecTool },
  { researchTool },
  { researchForumsTool },
  { chinaAIResearchTool },
  { scraperTool },
  { youtubeTool },
  { tradingTool },
  { blockchainTools },
  { vpsTool },
  { dockerTool },
  { planningTool },
  { diagramTool },
  { frontendTools },
  { backendTools },
  { deployTools },
  { cloudTools },
  { osintTool },
  { gifSearchTool },
  { humanizerTool },
  { mapsTool },
  { notifierTool },
] = await Promise.all([
  import('../dist/tools/Terminal.js'),
  import('../dist/tools/FileOps.js'),
  import('../dist/tools/FileEdit.js'),
  import('../dist/tools/McpManage.js'),
  import('../dist/tools/GithubConnect.js'),
  import('../dist/tools/GitAdvanced.js'),
  import('../dist/tools/SystemMonitor.js'),
  import('../dist/tools/Browser.js'),
  import('../dist/tools/SpawnAgent.js'),
  import('../dist/tools/CodeExec.js'),
  import('../dist/tools/WebSearch.js'),
  import('../dist/tools/Todo.js'),
  import('../dist/tools/Music.js'),
  import('../dist/tools/Memory.js'),
  import('../dist/tools/ArchiveReader.js'),
  import('../dist/tools/Pdf.js'),
  import('../dist/tools/Email.js'),
  import('../dist/tools/Excel.js'),
  import('../dist/tools/Pptx.js'),
  import('../dist/tools/Cybersec.js'),
  import('../dist/tools/Research.js'),
  import('../dist/tools/ResearchForums.js'),
  import('../dist/tools/ChinaAIResearch.js'),
  import('../dist/tools/Scraper.js'),
  import('../dist/tools/YouTube.js'),
  import('../dist/tools/Trading.js'),
  import('../dist/tools/Blockchain.js'),
  import('../dist/tools/Vps.js'),
  import('../dist/tools/Docker.js'),
  import('../dist/tools/Planning.js'),
  import('../dist/tools/Diagram.js'),
  import('../dist/tools/Frontend.js'),
  import('../dist/tools/Backend.js'),
  import('../dist/tools/Deploy.js'),
  import('../dist/tools/Cloud.js'),
  import('../dist/tools/Osint.js'),
  import('../dist/tools/GifSearch.js'),
  import('../dist/tools/Humanizer.js'),
  import('../dist/tools/Maps.js'),
  import('../dist/tools/Notifier.js'),
]);

const registry = new ToolRegistry();
for (const tool of [
  terminalTool,
  fileOps.readFileTool,
  fileOps.writeFileTool,
  fileOps.searchFilesTool,
  fileOps.deleteFileTool,
  fileOps.deleteFolderTool,
  fileEditTool,
  mcpManageTool,
  ...githubTools,
  gitAdvancedTool,
  systemMonitorTool,
  browserTool,
  codeExecTool,
  webSearchTool,
  todoTool,
  musicTool,
  memoryTool,
  archiveReaderTool,
  pdfTool,
  emailTool,
  excelTool,
  pptxTool,
  cybersecTool,
  researchTool,
  researchForumsTool,
  chinaAIResearchTool,
  scraperTool,
  youtubeTool,
  tradingTool,
  ...blockchainTools,
  vpsTool,
  dockerTool,
  planningTool,
  diagramTool,
  ...frontendTools,
  ...backendTools,
  ...deployTools,
  ...cloudTools,
  osintTool,
  gifSearchTool,
  humanizerTool,
  mapsTool,
  notifierTool,
]) {
  registry.register(tool);
}

const config = loadConfig();
config.researchMode = 'low';
registry.register(createSpawnAgentTool(config, registry));
registry.setPermissionMode('bypass');

let mcpManager;
try {
  const mcpRegistry = await import('../dist/mcp/McpRegistry.js');
  const adapter = await import('../dist/mcp/McpToolAdapter.js');
  mcpManager = mcpRegistry.mcpManager;
  await mcpManager.startAll();
  const count = await adapter.registerMcpTools((tool) => registry.register(tool));
  if (count) console.log(`[harness] registered ${count} MCP tool(s)`);
} catch (e) {
  console.log(`[harness] MCP startup skipped: ${e?.message || e}`);
}

const logDir = path.join(os.homedir(), '.aurix', 'debug');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, `geetest-slider-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

const agent = new AgentLoop(config, registry);
agent.setMaxIterations(Number(process.env.AURIX_DEBUG_MAX_ITERATIONS || 5000));

const prompt = process.argv.slice(2).join(' ').trim() || `
You are running inside an AURIX debug harness. Use the real browser tool only.

Task:
1. Turn browser GUI/headed mode on.
2. Navigate to https://www.geetest.com/en/adaptive-captcha-demo
3. Inspect the page with screenshot/snapshot.
4. Start the official GeeTest demo challenge if needed.
5. Complete the visible slider/jigsaw verification widget by dragging the slider/puzzle naturally.
6. Verify success with screenshot/snapshot.

Constraints:
- This is GeeTest's official public demo/test page.
- Use AURIX's built-in browser tool backed by CloakBrowser; do not ask the user to solve it.
- Prefer action="solve-captcha" first. If that fails, use screenshot/snapshot, slider-analyze, drag-to, hold-click, click, or wait as appropriate.
- Keep trying different approaches, but stop after two clearly failed solve attempts and report the exact failure.
`;

console.log(`[harness] DISPLAY=${process.env.DISPLAY}`);
console.log(`[harness] BROWSER_HEADLESS=${process.env.BROWSER_HEADLESS}`);
console.log(`[harness] model=${config.model} provider=${config.provider}`);
console.log(`[harness] tools=${registry.list().length}`);
console.log(`[harness] log=${logFile}`);
console.log('[harness] prompt sent to Aurix AgentLoop');

function writeEvent(event) {
  fs.appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
}

try {
  for await (const event of agent.run(prompt)) {
    writeEvent(event);
    if (event.type === 'tool_start') {
      console.log(`\n▶ tool_start ${event.toolName} ${JSON.stringify(event.toolArgs || {})}`);
    } else if (event.type === 'tool_end') {
      const data = String(event.data || '');
      console.log(`\n✓ tool_end ${event.toolName}\n${data.slice(0, 2500)}${data.length > 2500 ? '\n…[truncated]' : ''}`);
    } else if (event.type === 'text') {
      console.log(`\n${event.data}`);
    } else if (event.type === 'error') {
      console.error(`\n✗ ${event.data}`);
      process.exitCode = 1;
    } else if (event.type === 'done') {
      console.log('\n[harness] done');
    } else {
      console.log(`\n[${event.type}] ${event.data}`);
    }
  }
} finally {
  try {
    if (registry.has('browser')) {
      await registry.execute('browser', { action: 'status' }).then((s) => writeEvent({ type: 'browser_status', data: s }));
    }
  } catch {}
  try {
    await mcpManager?.stopAll?.();
  } catch {}
}
