import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Tool } from './Registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SKILLS_DIR = path.resolve(__dirname, '../../skills');

interface SkillMeta {
  name: string;
  description: string;
  dir: string;
}

let cachedIndex: SkillMeta[] | null = null;

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
      });
    } catch {}
  }

  cachedIndex = skills;
  return skills;
}

function searchSkills(query: string): SkillMeta[] {
  const index = buildIndex();
  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);

  return index
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
        description: 'Action: search (find skills by keyword), load (read full skill content), list (show all available skills)',
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
        const lines = results.map(s => `- **${s.name}**: ${s.description}`);
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
        const index = buildIndex();
        const page = Math.max(1, (args.page as number) || 1);
        const perPage = 50;
        const totalPages = Math.ceil(index.length / perPage);
        const start = (page - 1) * perPage;
        const slice = index.slice(start, start + perPage);

        const lines = slice.map(s => `- **${s.name}**: ${s.description.slice(0, 100)}${s.description.length > 100 ? '...' : ''}`);
        return `Multiversal Skills (page ${page}/${totalPages}, ${index.length} total):\n\n${lines.join('\n')}\n\nUse \`skill_loader search <query>\` to find relevant skills, or \`skill_loader load <name>\` to read full instructions.`;
      }

      default:
        return `Unknown action "${action}". Use: search, load, or list`;
    }
  },
};
