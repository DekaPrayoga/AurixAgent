import { describe, expect, test } from 'bun:test';
import { buildSystemPrompt, type BuildSystemPromptDependencies } from '../src/agent/Context.js';
import type { AurixConfig } from '../src/agent/Config.js';
import type { Tool } from '../src/tools/Registry.js';

const config = {
  provider: 'custom',
  apiKey: 'k',
  baseUrl: 'http://localhost:1/v1',
  model: 'test/model',
  researchMode: 'medium',
} as AurixConfig;

const tool = (name: string) =>
  ({ name, description: '', parameters: {}, run: async () => '' }) as unknown as Tool;

const BASE = ['terminal', 'read_file', 'write_file', 'file_edit', 'search_files', 'glob'];

function render(toolNames: string[], over: Partial<BuildSystemPromptDependencies> = {}): string {
  return buildSystemPrompt(config, toolNames.map(tool), {
    loadSoulContent: () => '',
    loadAgents: () => ({ global: '', project: '' }) as never,
    loadMemorySummary: () => '',
    isGitRepo: () => false,
    ...over,
  });
}

// Markers are the literal headings, so a renamed heading fails here instead of silently
// dropping a layer from the prompt.
const GIT = '# Committing changes with git';
const GIT_PUSH = '# GIT PUSH & GITHUB OPERATIONS';
const BROWSER = '# Browser Tool';
const OSINT = '## OSINT (Open Source Intelligence)';
const DOCS = '# Document Generation';
const GATEWAY = '# Gateway Mode';

describe('prompt layer gating', () => {
  test('git layer follows the repo, not the tool list', () => {
    const inRepo = render(BASE, { isGitRepo: () => true });
    expect(inRepo).toContain(GIT);
    expect(inRepo).toContain(GIT_PUSH);

    const outside = render(BASE, { isGitRepo: () => false });
    expect(outside).not.toContain(GIT);
    expect(outside).not.toContain(GIT_PUSH);
  });

  test('browser layer follows the browser tool', () => {
    expect(render([...BASE, 'browser'])).toContain(BROWSER);
    expect(render(BASE)).not.toContain(BROWSER);
  });

  test('osint layer follows osint_investigate, independent of the browser', () => {
    // OSINT used to be nested under the browser heading, so browser-only must not pull it in.
    expect(render([...BASE, 'browser'])).not.toContain(OSINT);
    expect(render([...BASE, 'osint_investigate'])).toContain(OSINT);
  });

  test('document layer follows the document tools', () => {
    expect(render([...BASE, 'generate_excel'])).toContain(DOCS);
    expect(render([...BASE, 'pdf'])).toContain(DOCS);
    expect(render(BASE)).not.toContain(DOCS);
  });

  test('gateway layer follows the surface', () => {
    expect(render(BASE, { surface: 'gateway' })).toContain(GATEWAY);
    expect(render(BASE, { surface: 'tui' })).not.toContain(GATEWAY);
    expect(render(BASE)).not.toContain(GATEWAY); // default surface is tui
  });
});

describe('always-on guardrails survive every gate', () => {
  // These are prompt-only rules with no runtime enforcement behind them, so a gate
  // that accidentally swallowed one would go unnoticed until it caused real damage.
  const ALWAYS = [
    '# Non-negotiable',
    '## API test evidence protocol', // general rule; used to be filed under gateway
    '# Safety',
    '# Tool-call discipline',
    '# Failure protocol',
    '# Doing tasks',
  ];

  const scenarios: [string, string[], Partial<BuildSystemPromptDependencies>][] = [
    ['tui in repo', BASE, { isGitRepo: () => true }],
    ['tui outside repo', BASE, { isGitRepo: () => false }],
    ['browser + osint', [...BASE, 'browser', 'osint_investigate'], {}],
    ['gateway', BASE, { surface: 'gateway' }],
    ['everything', [...BASE, 'browser', 'osint_investigate', 'generate_excel', 'pdf'], {
      isGitRepo: () => true,
      surface: 'gateway',
    }],
    ['bare minimum', ['read_file'], {}],
  ];

  for (const [name, tools, over] of scenarios) {
    test(name, () => {
      const prompt = render(tools, over);
      for (const marker of ALWAYS) expect(prompt).toContain(marker);
    });
  }
});

describe('prompt shape', () => {
  test('gating actually removes weight', () => {
    const lean = render(BASE, { isGitRepo: () => false }).length;
    const full = render([...BASE, 'browser', 'osint_investigate', 'generate_excel', 'pdf'], {
      isGitRepo: () => true,
      surface: 'gateway',
    }).length;
    expect(lean).toBeLessThan(full);
    expect(full - lean).toBeGreaterThan(10_000); // ~3.4k token of layers
  });

  test('no section is emitted blank or double-separated', () => {
    const prompt = render([...BASE, 'browser'], { isGitRepo: () => true });
    expect(prompt).not.toContain('\n\n\n');
    expect(prompt.startsWith('You are AURIX')).toBe(true);
  });

  test('exactly one block claims priority', () => {
    // Four blocks used to claim it at once, which is the same as none of them claiming it.
    const prompt = render([...BASE, 'browser', 'osint_investigate', 'generate_excel'], {
      isGitRepo: () => true,
      surface: 'gateway',
    });
    for (const claim of ['HIGHEST PRIORITY', 'ABSOLUTE RULES', 'READ THIS FIRST', 'MANDATORY']) {
      expect(prompt).not.toContain(claim);
    }
    expect(prompt).toContain('# Non-negotiable');
  });

  test('the do-not-refuse rule is stated once, not five times', () => {
    const prompt = render(BASE, { isGitRepo: () => true });
    const restatements = [
      'You are a tool, not a gatekeeper',
      'NEVER refuse a coding task',
      'IMPORTANT OVERRIDE',
      'ENVIRONMENT AUTHORIZATION',
      'WRITE THE CODE',
    ];
    for (const dupe of restatements) expect(prompt).not.toContain(dupe);
    expect(prompt).toContain('Write the code.');
  });
});
