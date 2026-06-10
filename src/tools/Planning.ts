import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool } from './Registry.js';

const PLANS_DIR = path.join(os.homedir(), '.aurix', 'plans');

export const planningTool: Tool = {
  name: 'planning',
  description: 'Project planning and task decomposition: create plans, break down features into stories, track progress, generate implementation roadmaps. Supports sprint planning, technical specs, and architecture decisions.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action: create, list, view, update, decompose, roadmap, sprint, delete',
      },
      name: {
        type: 'string',
        description: 'Plan name',
      },
      content: {
        type: 'string',
        description: 'Plan content or description',
      },
      priority: {
        type: 'string',
        description: 'Priority: critical, high, medium, low',
      },
    },
    required: ['action'],
  },
  async execute(args) {
    const action = args.action as string;

    if (!fs.existsSync(PLANS_DIR)) fs.mkdirSync(PLANS_DIR, { recursive: true });

    switch (action) {
      case 'create': return createPlan(args);
      case 'list': return listPlans();
      case 'view': return viewPlan(args.name as string);
      case 'update': return updatePlan(args);
      case 'decompose': return decomposeFeature(args);
      case 'roadmap': return generateRoadmap(args);
      case 'sprint': return sprintPlan(args);
      case 'delete': return deletePlan(args.name as string);
      default: return `Unknown action: ${action}`;
    }
  },
};

function createPlan(args: Record<string, unknown>): string {
  const name = (args.name as string) || `plan-${Date.now()}`;
  const content = (args.content as string) || '';
  const priority = (args.priority as string) || 'medium';

  const plan = {
    name,
    priority,
    content,
    status: 'draft',
    stories: [] as Array<{ id: string; title: string; status: string }>,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const file = path.join(PLANS_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(plan, null, 2));
  return `Plan created: ${name}\nFile: ${file}`;
}

function listPlans(): string {
  const files = fs.readdirSync(PLANS_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) return 'No plans found.';

  return files.map(f => {
    const plan = JSON.parse(fs.readFileSync(path.join(PLANS_DIR, f), 'utf-8'));
    return `[${plan.priority}] ${plan.name} (${plan.status}) - ${plan.stories?.length || 0} stories`;
  }).join('\n');
}

function viewPlan(name: string): string {
  if (!name) return 'Provide a plan name';
  const file = path.join(PLANS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return `Plan not found: ${name}`;
  return fs.readFileSync(file, 'utf-8');
}

function updatePlan(args: Record<string, unknown>): string {
  const name = args.name as string;
  if (!name) return 'Provide a plan name';

  const file = path.join(PLANS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return `Plan not found: ${name}`;

  const plan = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (args.content) plan.content = args.content;
  if (args.priority) plan.priority = args.priority;
  plan.updatedAt = new Date().toISOString();

  fs.writeFileSync(file, JSON.stringify(plan, null, 2));
  return `Plan updated: ${name}`;
}

function decomposeFeature(args: Record<string, unknown>): string {
  const name = (args.name as string) || 'feature';
  const content = (args.content as string) || '';

  const plan = {
    name,
    content,
    status: 'decomposed',
    stories: generateStories(content, name),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const file = path.join(PLANS_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(plan, null, 2));

  const storyList = plan.stories.map((s: any, i: number) =>
    `  S${i + 1}: ${s.title} [${s.status}]`
  ).join('\n');

  return `Feature decomposed into ${plan.stories.length} stories:\n${storyList}\n\nSaved: ${file}`;
}

function generateStories(content: string, name: string): Array<{ id: string; title: string; status: string; tasks: string[] }> {
  const keywords = content.toLowerCase();
  const stories: Array<{ id: string; title: string; status: string; tasks: string[] }> = [];

  stories.push({
    id: 'S1',
    title: `Setup ${name} foundation`,
    status: 'pending',
    tasks: ['Initialize project structure', 'Configure dependencies', 'Setup CI/CD'],
  });

  if (keywords.includes('auth') || keywords.includes('login')) {
    stories.push({
      id: `S${stories.length + 1}`,
      title: 'Authentication system',
      status: 'pending',
      tasks: ['Implement auth flow', 'Add session management', 'Write auth tests'],
    });
  }

  if (keywords.includes('api') || keywords.includes('backend')) {
    stories.push({
      id: `S${stories.length + 1}`,
      title: 'API layer',
      status: 'pending',
      tasks: ['Define API routes', 'Implement handlers', 'Add validation', 'Write API tests'],
    });
  }

  if (keywords.includes('ui') || keywords.includes('frontend') || keywords.includes('page')) {
    stories.push({
      id: `S${stories.length + 1}`,
      title: 'Frontend implementation',
      status: 'pending',
      tasks: ['Build components', 'Wire state management', 'Add responsive design', 'Browser testing'],
    });
  }

  stories.push({
    id: `S${stories.length + 1}`,
    title: 'Testing and polish',
    status: 'pending',
    tasks: ['Integration tests', 'Performance testing', 'Documentation', 'Deploy'],
  });

  return stories;
}

function generateRoadmap(args: Record<string, unknown>): string {
  const name = (args.name as string) || 'roadmap';
  const content = (args.content as string) || '';

  return `=== ROADMAP: ${name} ===

Phase 1 - Foundation (Week 1-2)
  - Core architecture
  - Basic functionality
  - Development environment

Phase 2 - Core Features (Week 3-4)
  - Primary features implementation
  - Integration testing
  - Documentation

Phase 3 - Enhancement (Week 5-6)
  - Performance optimization
  - Edge case handling
  - User experience improvements

Phase 4 - Release (Week 7-8)
  - Final testing
  - Deployment
  - Monitoring setup

Context: ${content}`;
}

function sprintPlan(args: Record<string, unknown>): string {
  const name = (args.name as string) || `sprint-${Date.now()}`;
  const content = (args.content as string) || '';

  return `=== SPRINT PLAN: ${name} ===

Duration: 2 weeks
Goal: ${content || 'TBD'}

Stories:
  [Add stories from decomposed features]

Capacity Planning:
  - Developer hours: TBD
  - Risk buffer: 20%
  - Meetings/ceremonies: 10%

Definition of Done:
  - Code reviewed
  - Tests passing
  - Documentation updated
  - Deployed to staging`;
}

function deletePlan(name: string): string {
  if (!name) return 'Provide a plan name';
  const file = path.join(PLANS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return `Plan not found: ${name}`;
  fs.unlinkSync(file);
  return `Plan deleted: ${name}`;
}
