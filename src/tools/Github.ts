import type { Tool } from './Registry.js';

export const githubTools: Tool[] = [
  {
    name: 'gh_pr_create',
    description: 'Create a GitHub pull request.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'PR title' },
        body: { type: 'string', description: 'PR body/description' },
        base: { type: 'string', description: 'Base branch (default: main)' },
      },
      required: ['title'],
    },
    async execute(args) {
      const { execSync } = await import('child_process');
      const title = args.title as string;
      const body = (args.body as string) || '';
      const base = (args.base as string) || 'main';
      try {
        const out = execSync(`gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --base ${base} 2>&1`, { encoding: 'utf8', timeout: 30000 });
        return `PR created:\n${out}`;
      } catch (e: any) {
        return `Failed to create PR: ${(e.stderr || e.message).slice(0, 1000)}`;
      }
    },
  },
  {
    name: 'gh_issue_create',
    description: 'Create a GitHub issue.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body' },
        labels: { type: 'string', description: 'Comma-separated labels' },
      },
      required: ['title'],
    },
    async execute(args) {
      const { execSync } = await import('child_process');
      const title = args.title as string;
      const body = (args.body as string) || '';
      const labels = args.labels ? `--label "${args.labels}"` : '';
      try {
        const out = execSync(`gh issue create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" ${labels} 2>&1`, { encoding: 'utf8', timeout: 30000 });
        return `Issue created:\n${out}`;
      } catch (e: any) {
        return `Failed to create issue: ${(e.stderr || e.message).slice(0, 1000)}`;
      }
    },
  },
  {
    name: 'gh_pr_list',
    description: 'List open pull requests.',
    parameters: {
      type: 'object',
      properties: {
        state: { type: 'string', description: 'open, closed, or all (default: open)' },
      },
    },
    async execute(args) {
      const { execSync } = await import('child_process');
      const state = (args.state as string) || 'open';
      try {
        return execSync(`gh pr list --state ${state} 2>&1`, { encoding: 'utf8', timeout: 15000 });
      } catch (e: any) {
        return `Failed to list PRs: ${e.message}`;
      }
    },
  },
  {
    name: 'gh_repo_info',
    description: 'Get repository information.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/repo (default: current repo)' },
      },
    },
    async execute(args) {
      const { execSync } = await import('child_process');
      const repo = args.repo ? `-R ${args.repo}` : '';
      try {
        return execSync(`gh repo view ${repo} 2>&1`, { encoding: 'utf8', timeout: 15000 });
      } catch (e: any) {
        return `Failed to get repo info: ${e.message}`;
      }
    },
  },
];
