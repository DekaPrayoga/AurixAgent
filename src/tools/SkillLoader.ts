import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Tool } from './Registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SKILLS_DIR = path.resolve(__dirname, '../../skills');

const CORE_SKILLS = new Set([
  'core', 'browser-qa', 'coding-standards', 'git-workflow', 'github',
  'tdd-workflow', 'security-review', 'deep-research', 'planning',
  'dev', 'qa', 'backend', 'frontend',
]);

interface SkillMeta {
  name: string;
  description: string;
  dir: string;
  isCore: boolean;
}

let cachedIndex: SkillMeta[] | null = null;
let skillLimit: number | null = null;

function buildIndex(): SkillMeta[] {
  if (cachedIndex) return cachedIndex;

  const skills: SkillMeta[] = [];

  if (!fs.existsSync(SKILLS_DIR)) {
    cachedIndex = skills;
    return skills;
  }

  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillMd = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;

    try {
      const content = fs.readFileSync(skillMd, 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      const fm = fmMatch[1];
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      const descMatch = fm.match(/^description:\s*(.+)$/m);

      skills.push({
        name: nameMatch?.[1]?.trim() || entry.name,
        description: descMatch?.[1]?.trim() || '',
        dir: entry.name,
        isCore: CORE_SKILLS.has(entry.name),
      });
    } catch {}
  }

  cachedIndex = skills;
  return skills;
}

function getVisibleSkills(): SkillMeta[] {
  const all = buildIndex();
  const core = all.filter(s => s.isCore);
  const additional = all.filter(s => !s.isCore);

  if (skillLimit === null || skillLimit === 0) return all;

  const limited = additional.slice(0, skillLimit);
  return [...core, ...limited];
}

export function setSkillLimit(n: number | null): void {
  skillLimit = n;
}

export function getSkillLimit(): number | null {
  return skillLimit;
}

export function getSkillCounts(): { core: number; additional: number; visible: number; total: number } {
  const all = buildIndex();
  const core = all.filter(s => s.isCore).length;
  const additional = all.filter(s => !s.isCore).length;
  const visible = getVisibleSkills().length;
  return { core, additional, visible, total: all.length };
}

function searchSkills(query: string): SkillMeta[] {
  const visible = getVisibleSkills();
  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);

  return visible
    .filter(s => {
      const haystack = `${s.name} ${s.description} ${s.dir}`.toLowerCase();
      return terms.every(t => haystack.includes(t));
    })
    .sort((a, b) => {
      const aName = a.name.toLowerCase().includes(q) ? 0 : 1;
      const bName = b.name.toLowerCase().includes(q) ? 0 : 1;
      return aName - bName;
    });
}

function loadSkill(name: string): string | null {
  const index = buildIndex();
  const skill = index.find(s => s.name === name || s.dir === name);
  if (!skill) return null;

  const skillMd = path.join(SKILLS_DIR, skill.dir, 'SKILL.md');
  try {
    return fs.readFileSync(skillMd, 'utf-8');
  } catch {
    return null;
  }
}

export const skillLoaderTool: Tool = {
  name: 'skill_loader',
  description: 'Search and load Multiversal skills — curated engineering workflows for TDD, security, architecture, deployment, research, and more. Use to find relevant skills for a task, or load a specific skill\'s full instructions.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action: search (find skills by keyword), load (read full skill content), list (show available skills), limit (set skill count limit), status (show current limit and counts)',
      },
      query: {
        type: 'string',
        description: 'Search query for finding skills (used with search action)',
      },
      name: {
        type: 'string',
        description: 'Skill name to load (used with load action)',
      },
      page: {
        type: 'number',
        description: 'Page number for list action (50 skills per page, default 1)',
      },
      value: {
        type: 'number',
        description: 'Number of additional skills to allow (used with limit action, 0 = no limit)',
      },
    },
    required: ['action'],
  },
  async execute(args) {
    const action = args.action as string;

    switch (action) {
      case 'search': {
        const query = args.query as string;
        if (!query) return 'Error: provide a search query';
        const results = searchSkills(query);
        if (!results.length) return `No skills found matching "${query}"`;
        const lines = results.map(s => `- **${s.name}**${s.isCore ? ' [core]' : ''}: ${s.description}`);
        return `Found ${results.length} skill(s) matching "${query}":\n\n${lines.join('\n')}\n\nUse \`skill_loader load <name>\` to read the full skill instructions.`;
      }

      case 'load': {
        const name = args.name as string;
        if (!name) return 'Error: provide a skill name to load';
        const content = loadSkill(name);
        if (!content) return `Skill "${name}" not found. Use search to find available skills.`;
        return content;
      }

      case 'list': {
        const visible = getVisibleSkills();
        const page = Math.max(1, (args.page as number) || 1);
        const perPage = 50;
        const totalPages = Math.ceil(visible.length / perPage);
        const start = (page - 1) * perPage;
        const slice = visible.slice(start, start + perPage);

        const lines = slice.map(s => `- **${s.name}**${s.isCore ? ' [core]' : ''}: ${s.description.slice(0, 100)}${s.description.length > 100 ? '...' : ''}`);
        const limitInfo = skillLimit !== null && skillLimit > 0
          ? ` (limit: ${skillLimit} additional + ${getSkillCounts().core} core)`
          : ' (no limit)';
        return `Multiversal Skills (page ${page}/${totalPages}, ${visible.length} visible${limitInfo}):\n\n${lines.join('\n')}\n\nUse \`skill_loader search <query>\` to find skills, or \`skill_loader load <name>\` to read full instructions.`;
      }

      case 'limit': {
        const value = args.value as number;
        if (value === undefined || value === null) {
          return `Current skill limit: ${skillLimit === null ? 'no limit (all skills visible)' : `${skillLimit} additional skills`}\nUse \`skill_loader limit value=<number>\` to set, or value=0 for no limit.`;
        }
        setSkillLimit(value === 0 ? null : value);
        const counts = getSkillCounts();
        if (value === 0) {
          return `Skill limit removed. All ${counts.total} skills are now visible.`;
        }
        return `Skill limit set to ${value} additional skills (+ ${counts.core} core = ${counts.core + value} visible out of ${counts.total} total).`;
      }

      case 'status': {
        const counts = getSkillCounts();
        const limitStr = skillLimit === null ? 'no limit' : `${skillLimit} additional`;
        return `Skill status:\n  Total skills: ${counts.total}\n  Core (always active): ${counts.core}\n  Additional: ${counts.additional}\n  Visible: ${counts.visible}\n  Limit: ${limitStr}\n\nCore skills: ${Array.from(CORE_SKILLS).join(', ')}`;
      }

      default:
        return `Unknown action "${action}". Use: search, load, list, limit, or status`;
    }
  },
};
