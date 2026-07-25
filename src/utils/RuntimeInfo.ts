import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type RuntimeKind = 'bun' | 'node';

export interface RuntimeInfo {
  kind: RuntimeKind;
  version: string;
  managed: boolean;
  label: string;
}

let cachedPackageVersion: string | undefined;

function cleanVersion(value?: string): string {
  return value?.trim().replace(/^v/, '') || '';
}

export function getAurixVersion(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AURIX_VERSION) return env.AURIX_VERSION;
  if (cachedPackageVersion) return cachedPackageVersion;

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDir, '..', '..', 'package.json'),
    path.resolve(env.AURIX_HOME || '', 'package.json'),
  ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (pkg.name === 'aurix-ai' && typeof pkg.version === 'string') {
        cachedPackageVersion = pkg.version;
        return pkg.version;
      }
    } catch {}
  }
  return 'dev';
}

export function getRuntimeInfo(
  env: NodeJS.ProcessEnv = process.env,
  versions: NodeJS.ProcessVersions = process.versions
): RuntimeInfo {
  const explicitKind = env.AURIX_RUNTIME_KIND === 'bun' ? 'bun' : env.AURIX_RUNTIME_KIND === 'node' ? 'node' : undefined;
  const kind: RuntimeKind = explicitKind || (versions.bun ? 'bun' : 'node');
  const version = cleanVersion(env.AURIX_RUNTIME_VERSION) || cleanVersion(kind === 'bun' ? versions.bun : versions.node);
  const managed = kind === 'node' && env.AURIX_RUNTIME_MANAGED === '1';
  const name = kind === 'bun' ? 'Bun' : 'Node';
  const suffix = managed ? ' (managed)' : '';

  return {
    kind,
    version,
    managed,
    label: `${name}${version ? ` ${version}` : ''}${suffix}`,
  };
}
