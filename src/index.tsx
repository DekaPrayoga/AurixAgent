#!/usr/bin/env bun
import chalk from 'chalk';
import { getAurixVersion } from './utils/RuntimeInfo.js';

// --- CRITICAL FIX FOR 9ROUTER / LOCALHOST PROXY ISSUES ---
// Node.js/Bun fetch aggressively uses these env vars, causing local requests (127.0.0.1:20128)
// to be routed through residential proxies and returning 403 Connect BanAddress.
// We must delete them from the process environment so internal LLM requests are direct.
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
delete process.env.HTTPS_PROXY;
delete process.env.https_proxy;
delete process.env.ALL_PROXY;
delete process.env.all_proxy;

import { applyTheme } from './cli/theme.js';
import { createTerminalLifecycle } from './cli/TerminalLifecycle.js';
import { loadConfig } from './agent/Config.js';
import { runSetup } from './agent/Setup.js';
import { createProvider } from './providers/index.js';
import { ToolRegistry } from './tools/Registry.js';
import { terminalTool } from './tools/Terminal.js';
import {
  readFileTool,
  writeFileTool,
  searchFilesTool,
  deleteFileTool,
  deleteFolderTool,
  recoveryFileTool,
  recoveryFolderTool,
} from './tools/FileOps.js';
import { fileEditTool } from './tools/FileEdit.js';
import { mcpManageTool } from './tools/McpManage.js';
import { mcpManager } from './mcp/McpRegistry.js';
import { registerMcpTools } from './mcp/McpToolAdapter.js';
import { githubTools } from './tools/GithubConnect.js';
import { gitAdvancedTool } from './tools/GitAdvanced.js';
import { systemMonitorTool } from './tools/SystemMonitor.js';
import { browserTool } from './tools/Browser.js';
import { createSpawnAgentTool } from './tools/SpawnAgent.js';
import { codeExecTool } from './tools/CodeExec.js';
import { webSearchTool } from './tools/WebSearch.js';
import { todoTool } from './tools/Todo.js';
import { musicTool } from './tools/Music.js';
import { memoryTool } from './tools/Memory.js';
import { pdfTool } from './tools/Pdf.js';
import { emailTool } from './tools/Email.js';
import { cybersecTool } from './tools/Cybersec.js';
import { researchTool } from './tools/Research.js';
import { researchForumsTool } from './tools/ResearchForums.js';
import { chinaAIResearchTool } from './tools/ChinaAIResearch.js';
import { tradingTool } from './tools/Trading.js';
import { vpsTool } from './tools/Vps.js';
import { planningTool } from './tools/Planning.js';
import { frontendTools } from './tools/Frontend.js';
import { backendTools } from './tools/Backend.js';
import { deployTools } from './tools/Deploy.js';
import { cloudTools } from './tools/Cloud.js';
import { blockchainTools } from './tools/Blockchain.js';
import { excelTool } from './tools/Excel.js';
import { pptxTool } from './tools/Pptx.js';
import { osintTool } from './tools/Osint.js';
import { scraperTool } from './tools/Scraper.js';
import { dockerTool } from './tools/Docker.js';
import { youtubeTool } from './tools/YouTube.js';
import { gifSearchTool } from './tools/GifSearch.js';
import { humanizerTool } from './tools/Humanizer.js';
import { mapsTool } from './tools/Maps.js';
import { notifierTool } from './tools/Notifier.js';
import { diagramTool } from './tools/Diagram.js';
import { archiveReaderTool } from './tools/ArchiveReader.js';
import { brainTool } from './tools/Brain.js';
import { audioCaptchaTool, audioCaptchaLocalTool } from './tools/AudioCaptcha.js';
import { tempMailingTool } from './tools/TempMail.js';
import { createNonInteractiveCleanup } from './cli/NonInteractiveCleanup.js';

