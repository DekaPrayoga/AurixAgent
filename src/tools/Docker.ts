import type { Tool } from './Registry.js';

export const dockerTool: Tool = {
  name: 'docker_manage',
  description: 'Manage Docker containers, images, and volumes.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'ps, images, build, run, stop, rm, logs, compose-up, compose-down' },
      name: { type: 'string', description: 'Container or image name' },
      image: { type: 'string', description: 'Image for run action (e.g. nginx:latest)' },
      port: { type: 'string', description: 'Port mapping for run (e.g. "8080:80")' },
      file: { type: 'string', description: 'Compose file path (default: docker-compose.yml)' },
    },
    required: ['action'],
  },
  async execute(args) {
    const { execSync } = await import('child_process');
    const action = args.action as string;
    const name = args.name as string;
    const run = (cmd: string) => {
      try {
        return execSync(cmd, { encoding: 'utf8', timeout: 60000, stdio: 'pipe' });
      } catch (e: any) {
        return `Error: ${(e.stderr || e.message).slice(0, 1000)}`;
      }
    };

    switch (action) {
      case 'ps': return run('docker ps --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"');
      case 'images': return run('docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"');
      case 'build': return run(`docker build -t ${name || 'app'} .`);
      case 'run': {
        const image = args.image || name || 'nginx:latest';
        const port = args.port ? `-p ${args.port}` : '';
        return run(`docker run -d ${port} --name ${name || 'container'} ${image}`);
      }
      case 'stop': return run(`docker stop ${name}`);
      case 'rm': return run(`docker rm -f ${name}`);
      case 'logs': return run(`docker logs --tail 50 ${name}`);
      case 'compose-up': return run(`docker compose -f ${args.file || 'docker-compose.yml'} up -d`);
      case 'compose-down': return run(`docker compose -f ${args.file || 'docker-compose.yml'} down`);
      default: return `Unknown action: ${action}`;
    }
  },
};
