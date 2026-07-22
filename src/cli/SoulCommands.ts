import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getSoulPath, loadSoul } from '../agent/Soul.js';
import { loadAgentsMD } from '../agent/AgentsMD.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';

export function getCanonicalSoulPath(): string {
  return path.resolve(getSoulPath());
}

export function sanitizeSoulForDisplay(content: string): string {
  return safeDisplayText(content);
}

export function getSoulStatus(): string {
  try {
    const content = loadSoul();
    if (!content) return fs.existsSync(getSoulPath()) ? 'empty' : 'missing';
    if (!content.trim()) return 'empty';
    return 'loaded';
  } catch (error) {
    return `error (${error instanceof Error ? error.message : String(error)})`;
  }
}

export function getAgentsStatus(projectDir = process.cwd()): string {
  try {
    const agents = loadAgentsMD(projectDir);
    return agents.combined.trim() ? 'loaded' : 'missing';
  } catch (error) {
    return `error (${error instanceof Error ? error.message : String(error)})`;
  }
}

export function formatReloadReport(soulStatus = getSoulStatus(), agentsStatus = getAgentsStatus()): string {
  return [
    'Configuration reloaded',
    `SOUL.md: ${soulStatus}`,
    `AGENTS.md: ${agentsStatus}`,
    'System prompt rebuilt',
    'Conversation preserved',
  ].join('\n');
}

export function formatSoulShow(): string {
  const content = loadSoul();
  if (!content) return `SOUL.md is ${fs.existsSync(getSoulPath()) ? 'empty' : 'missing'}: ${getCanonicalSoulPath()}`;
  return sanitizeSoulForDisplay(content);
}

export function resolveEditorCommand(platform = process.platform, env = process.env): string {
  const configured = env.VISUAL || env.EDITOR;
  if (configured && configured.trim()) return configured;
  if (platform === 'win32') return 'notepad';
  if (platform === 'darwin') return 'open -W -t';
  return 'vi';
}

export async function editSoulFile(editorCommand = resolveEditorCommand()): Promise<number | null> {
  const soulPath = getCanonicalSoulPath();
  fs.mkdirSync(path.dirname(soulPath), { recursive: true });
  if (!fs.existsSync(soulPath)) fs.writeFileSync(soulPath, '');

  return await new Promise((resolve, reject) => {
    const child = spawn(editorCommand, [soulPath], {
      stdio: 'inherit',
      shell: true,
      windowsVerbatimArguments: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}