function createRegistry(features?: string[]): ToolRegistry {
  const registry = new ToolRegistry();

  // Core tools (always registered)
  registry.register(terminalTool);
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(searchFilesTool);
  registry.register(deleteFileTool);
  registry.register(deleteFolderTool);
  registry.register(recoveryFileTool);
  registry.register(recoveryFolderTool);
  registry.register(fileEditTool);
  registry.register(mcpManageTool);
  for (const t of githubTools) registry.register(t);
  registry.register(gitAdvancedTool);
  registry.register(systemMonitorTool);
  registry.register(browserTool);
  registry.register(codeExecTool);
  registry.register(webSearchTool);
  registry.register(todoTool);
  registry.register(musicTool);
  registry.register(memoryTool);
  registry.register(archiveReaderTool);
  registry.register(brainTool);
  registry.register(audioCaptchaTool);
  registry.register(audioCaptchaLocalTool);
  registry.register(tempMailingTool);

  const f = features || [];
  const all = f.length === 0;

  if (all || f.includes('office')) {
    registry.register(pdfTool);
    registry.register(emailTool);
    registry.register(excelTool);
    registry.register(pptxTool);
  }

  if (all || f.includes('cybersec')) {
    registry.register(cybersecTool);
  }

  if (all || f.includes('research')) {
    registry.register(researchTool);
    registry.register(researchForumsTool);
    registry.register(chinaAIResearchTool);
    registry.register(scraperTool);
    registry.register(youtubeTool);
  }

  if (all || f.includes('trading')) {
    registry.register(tradingTool);
    for (const t of blockchainTools) registry.register(t);
  }

  if (all || f.includes('vps')) {
    registry.register(vpsTool);
    registry.register(dockerTool);
  }

  if (all || f.includes('planning')) {
    registry.register(planningTool);
    registry.register(diagramTool);
  }

  if (all || f.includes('frontend')) {
    for (const t of frontendTools) registry.register(t);
  }

  if (all || f.includes('backend')) {
    for (const t of backendTools) registry.register(t);
  }

  if (all || f.includes('deploy')) {
    for (const t of deployTools) registry.register(t);
  }

  if (all || f.includes('cloud')) {
    for (const t of cloudTools) registry.register(t);
  }

  if (all || f.includes('osint')) {
    registry.register(osintTool);
  }

  if (all || f.includes('creative')) {
    registry.register(gifSearchTool);
    registry.register(humanizerTool);
  }

  if (all || f.includes('maps')) {
    registry.register(mapsTool);
  }

  if (all || f.includes('notifier')) {
    registry.register(notifierTool);
  }

  return registry;
}

export { createRegistry };

