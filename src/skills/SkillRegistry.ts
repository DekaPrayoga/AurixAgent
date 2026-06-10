import fs from 'fs';
import path from 'path';
import type { Tool } from '../tools/Registry.js';

export interface SkillDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  instructions: string;
  tools: Tool[];
  references?: string[];
  scripts?: string[];
}

export interface SkillCategory {
  id: string;
  name: string;
  description: string;
  skills: SkillDefinition[];
}

export class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();
  private categories = new Map<string, SkillCategory>();

  register(skill: SkillDefinition): void {
    this.skills.set(skill.id, skill);

    let cat = this.categories.get(skill.category);
    if (!cat) {
      cat = { id: skill.category, name: skill.category, description: '', skills: [] };
      this.categories.set(skill.category, cat);
    }
    cat.skills.push(skill);
  }

  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  list(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  listCategories(): SkillCategory[] {
    return Array.from(this.categories.values());
  }

  findByCategory(category: string): SkillDefinition[] {
    return this.list().filter(s => s.category === category);
  }

  findByTag(tag: string): SkillDefinition[] {
    return this.list().filter(s => s.tags.includes(tag));
  }

  search(query: string): SkillDefinition[] {
    const q = query.toLowerCase();
    return this.list().filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  getToolsForSkill(id: string): Tool[] {
    const skill = this.skills.get(id);
    return skill?.tools || [];
  }

  getAllTools(): Tool[] {
    const allTools: Tool[] = [];
    const seen = new Set<string>();
    for (const skill of this.skills.values()) {
      for (const tool of skill.tools) {
        if (!seen.has(tool.name)) {
          seen.add(tool.name);
          allTools.push(tool);
        }
      }
    }
    return allTools;
  }
}

export function loadSkillsFromDir(dir: string): SkillDefinition[] {
  const skills: SkillDefinition[] = [];

  if (!fs.existsSync(dir)) return skills;

  const categories = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const cat of categories) {
    const catDir = path.join(dir, cat.name);
    const skillDirs = fs.readdirSync(catDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const skillDir of skillDirs) {
      const skillPath = path.join(catDir, skillDir.name, 'SKILL.md');
      if (fs.existsSync(skillPath)) {
        const content = fs.readFileSync(skillPath, 'utf-8');
        const parsed = parseSkillMd(content, cat.name, skillDir.name);
        if (parsed) skills.push(parsed);
      }
    }
  }

  return skills;
}

function parseSkillMd(content: string, category: string, id: string): SkillDefinition | null {
  const metaMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!metaMatch) return null;

  const meta = metaMatch[1];
  const instructions = content.slice(metaMatch[0].length).trim();

  const get = (key: string): string => {
    const match = meta.match(new RegExp(`${key}:\\s*(.+)`));
    return match ? match[1].trim() : '';
  };

  const getTags = (): string[] => {
    const match = meta.match(/tags:\s*\[([^\]]*)\]/);
    if (!match) return [];
    return match[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
  };

  return {
    id,
    name: get('name') || id,
    category,
    description: get('description') || '',
    tags: getTags(),
    instructions,
    tools: [],
  };
}
