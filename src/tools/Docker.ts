import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Tool } from './Registry.js';

const execFileAsync = promisify(execFile);
const DOCKER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const IMAGE_RE = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/;
const PORT_RE = /^\d{1,5}:\d{1,5}(?:\/(?:tcp|udp))?$/i;

export const dockerTool: Tool = {
  name: 'docker_manage',
  description:
    'Manage Docker containers, images, and volumes. Mutating actions require user approval.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'ps, images, build, run, stop, rm, logs, compose-up, compose-down',
      },
      name: { type: 'string', description: 'Container or image name' },
      image: { type: 'string', description: 'Image for run action (e.g. nginx:latest)' },
      port: { type: 'string', description: 'Port mapping for run (e.g. "8080:80")' },
      file: { type: 'string', description: 'Compose file path (default: docker-compose.yml)' },
    },
    required: ['action'],
  },
  async execute(args) {
    const action = String(args.action || '');
    const name = stringArg(args.name);

    if (!(await dockerAvailable())) {
      return 'Docker CLI is not available. Install Docker and make sure the `docker` command is on PATH.';
    }

    switch (action) {
      case 'ps':
        return runDocker(['ps', '--format', 'table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}']);
      case 'images':
        return runDocker(['images', '--format', 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}']);
      case 'build': {
        const tag = name || 'app';
        const invalid = validateImage(tag);
        if (invalid) return invalid;
        return runDocker(['build', '-t', tag, '.'], 120000);
      }
      case 'run': {
        const image = stringArg(args.image) || name || 'nginx:latest';
        const containerName = name || 'container';
        const invalidName = validateDockerName(containerName, 'container name');
        if (invalidName) return invalidName;
        const invalidImage = validateImage(image);
        if (invalidImage) return invalidImage;
        const runArgs = ['run', '-d'];
        const port = stringArg(args.port);
        if (port) {
          if (!PORT_RE.test(port)) return `Error: unsafe or invalid port mapping: ${port}`;
          runArgs.push('-p', port);
        }
        runArgs.push('--name', containerName, image);
        return runDocker(runArgs);
      }
      case 'stop': {
        const missing = requireName(name, action);
        if (missing) return missing;
        return runDocker(['stop', name]);
      }
      case 'rm': {
        const missing = requireName(name, action);
        if (missing) return missing;
        return runDocker(['rm', '-f', name]);
      }
      case 'logs': {
        const missing = requireName(name, action);
        if (missing) return missing;
        return runDocker(['logs', '--tail', '50', name]);
      }
      case 'compose-up':
        return runDocker(
          ['compose', '-f', stringArg(args.file) || 'docker-compose.yml', 'up', '-d'],
          120000
        );
      case 'compose-down':
        return runDocker(
          ['compose', '-f', stringArg(args.file) || 'docker-compose.yml', 'down'],
          120000
        );
      default:
        return `Unknown action: ${action}`;
    }
  },
};

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function dockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['--version'], { encoding: 'utf8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function runDocker(args: string[], timeout = 60000): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('docker', args, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 5 * 1024 * 1024,
    });
    return [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)';
  } catch (e: any) {
    const detail = e.stderr || e.stdout || e.message || String(e);
    return `Error: ${String(detail).slice(0, 1000)}`;
  }
}

function validateDockerName(value: string, label: string): string | null {
  if (!DOCKER_NAME_RE.test(value)) {
    return `Error: unsafe ${label}: ${value}. Use letters, numbers, dots, underscores, or dashes only.`;
  }
  return null;
}

function validateImage(value: string): string | null {
  if (!IMAGE_RE.test(value)) {
    return `Error: unsafe image name: ${value}.`;
  }
  return null;
}

function requireName(name: string, action: string): string | null {
  if (!name) return `Error: container name is required for docker ${action}.`;
  return validateDockerName(name, 'container name');
}