async function runNonInteractive(
  config: ReturnType<typeof loadConfig>,
  registry: ToolRegistry,
  prompt: string
): Promise<number> {
  const { AgentLoop } = await import('./agent/AgentLoop.js');
  const { safeDisplayText } = await import('./utils/terminal-sanitize.js');
  const agent = new AgentLoop(config, registry);
  let finalText = '';
  let errorText = '';
  let signalCount = 0;
  const cleanup = createNonInteractiveCleanup({
    saveSession: async () => {
      await agent.saveSessionAsync();
    },
    closeBrowsers: async () => {
      if (registry.has('browser')) await registry.execute('browser', { action: 'close-all' });
    },
  });

  const interrupt = () => {
    signalCount++;
    agent.interrupt();
    process.exitCode = 130;
    void cleanup().finally(() => {
      if (signalCount > 1) process.exit(130);
    });
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);

  try {
    for await (const event of agent.run(prompt)) {
      if (event.type === 'text' && event.data.trim()) {
        finalText = event.data;
      } else if (event.type === 'done' && event.data.trim()) {
        finalText = event.data;
      } else if (event.type === 'error') {
        errorText = event.data;
      } else if (
        process.env.AURIX_NON_INTERACTIVE_VERBOSE === '1' &&
        ['route', 'research', 'compact', 'tool_start', 'tool_chunk', 'tool_end'].includes(event.type)
      ) {
        const label = event.toolName || event.type;
        const detail = event.data ? `: ${safeDisplayText(event.data)}` : '';
        process.stderr.write(`[${label}]${detail}\n`);
      }
    }

    if (process.exitCode === 130) return 130;
    if (errorText) {
      process.stderr.write(`${safeDisplayText(errorText).trim()}\n`);
      return 1;
    }
    if (!finalText.trim()) {
      process.stderr.write('Aurix returned no final answer.\n');
      return 1;
    }

    const cleanAnswer = safeDisplayText(finalText)
      .replace(
        /\n+---\n+[^\n]*This model is FREE and served by inferhub\.dev\.[\s\S]*$/i,
        ''
      )
      .trim();
    process.stdout.write(`${cleanAnswer}\n`);
    return 0;
  } catch (error: any) {
    process.stderr.write(`Fatal: ${safeDisplayText(error?.message || error).trim()}\n`);
    return process.exitCode === 130 ? 130 : 1;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await cleanup();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const hasNonInteractiveArg = args.some(
    (arg) => arg === '--non-interactive' || arg === '-p' || arg === '--prompt'
  );

  const terminalLifecycle = createTerminalLifecycle({
    installSignalHandlers: false,
    exitOnSignal: false,
  });
  process.on('exit', () => {
    void terminalLifecycle.dispose();
  });
  process.on('uncaughtException', (err) => {
    void terminalLifecycle.dispose().finally(() => {
      console.error(err);
      process.exit(1);
    });
  });

  if (args.some((arg) => arg === '-h' || arg === '--help' || arg === 'help')) {
    process.stdout.write(`AURIX Agent\n\nUsage:\n  aurix                         Start interactive session\n  aurix --non-interactive <prompt>\n  aurix -p <prompt>             Run one prompt, print the answer, exit\n  aurix setup                   Configure provider and model\n  aurix gateway                 Start messaging gateway\n`);
    return;
  }
  if (args.some((arg) => arg === '-v' || arg === '--version' || arg === 'version')) {
    process.stdout.write(`aurix v${getAurixVersion()}\n`);
    return;
  }

  if (process.platform === 'linux' && !process.env.DISPLAY) {
    try {
      const fs = await import('fs');
      for (const s of fs.readdirSync('/tmp/.X11-unix/')) {
        if (s.startsWith('X')) {
          process.env.DISPLAY = `:${s.slice(1)}`;
          break;
        }
      }
    } catch {}
    if (!process.env.DISPLAY) {
      try {
        const { execFileSync } = await import('child_process');
        const out = execFileSync('nxserver', ['--list'], { timeout: 2000, encoding: 'utf8' });
        const match = out.match(/(\d{3,4})\s+\w+\s+[\d.]+/);
        if (match) process.env.DISPLAY = `:${match[1]}`;
      } catch {}
    }
  }
  if (process.platform === 'linux' && !process.env.XAUTHORITY && process.env.HOME) {
    try {
      const fs = await import('fs');
      const xauth = `${process.env.HOME}/.Xauthority`;
      fs.accessSync(xauth);
      process.env.XAUTHORITY = xauth;
    } catch {}
  }

  if (args[0] === 'gateway') {
    const { startGateway } = await import('./gateway-entry.js');
    const { ensureRedditApiServer } = await import('./api/RedditApiServer.js');
    const gatewayConfig = loadConfig();
    if (
      (!gatewayConfig.redditBackend || ['auto', 'relay'].includes(gatewayConfig.redditBackend)) &&
      !gatewayConfig.redditRelayUrl
    ) {
      await ensureRedditApiServer();
    }
    const gatewayRegistry = createRegistry(gatewayConfig.features);
    gatewayRegistry.register(createSpawnAgentTool(gatewayConfig, gatewayRegistry));
    await startGateway(gatewayRegistry);
    return;
  }

  if (args[0] === 'api' || args[0] === 'reddit-api') {
    const { startRedditApiServer } = await import('./api/RedditApiServer.js');
    await startRedditApiServer();
    return;
  }

  const nonInteractiveIdx = args.findIndex(
    (arg) => arg === '--non-interactive' || arg === '-p' || arg === '--prompt'
  );
  const nonInteractive = nonInteractiveIdx !== -1;
  const promptParts = nonInteractive ? args.slice(nonInteractiveIdx + 1) : [];
  const nonInteractivePrompt = promptParts.join(' ').trim();
  if (nonInteractive && !nonInteractivePrompt) {
    process.stderr.write('Usage: aurix --non-interactive <prompt>\n');
    process.exitCode = 2;
    return;
  }

  // Non-blocking update check — fetches latest version from npm registry,
  // caches the result for 24h. Prints a banner if newer version exists.
  const updateCheckPromise = nonInteractive
    ? Promise.resolve()
    : import('./utils/UpdateCheck.js')
        .then((m) => m.checkForUpdate())
        .catch(() => {});

  // Mouse handling is done by OpenTUI internally
  const isSetup = args[0] === 'setup' || args.includes('--setup');
  const isContinue = args.includes('--continue');
  const resumeIdx = args.indexOf('--resume');
  const resumeId = resumeIdx !== -1 ? args[resumeIdx + 1] : undefined;

  let config = loadConfig();

  if (nonInteractive && !config.apiKey) {
    process.stderr.write('Aurix is not configured. Run `aurix setup` first.\n');
    process.exitCode = 1;
    return;
  }

  if (isSetup || (!config.apiKey && !isContinue && !resumeId)) {
    config = await runSetup(isContinue);
  }

  if (nonInteractive) {
    const registry = createRegistry(config.features);
    registry.register(createSpawnAgentTool(config, registry));
    process.exitCode = await runNonInteractive(config, registry, nonInteractivePrompt);
    return;
  }

  if (
    (!config.redditBackend || ['auto', 'relay'].includes(config.redditBackend)) &&
    !config.redditRelayUrl
  ) {
    const { ensureRedditApiServer } = await import('./api/RedditApiServer.js');
    await ensureRedditApiServer();
  }

  applyTheme(config);

  const registry = createRegistry(config.features);

  registry.register(createSpawnAgentTool(config, registry));

  const { CronDaemon } = await import('./agent/CronDaemon.js');
  const cronDaemon = new CronDaemon(registry);
  cronDaemon.start().catch(() => {});

  await mcpManager.startAll();
  const mcpToolCount = await registerMcpTools((tool) => registry.register(tool));
  if (mcpToolCount > 0) {
    process.stderr.write(
      `  MCP: ${mcpToolCount} tools registered from ${mcpManager.getAllClients().size} server(s)\n`
    );
  }

  // Let the update check finish before we enter the alt-screen renderer.
  // If the user is on an old version, they'll see the banner here.
  await updateCheckPromise;

  // Background memory lifecycle sync every 10 minutes
  const { MemoryManager } = await import('./agent/MemoryManager.js');
  const bgMemory = new MemoryManager(createProvider(config));
  const consolidateTimer = setInterval(
    () => {
      bgMemory.sync().catch(() => {});
    },
    10 * 60 * 1000
  );

  let memorySyncedOnShutdown = false;
  process.once('beforeExit', async () => {
    if (memorySyncedOnShutdown) return;
    memorySyncedOnShutdown = true;
    clearInterval(consolidateTimer);
    try {
      await bgMemory.sync();
    } catch {}
  });

  process.on('exit', () => {
    clearInterval(consolidateTimer);
    cronDaemon.stop();
    try {
      mcpManager.stopAll();
    } catch {}
  });

  if (process.argv.includes('--lite')) {
    const { runLiteApp } = await import('./cli/LiteApp.js');
    await runLiteApp(config, registry);
    return;
  }

  const [{ default: React }, { createRoot }, { createCliRenderer }, { App }] = await Promise.all([
    import('react'),
    import('@opentui/react'),
    import('@opentui/core'),
    import('./cli/App.js'),
  ]);

  await terminalLifecycle.start();
  let renderer;
  try {
    renderer = await createCliRenderer({
      exitOnCtrlC: false,
      useMouse: true,
    });
  } catch (err: any) {
    clearInterval(consolidateTimer);
    const { drawBox, drawWarning, drawInfo } = await import('./cli/SetupUI.js');
    const platformPkg =
      process.platform === 'win32'
        ? process.arch === 'arm64'
          ? '@opentui/core-win32-arm64'
          : '@opentui/core-win32-x64'
        : process.platform === 'darwin'
          ? process.arch === 'arm64'
            ? '@opentui/core-darwin-arm64'
            : '@opentui/core-darwin-x64'
          : process.arch === 'arm64'
            ? '@opentui/core-linux-arm64'
            : '@opentui/core-linux-x64';
    let hasNativePkg = false;
    try {
      const resolved = import.meta.resolve(platformPkg);
      hasNativePkg = !!resolved;
    } catch {}
    console.clear();
    console.log();
    drawWarning('OpenTUI renderer failed to initialize.');
    drawInfo(`Platform: ${process.platform}-${process.arch}  Node: ${process.version}`);
    drawInfo(`Native pkg (${platformPkg}): ${hasNativePkg ? 'installed' : 'MISSING'}`);
    console.log();
    if (err?.message) {
      drawBox([chalk.hex('#808080')('Error: ' + err.message)], 72);
      console.log();
    }
    const lines: string[] = [
      chalk.hex('#fab283').bold('AURIX Agent — renderer bootstrap failed'),
      '',
      chalk.hex('#eeeeee')('OpenTUI supports Linux, macOS, and Windows. The failure above'),
      chalk.hex('#eeeeee')('is usually one of these:'),
      '',
      chalk.hex('#9d7cd8').bold('1. Native binary not installed'),
      chalk.hex('#eeeeee')('   The per-platform package is an optionalDependency. If npm'),
      chalk.hex('#eeeeee')('   skipped it (network glitch, --omit=optional, pnpm strict),'),
      chalk.hex('#eeeeee')('   re-run a clean install:'),
      chalk.hex('#7fd88f')('     rm -rf node_modules package-lock.json && npm install'),
      '',
      chalk.hex('#9d7cd8').bold('2. Node needs --experimental-ffi'),
      chalk.hex('#eeeeee')('   bin/aurix.js injects this automatically. If you started'),
      chalk.hex('#eeeeee')('   via `node dist/index.js` directly, use:'),
      chalk.hex('#7fd88f')('     node --experimental-ffi dist/index.js'),
      '',
      chalk.hex('#9d7cd8').bold('3. Wrong arch (Windows on ARM / Apple Silicon Rosetta)'),
      chalk.hex('#eeeeee')('   Run `node -p "process.arch"` — should match your CPU.'),
      '',
      chalk.hex('#9d7cd8').bold('4. Windows: missing VC++ runtime'),
      chalk.hex('#eeeeee')('   Install the VC++ Redist from:'),
      chalk.hex('#7fd88f')('     https://aka.ms/vs/17/release/vc_redist.x64.exe'),
      '',
      chalk.hex('#808080')('Setup completed successfully — config is saved.'),
      chalk.hex('#808080')('`aurix gateway` still works even when the TUI fails.'),
    ];
    drawBox(lines, 72);
    console.log();
    process.exit(1);
  }

  createRoot(renderer).render(
    React.createElement(App, {
      config,
      registry,
      resumeId,
      cronDaemon,
    })
  );
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
