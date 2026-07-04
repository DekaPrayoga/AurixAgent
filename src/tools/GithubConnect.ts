import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool } from './Registry.js';

const GITHUB_CONFIG_DIR = path.join(os.homedir(), '.aurix', 'github');
const GITHUB_TOKEN_FILE = path.join(GITHUB_CONFIG_DIR, 'token');
const GITHUB_REPOS_FILE = path.join(GITHUB_CONFIG_DIR, 'repos.json');

function ensureDirs(): void {
  if (!fs.existsSync(GITHUB_CONFIG_DIR)) fs.mkdirSync(GITHUB_CONFIG_DIR, { recursive: true });
}

export function getToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (fs.existsSync(GITHUB_TOKEN_FILE)) {
    return fs.readFileSync(GITHUB_TOKEN_FILE, 'utf-8').trim();
  }
  return undefined;
}

function saveToken(token: string): void {
  ensureDirs();
  fs.writeFileSync(GITHUB_TOKEN_FILE, token, { mode: 0o600 });
}

export function getConnectedRepos(): { owner: string; repo: string; connectedAt: string }[] {
  try {
    if (fs.existsSync(GITHUB_REPOS_FILE)) {
      return JSON.parse(fs.readFileSync(GITHUB_REPOS_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function saveConnectedRepos(repos: { owner: string; repo: string; connectedAt: string }[]): void {
  ensureDirs();
  fs.writeFileSync(GITHUB_REPOS_FILE, JSON.stringify(repos, null, 2));
}

export async function ghApi(endpoint: string, method = 'GET', body?: any): Promise<any> {
  const token = getToken();
  if (!token) throw new Error('No GitHub token. Use /github connect first.');

  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 500)}`);
  }

  return res.json();
}

export const githubTools: Tool[] = [
  {
    name: 'github_connect',
    description: 'Connect a GitHub account and repository. Store token and track the repo.',
    parameters: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'GitHub Personal Access Token (PAT)' },
        repo: { type: 'string', description: 'Repository in owner/repo format' },
      },
    },
    async execute(args) {
      ensureDirs();
      if (args.token) {
        saveToken(args.token as string);
      }

      const token = getToken();
      if (!token) {
        return `No token set.\n\nGet a PAT at: https://github.com/settings/tokens\n\nThen run: /github connect --token <your-token>`;
      }

      try {
        const user = await ghApi('/user');
        const repos = getConnectedRepos();

        if (args.repo) {
          const [owner, repo] = (args.repo as string).split('/');
          if (!owner || !repo) return 'Repo format: owner/repo';

          if (!repos.find((r) => r.owner === owner && r.repo === repo)) {
            repos.push({ owner, repo, connectedAt: new Date().toISOString() });
            saveConnectedRepos(repos);
          }

          const repoData = await ghApi(`/repos/${owner}/${repo}`);
          return `Connected to GitHub as ${user.login}\nRepo: ${owner}/${repo}\n  Stars: ${repoData.stargazers_count}\n  Forks: ${repoData.forks_count}\n  Language: ${repoData.language}\n  Default branch: ${repoData.default_branch}`;
        }

        return `Connected to GitHub as ${user.login}\nConnected repos: ${repos.length}\n\nUse /github connect --repo owner/repo to track a repository.`;
      } catch (e: any) {
        return `GitHub connection error: ${e.message}`;
      }
    },
  },
  {
    name: 'github_pr',
    description: 'Create, list, view, or review GitHub pull requests.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'create, list, view, diff, merge' },
        repo: { type: 'string', description: 'owner/repo (default: last connected)' },
        number: { type: 'number', description: 'PR number (for view/diff/merge)' },
        title: { type: 'string', description: 'PR title (for create)' },
        body: { type: 'string', description: 'PR body (for create)' },
        head: { type: 'string', description: 'Head branch (for create)' },
        base: { type: 'string', description: 'Base branch (for create, default: main)' },
      },
      required: ['action'],
    },
    async execute(args) {
      const action = args.action as string;
      const repos = getConnectedRepos();
      const repo = (args.repo as string) || (repos[0] ? `${repos[0].owner}/${repos[0].repo}` : '');
      if (!repo) return 'No repo connected. Use /github connect first.';

      try {
        switch (action) {
          case 'list': {
            const prs = await ghApi(`/repos/${repo}/pulls?state=open&per_page=10`);
            if (!prs.length) return 'No open PRs.';
            return prs
              .map(
                (pr: any) =>
                  `#${pr.number} ${pr.title}\n  by ${pr.user.login} | ${pr.head.ref} -> ${pr.base.ref} | ${pr.comments} comments`
              )
              .join('\n\n');
          }

          case 'view': {
            const num = args.number as number;
            if (!num) return 'Provide PR number.';
            const pr = await ghApi(`/repos/${repo}/pulls/${num}`);
            return `#${pr.number} ${pr.title}\n  State: ${pr.state}\n  Author: ${pr.user.login}\n  Branch: ${pr.head.ref} -> ${pr.base.ref}\n  Commits: ${pr.commits} | Files: ${pr.changed_files} | +${pr.additions}/-${pr.deletions}\n\n${pr.body || 'No description'}`;
          }

          case 'create': {
            const title = args.title as string;
            const head = args.head as string;
            if (!title || !head) return 'Provide title and head branch.';
            const pr = await ghApi(`/repos/${repo}/pulls`, 'POST', {
              title,
              body: args.body || '',
              head,
              base: (args.base as string) || 'main',
            });
            return `PR created: #${pr.number} ${pr.title}\n${pr.html_url}`;
          }

          case 'diff': {
            const num = args.number as number;
            if (!num) return 'Provide PR number.';
            const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${num}`, {
              headers: {
                Authorization: `Bearer ${getToken()}`,
                Accept: 'application/vnd.github.v3.diff',
              },
            });
            const diff = await res.text();
            return diff.slice(0, 5000);
          }

          case 'merge': {
            const num = args.number as number;
            if (!num) return 'Provide PR number.';
            const result = await ghApi(`/repos/${repo}/pulls/${num}/merge`, 'PUT', {
              merge_method: 'squash',
            });
            return result.merged ? `PR #${num} merged!` : `Merge failed: ${result.message}`;
          }

          default:
            return `Unknown action: ${action}. Use: list, view, create, diff, merge`;
        }
      } catch (e: any) {
        return `GitHub error: ${e.message}`;
      }
    },
  },
  {
    name: 'github_issue',
    description: 'Create, list, or manage GitHub issues.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'create, list, view, close, comment' },
        repo: { type: 'string', description: 'owner/repo' },
        number: { type: 'number', description: 'Issue number' },
        title: { type: 'string', description: 'Issue title (for create)' },
        body: { type: 'string', description: 'Issue body' },
        labels: { type: 'string', description: 'Comma-separated labels' },
      },
      required: ['action'],
    },
    async execute(args) {
      const action = args.action as string;
      const repos = getConnectedRepos();
      const repo = (args.repo as string) || (repos[0] ? `${repos[0].owner}/${repos[0].repo}` : '');
      if (!repo) return 'No repo connected. Use /github connect first.';

      try {
        switch (action) {
          case 'list': {
            const issues = await ghApi(`/repos/${repo}/issues?state=open&per_page=10`);
            return (
              issues
                .filter((i: any) => !i.pull_request)
                .map(
                  (i: any) =>
                    `#${i.number} ${i.title}\n  by ${i.user.login} | labels: ${(i.labels || []).map((l: any) => l.name).join(', ') || 'none'}`
                )
                .join('\n\n') || 'No open issues.'
            );
          }

          case 'create': {
            const title = args.title as string;
            if (!title) return 'Provide issue title.';
            const body: any = { title, body: args.body || '' };
            if (args.labels) {
              body.labels = (args.labels as string).split(',').map((l) => l.trim());
            }
            const issue = await ghApi(`/repos/${repo}/issues`, 'POST', body);
            return `Issue created: #${issue.number} ${issue.title}\n${issue.html_url}`;
          }

          case 'view': {
            const num = args.number as number;
            if (!num) return 'Provide issue number.';
            const issue = await ghApi(`/repos/${repo}/issues/${num}`);
            return `#${issue.number} ${issue.title}\n  State: ${issue.state}\n  Author: ${issue.user.login}\n  Labels: ${(issue.labels || []).map((l: any) => l.name).join(', ') || 'none'}\n\n${issue.body || 'No description'}`;
          }

          case 'close': {
            const num = args.number as number;
            if (!num) return 'Provide issue number.';
            await ghApi(`/repos/${repo}/issues/${num}`, 'PATCH', { state: 'closed' });
            return `Issue #${num} closed.`;
          }

          case 'comment': {
            const num = args.number as number;
            const body = args.body as string;
            if (!num || !body) return 'Provide issue number and comment body.';
            await ghApi(`/repos/${repo}/issues/${num}/comments`, 'POST', { body });
            return `Comment added to issue #${num}.`;
          }

          default:
            return `Unknown action: ${action}. Use: list, create, view, close, comment`;
        }
      } catch (e: any) {
        return `GitHub error: ${e.message}`;
      }
    },
  },
  {
    name: 'github_search',
    description: 'Search GitHub code, repos, and issues globally.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: { type: 'string', description: 'code, repos, or issues (default: repos)' },
        language: { type: 'string', description: 'Filter by language' },
      },
      required: ['query'],
    },
    async execute(args) {
      const query = args.query as string;
      const type = (args.type as string) || 'repos';
      const language = args.language as string | undefined;

      try {
        let searchQuery = query;
        if (language) searchQuery += `+language:${language}`;

        if (type === 'code') {
          const results = await ghApi(
            `/search/code?q=${encodeURIComponent(searchQuery)}&per_page=5`
          );
          return (
            results.items
              ?.map((r: any) => `${r.repository.full_name} — ${r.path}\n  ${r.html_url}`)
              .join('\n\n') || 'No results.'
          );
        }

        if (type === 'issues') {
          const results = await ghApi(
            `/search/issues?q=${encodeURIComponent(searchQuery + ' is:issue')}&per_page=5`
          );
          return (
            results.items
              ?.map(
                (r: any) =>
                  `#${r.number} ${r.title}\n  ${r.repository_url.split('/').slice(-2).join('/')} | ${r.state} | ${r.html_url}`
              )
              .join('\n\n') || 'No results.'
          );
        }

        const results = await ghApi(
          `/search/repositories?q=${encodeURIComponent(searchQuery)}&per_page=5`
        );
        return (
          results.items
            ?.map(
              (r: any) =>
                `${r.full_name} (${r.stargazers_count} stars)\n  ${r.description || 'No description'}\n  Language: ${r.language} | ${r.html_url}`
            )
            .join('\n\n') || 'No results.'
        );
      } catch (e: any) {
        return `GitHub search error: ${e.message}`;
      }
    },
  },
];
