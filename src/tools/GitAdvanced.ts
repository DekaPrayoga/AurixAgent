import type { Tool } from './Registry.js';
import { getToken, getConnectedRepos, ghApi } from './GithubConnect.js';
import { execSync } from 'child_process';

function getDefaultRepo(): string {
  const repos = getConnectedRepos();
  if (repos[0]) return `${repos[0].owner}/${repos[0].repo}`;
  try {
    const remote = execSync('git remote get-url origin 2>/dev/null', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    const match = remote.match(/github\.com[/:](.+?\/.+?)(\.git)?$/);
    if (match) return match[1];
  } catch {}
  return '';
}

function runGit(args: string, cwd?: string): string {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', timeout: 30000, cwd }).trim();
  } catch (e: any) {
    throw new Error(e.stderr || e.message || 'git command failed');
  }
}

export const gitAdvancedTool: Tool = {
  name: 'git_advanced',
  description: `Advanced Git workflow: branches, PR reviews, releases, merge conflicts, CI actions, and contributor stats.
Actions:
- branch: create, switch, list, delete, merge (local git operations)
- pr-review: approve, changes, comment (GitHub PR review)
- release: create (tag + GitHub release), list
- merge-conflict: detect, show (list conflicting files with diffs), abort
- actions: list (workflow runs), status (latest CI status)
- stats: contributors, activity (repo analytics)`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action group: branch, pr-review, release, merge-conflict, actions, stats',
      },
      sub_action: {
        type: 'string',
        description:
          'Sub-action — depends on action. branch: create|switch|list|delete|merge. pr-review: approve|changes|comment. release: create|list. merge-conflict: detect|show|abort. actions: list|status. stats: contributors|activity.',
      },
      name: { type: 'string', description: 'Branch name (for branch create/switch/delete/merge)' },
      base: { type: 'string', description: 'Base branch (default: current). Also for PR base.' },
      repo: {
        type: 'string',
        description: 'Repository as owner/repo (default: connected or git remote)',
      },
      pr_number: { type: 'number', description: 'PR number (for pr-review)' },
      review_body: { type: 'string', description: 'Review comment body' },
      tag: { type: 'string', description: 'Tag name e.g. v1.0.0 (for release create)' },
      release_name: { type: 'string', description: 'Release title (for release create)' },
      release_body: { type: 'string', description: 'Release notes (for release create)' },
      draft: { type: 'boolean', description: 'Create as draft release?' },
      prerelease: { type: 'boolean', description: 'Mark as pre-release?' },
      workflow: { type: 'string', description: 'Workflow filename/ID (for actions status)' },
      branch_filter: { type: 'string', description: 'Filter by branch (for actions)' },
      force: { type: 'boolean', description: 'Force delete branch?' },
    },
    required: ['action'],
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = (args.action as string)?.toLowerCase() || '';
    const sub = (args.sub_action as string)?.toLowerCase() || '';
    const repo = (args.repo as string) || getDefaultRepo();
    const token = getToken();

    // ─── BRANCH ────────────────────────────────────────────────────────
    if (action === 'branch') {
      try {
        switch (sub) {
          case 'create': {
            const name = args.name as string;
            if (!name)
              return 'Usage: git_advanced action=branch sub_action=create name=<branch> [base=main]';
            const base = (args.base as string) || 'HEAD';
            runGit(`checkout -b ${name} ${base}`);
            return `Branch "${name}" created from ${base} and checked out.`;
          }
          case 'switch': {
            const name = args.name as string;
            if (!name) return 'Usage: git_advanced action=branch sub_action=switch name=<branch>';
            runGit(`checkout ${name}`);
            return `Switched to branch "${name}".`;
          }
          case 'list': {
            const out = runGit('branch -a --sort=-committerdate');
            return `Branches:\n${out
              .split('\n')
              .slice(0, 30)
              .map((l) => `  ${l.trim()}`)
              .join('\n')}`;
          }
          case 'delete': {
            const name = args.name as string;
            if (!name) return 'Usage: git_advanced action=branch sub_action=delete name=<branch>';
            runGit(`branch ${args.force ? '-D' : '-d'} ${name}`);
            return `Branch "${name}" deleted.`;
          }
          case 'merge': {
            const name = args.name as string;
            if (!name) return 'Usage: git_advanced action=branch sub_action=merge name=<branch>';
            const out = runGit(`merge ${name}`);
            return out || `Merged "${name}" into current branch.`;
          }
          default:
            return `branch sub-actions: create, switch, list, delete, merge`;
        }
      } catch (e: any) {
        return `Git error: ${e.message}`;
      }
    }

    // ─── PR REVIEW ─────────────────────────────────────────────────────
    if (action === 'pr-review') {
      if (!token) return 'No GitHub token. Use github_connect first.';
      if (!repo) return 'No repo. Connect with github_connect or run from a git repo.';
      const prNum = args.pr_number as number;
      if (!prNum)
        return 'Usage: git_advanced action=pr-review sub_action=<approve|changes|comment> pr_number=<n>';

      try {
        const body = (args.review_body as string) || '';
        switch (sub) {
          case 'approve':
            await ghApi(`/repos/${repo}/pulls/${prNum}/reviews`, 'POST', {
              event: 'APPROVE',
              body: body || 'LGTM! Approved via Aurix Agent.',
            });
            return `PR #${prNum} approved.`;
          case 'changes':
            await ghApi(`/repos/${repo}/pulls/${prNum}/reviews`, 'POST', {
              event: 'REQUEST_CHANGES',
              body: body || 'Requesting changes.',
            });
            return `PR #${prNum}: changes requested.`;
          case 'comment':
            if (!body) return 'Provide review_body.';
            await ghApi(`/repos/${repo}/pulls/${prNum}/reviews`, 'POST', {
              event: 'COMMENT',
              body,
            });
            return `Review comment posted on PR #${prNum}.`;
          default:
            return `pr-review sub-actions: approve, changes, comment`;
        }
      } catch (e: any) {
        return `GitHub API error: ${e.message}`;
      }
    }

    // ─── RELEASE ───────────────────────────────────────────────────────
    if (action === 'release') {
      if (!token) return 'No GitHub token. Use github_connect first.';
      if (!repo) return 'No repo.';

      try {
        switch (sub) {
          case 'create': {
            const tag = args.tag as string;
            if (!tag)
              return 'Usage: git_advanced action=release sub_action=create tag=v1.0.0 [release_name=...] [release_body=...]';
            const name = (args.release_name as string) || tag;
            try {
              runGit(`tag ${tag} -m "${name}"`);
              runGit(`push origin ${tag}`);
            } catch {}
            const release = await ghApi(`/repos/${repo}/releases`, 'POST', {
              tag_name: tag,
              name,
              body: (args.release_body as string) || '',
              draft: (args.draft as boolean) || false,
              prerelease: (args.prerelease as boolean) || false,
            });
            return `Release created: ${release.name}\nTag: ${release.tag_name}\nURL: ${release.html_url}`;
          }
          case 'list': {
            const releases = await ghApi(`/repos/${repo}/releases?per_page=10`);
            if (!releases.length) return 'No releases.';
            return releases
              .map(
                (r: any) =>
                  `${r.tag_name} ${r.name || ''} ${r.prerelease ? '[pre]' : ''} ${r.draft ? '[draft]' : ''}\n  ${new Date(r.published_at || r.created_at).toLocaleDateString()} | ${r.html_url}`
              )
              .join('\n\n');
          }
          default:
            return `release sub-actions: create, list`;
        }
      } catch (e: any) {
        return `Release error: ${e.message}`;
      }
    }

    // ─── MERGE CONFLICT ────────────────────────────────────────────────
    if (action === 'merge-conflict') {
      try {
        switch (sub) {
          case 'detect': {
            const diffFiles = runGit('diff --name-only --diff-filter=U');
            if (!diffFiles) return 'No merge conflicts detected.';
            const files = diffFiles.split('\n').filter(Boolean);
            return `Merge conflicts in ${files.length} file(s):\n${files.map((f) => `  ✗ ${f}`).join('\n')}\n\nUse sub_action=show for diffs, sub_action=abort to cancel.`;
          }
          case 'show': {
            const diff = runGit('diff --diff-filter=U');
            return diff.slice(0, 8000) || 'No diff. Try detect first.';
          }
          case 'abort': {
            const out = runGit('merge --abort 2>/dev/null; git rebase --abort 2>/dev/null');
            return out || 'Merge/rebase aborted.';
          }
          default:
            return `merge-conflict sub-actions: detect, show, abort`;
        }
      } catch (e: any) {
        return `Merge conflict error: ${e.message}`;
      }
    }

    // ─── ACTIONS / CI ──────────────────────────────────────────────────
    if (action === 'actions') {
      if (!token) return 'No GitHub token. Use github_connect first.';
      if (!repo) return 'No repo.';
      try {
        switch (sub) {
          case 'list': {
            const branch = (args.branch_filter as string) || '';
            const query = branch ? `?branch=${branch}&per_page=10` : '?per_page=10';
            const runs = await ghApi(`/repos/${repo}/actions/runs${query}`);
            if (!runs.workflow_runs?.length) return 'No workflow runs.';
            return runs.workflow_runs
              .map((r: any) => {
                const icon =
                  r.conclusion === 'success'
                    ? '✓'
                    : r.conclusion === 'failure'
                      ? '✗'
                      : r.status === 'in_progress'
                        ? '●'
                        : '○';
                return `${icon} #${r.run_number} ${r.name} — ${r.conclusion || r.status}\n  branch: ${r.head_branch} | ${new Date(r.created_at).toLocaleString()}\n  ${r.html_url}`;
              })
              .join('\n\n');
          }
          case 'status': {
            const branch = (args.branch_filter as string) || runGit('branch --show-current');
            const runs = await ghApi(`/repos/${repo}/actions/runs?branch=${branch}&per_page=1`);
            if (!runs.workflow_runs?.length) return `No CI runs for "${branch}".`;
            const r = runs.workflow_runs[0];
            const icon =
              r.conclusion === 'success' ? '✅' : r.conclusion === 'failure' ? '❌' : '🔄';
            return `${icon} "${branch}": #${r.run_number} ${r.name} — ${r.conclusion || r.status}\n${r.html_url}`;
          }
          default:
            return `actions sub-actions: list, status`;
        }
      } catch (e: any) {
        return `Actions error: ${e.message}`;
      }
    }

    // ─── STATS ─────────────────────────────────────────────────────────
    if (action === 'stats') {
      if (!token) return 'No GitHub token. Use github_connect first.';
      if (!repo) return 'No repo.';
      try {
        switch (sub) {
          case 'contributors': {
            const contribs = await ghApi(`/repos/${repo}/contributors?per_page=10`);
            if (!contribs.length) return 'No contributors.';
            return `Top contributors — ${repo}:\n${contribs
              .map((c: any, i: number) => `  ${i + 1}. ${c.login} — ${c.contributions} commits`)
              .join('\n')}`;
          }
          case 'activity': {
            const [rd, commits] = await Promise.all([
              ghApi(`/repos/${repo}`),
              ghApi(`/repos/${repo}/commits?per_page=1`),
            ]);
            const lc = commits[0];
            return `Repository: ${repo}\n  Stars: ${rd.stargazers_count} | Forks: ${rd.forks_count}\n  Open issues: ${rd.open_issues_count}\n  Language: ${rd.language}\n  Default branch: ${rd.default_branch}\n  Last: ${lc?.commit?.author?.name || '?'} — ${lc?.commit?.message?.split('\n')[0]?.slice(0, 80) || ''}\n  Updated: ${new Date(rd.updated_at).toLocaleString()}`;
          }
          default:
            return `stats sub-actions: contributors, activity`;
        }
      } catch (e: any) {
        return `Stats error: ${e.message}`;
      }
    }

    return (
      `Unknown action: "${action}". Available: branch, pr-review, release, merge-conflict, actions, stats\n` +
      `Usage: git_advanced action=<group> sub_action=<op> [params...]`
    );
  },
};
