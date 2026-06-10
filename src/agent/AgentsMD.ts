import fs from 'fs';
import path from 'path';
import os from 'os';

const GLOBAL_AGENTS_MD = path.join(os.homedir(), '.aurix', 'AGENTS.md');
const MAX_SIZE = 32 * 1024;

export interface AgentsMD {
  global: string;
  project: string;
  combined: string;
}

export function loadAgentsMD(projectDir?: string): AgentsMD {
  let global = '';
  let project = '';

  if (fs.existsSync(GLOBAL_AGENTS_MD)) {
    global = fs.readFileSync(GLOBAL_AGENTS_MD, 'utf-8').slice(0, MAX_SIZE);
  }

  const dir = projectDir || process.cwd();
  project = collectProjectAgentsMD(dir);

  const combined = [
    global ? `# Global Instructions (from ~/.aurix/AGENTS.md)\n${global}` : '',
    project ? `# Project Instructions (from AGENTS.md files)\n${project}` : '',
  ].filter(Boolean).join('\n\n');

  return { global, project, combined };
}

function collectProjectAgentsMD(dir: string): string {
  const parts: string[] = [];
  let current = path.resolve(dir);
  const root = path.parse(current).root;

  while (current !== root) {
    const agentsFile = path.join(current, 'AGENTS.md');
    if (fs.existsSync(agentsFile)) {
      const content = fs.readFileSync(agentsFile, 'utf-8');
      if (content.trim()) {
        parts.unshift(content.trim());
      }
    }

    const aurixFile = path.join(current, '.aurix', 'AGENTS.md');
    if (fs.existsSync(aurixFile)) {
      const content = fs.readFileSync(aurixFile, 'utf-8');
      if (content.trim()) {
        parts.unshift(content.trim());
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const joined = parts.join('\n\n---\n\n');
  return joined.slice(0, MAX_SIZE);
}

export function saveGlobalAgentsMD(content: string): void {
  const dir = path.dirname(GLOBAL_AGENTS_MD);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(GLOBAL_AGENTS_MD, content);
}
