import fs from 'fs';
import os from 'os';
import path from 'path';

export const SOUL_FILE_NAME = 'SOUL.md';

export function getSoulPath(): string {
  return path.join(os.homedir(), '.aurix', SOUL_FILE_NAME);
}

export function getSoulCandidates(): string[] {
  const names = ['SOUL.md', 'soul.md'];
  const roots = [process.cwd(), path.join(os.homedir(), '.aurix')];
  return roots.flatMap((root) => names.map((name) => path.join(root, name)));
}

export function loadSoul(): string {
  for (const candidate of getSoulCandidates()) {
    try {
      const content = fs.readFileSync(candidate, 'utf8');
      if (content.trim()) return content;
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
  }
  return '';
}
