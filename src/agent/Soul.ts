import fs from 'fs';
import os from 'os';
import path from 'path';

export const SOUL_FILE_NAME = 'SOUL.md';

export function getSoulPath(): string {
  return path.join(os.homedir(), '.aurix', SOUL_FILE_NAME);
}

export function loadSoul(): string {
  try {
    return fs.readFileSync(getSoulPath(), 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}
