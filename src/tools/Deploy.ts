import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { promisify } from 'util';
import type { Tool } from './Registry.js';

const execFileAsync = promisify(execFile);

export const deployTools: Tool[] = [
  {
    name: 'deploy_vercel',
    description: 'Deploy a project to Vercel. Requires vercel CLI installed and authenticated.',
    parameters: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Project directory (default: current)' },
        prod: { type: 'boolean', description: 'Deploy to production (default: false = preview)' },
      },
    },
    async execute(args) {
      const dir = resolve(String(args.directory || '.'));
      if (!existsSync(dir)) return `Deployment failed: directory does not exist: ${dir}`;
      if (!(await commandExists('vercel'))) {
        return 'Deployment failed: vercel CLI is not installed or not on PATH. Install and authenticate it first, then retry.';
      }

      const argv = ['deploy', '--yes'];
      if (args.prod) argv.push('--prod');

      try {
        const output = await runVercel(argv, dir, 120000);
        return `Deployment complete:\n${output}`;
      } catch (e: any) {
        return `Deployment failed:\n${e.message.slice(0, 2000)}`;
      }
    },
  },
  {
    name: 'deploy_github_pages',
    description: 'Deploy a static site to GitHub Pages.',
    parameters: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Build output directory (default: dist)' },
      },
    },
    async execute(args) {
      const dir = String(args.directory || 'dist');
      return `To deploy to GitHub Pages:\n\n\`\`\`bash\n# 1. Build your project\nnpm run build\n\n# 2. Deploy (using gh-pages)\nnpx gh-pages -d ${dir}\n\n# Or use GitHub Actions:\n# Create .github/workflows/deploy.yml\n\`\`\``;
    },
  },
  {
    name: 'setup_ci',
    description: 'Generate a GitHub Actions CI/CD workflow file.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Workflow type: node, python, deploy' },
        node_version: { type: 'string', description: 'Node.js version (default: 20)' },
      },
      required: ['type'],
    },
    async execute(args) {
      const type = args.type as string;
      const nodeVer = (args.node_version as string) || '20';

      if (type === 'node') {
        return `name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '${nodeVer}'\n          cache: 'npm'\n      - run: npm ci\n      - run: npm run build\n      - run: npm test`;
      }

      if (type === 'deploy') {
        return `name: Deploy\n\non:\n  push:\n    branches: [main]\n\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '${nodeVer}'\n          cache: 'npm'\n      - run: npm ci\n      - run: npm run build\n      - name: Deploy to Vercel\n        uses: amondnet/vercel-action@v25\n        with:\n          vercel-token: \${{ secrets.VERCEL_TOKEN }}\n          vercel-org-id: \${{ secrets.ORG_ID }}\n          vercel-project-id: \${{ secrets.PROJECT_ID }}\n          vercel-args: '--prod'`;
      }

      return `# CI workflow for ${type}\n# Customize the steps for your project.`;
    },
  },
  {
    name: 'deploy_status',
    description: 'Check deployment status for Vercel or other platforms.',
    parameters: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'vercel, netlify, or cloudflare' },
      },
    },
    async execute(args) {
      const platform = (args.platform as string) || 'vercel';
      if (platform === 'vercel') {
        if (!(await commandExists('vercel'))) {
          return 'Could not check Vercel status: vercel CLI is not installed or not on PATH.';
        }
        try {
          return await runVercel(['ls'], process.cwd(), 30000);
        } catch (e: any) {
          return `Could not check Vercel status: ${e.message}\nMake sure vercel CLI is installed and authenticated.`;
        }
      }
      return `Status check for ${platform} not yet implemented.`;
    },
  },
];

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['--version'], { encoding: 'utf8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function runVercel(args: string[], cwd: string, timeout: number): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('vercel', args, {
      cwd,
      encoding: 'utf8',
      timeout,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, CI: '1' },
    });
    return [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)';
  } catch (e: any) {
    throw new Error(String(e.stderr || e.stdout || e.message || e));
  }
}
