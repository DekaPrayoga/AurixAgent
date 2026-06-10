#!/usr/bin/env bun
import React from 'react';
import { createRoot } from '@opentui/react';
import { createCliRenderer } from '@opentui/core';
import { App } from './cli/App.js';
import { applyTheme } from './cli/theme.js';
import { loadConfig } from './agent/Config.js';
import { runSetup } from './agent/Setup.js';
import { ToolRegistry } from './tools/Registry.js';
import { terminalTool } from './tools/Terminal.js';
import { readFileTool, writeFileTool, searchFilesTool } from './tools/FileOps.js';
import { fileEditTool } from './tools/FileEdit.js';
import { mcpManageTool } from './tools/McpManage.js';
import { githubTools } from './tools/GithubConnect.js';
import { systemMonitorTool } from './tools/SystemMonitor.js';
import { browserTool } from './tools/Browser.js';
import { codeExecTool } from './tools/CodeExec.js';
import { webSearchTool } from './tools/WebSearch.js';
import { todoTool } from './tools/Todo.js';
import { visionTool } from './tools/Vision.js';
import { musicTool } from './tools/Music.js';
import { memoryTool } from './tools/Memory.js';
import { pdfTool } from './tools/Pdf.js';
import { emailTool } from './tools/Email.js';
import { cybersecTool } from './tools/Cybersec.js';
import { researchTool } from './tools/Research.js';
import { researchForumsTool } from './tools/ResearchForums.js';
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

function createRegistry(features?: string[]): ToolRegistry {
  const registry = new ToolRegistry();

  // Core tools (always registered)
  registry.register(terminalTool);
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(searchFilesTool);
  registry.register(fileEditTool);
  registry.register(mcpManageTool);
  for (const t of githubTools) registry.register(t);
  registry.register(systemMonitorTool);
  registry.register(browserTool);
  registry.register(codeExecTool);
  registry.register(webSearchTool);
  registry.register(todoTool);
  registry.register(visionTool);
  registry.register(musicTool);
  registry.register(memoryTool);

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

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'gateway') {
    const { startGateway } = await import('./gateway-entry.js');
    await startGateway(createRegistry());
    return;
  }

  // Mouse handling is done by OpenTUI internally
  const isSetup = args[0] === 'setup' || args.includes('--setup');
  const isContinue = args.includes('--continue');
  const resumeIdx = args.indexOf('--resume');
  const resumeId = resumeIdx !== -1 ? args[resumeIdx + 1] : undefined;

  let config = loadConfig();

  if (isSetup || (!config.apiKey && !isContinue && !resumeId)) {
    config = await runSetup(isContinue);
  }

  if (config.langsmith?.apiKey) {
    process.env.LANGCHAIN_API_KEY = config.langsmith.apiKey;
    process.env.LANGCHAIN_PROJECT = config.langsmith.project;
    process.env.LANGCHAIN_TRACING_V2 = 'true';
  }

  applyTheme(config);

  const registry = createRegistry(config.features);

  // Background memory consolidation every 10 minutes
  const { MemoryEngine } = await import('./agent/MemoryEngine.js');
  const bgMemory = new MemoryEngine();
  const consolidateTimer = setInterval(() => {
    bgMemory.consolidate().catch(() => {});
  }, 10 * 60 * 1000);

  process.on('exit', () => {
    clearInterval(consolidateTimer);
    try { bgMemory.consolidate(); } catch {}
  });

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });

  createRoot(renderer).render(
    React.createElement(App, { config, registry, resumeId })
  );
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
