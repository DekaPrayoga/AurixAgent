import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';
import { loadConfig } from '../agent/Config.js';
import type { Tool } from './Registry.js';

const execFileAsync = promisify(execFile);
const SKILL_DIR = path.resolve(import.meta.dirname, '../../skills/research/social-researching');
const ENGINE = path.join(SKILL_DIR, 'scripts', 'social-researching.py');

export const researchForumsTool: Tool = {
  name: 'research_forums',
  description:
    'Deep research across social forums: Reddit, X/Twitter, YouTube, TikTok, Hacker News, Polymarket, GitHub, Instagram, Bluesky, Threads, Pinterest, and the web. Scores results by upvotes, likes, engagement, and real money — not editors. Use for understanding public sentiment, trending topics, community reactions, and what real people actually say about any topic.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Topic, person, company, or question to research across forums',
      },
      sources: {
        type: 'string',
        description:
          'Comma-separated sources: reddit,x,youtube,tiktok,hackernews,polymarket,github,instagram,bluesky,threads,pinterest,web (default: all available)',
      },
      format: {
        type: 'string',
        description: 'Output format: compact, json, html (default: compact)',
      },
      limit: {
        type: 'number',
        description: 'Max results per source (default: 10)',
      },
    },
    required: ['query'],
  },
  async execute(args) {
    const query = String(args.query || '').trim();
    const sources = typeof args.sources === 'string' ? args.sources.trim() : '';
    const format = String(args.format || 'compact');
    const limit = Number(args.limit || 10);

    if (!query) return 'Error: query is required.';
    if (!fs.existsSync(ENGINE)) {
      return `Error: research-forums engine not found at ${ENGINE}. Skill not installed correctly.`;
    }

    const outputDir = path.join(os.homedir(), '.aurix', 'research', 'forums');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const argv = [
      ENGINE,
      query,
      `--emit=${format}`,
      `--limit=${Math.max(1, Math.min(100, limit))}`,
    ];
    if (sources) argv.push(`--search=${sources}`);

    const config = loadConfig();
    const redditEnv: Record<string, string> = {};
    if (config.redditRelayUrl) redditEnv.AURIX_REDDIT_RELAY_URL = config.redditRelayUrl;
    if (config.redditRelayToken) redditEnv.AURIX_REDDIT_RELAY_TOKEN = config.redditRelayToken;
    if (config.redditBackend) redditEnv.AURIX_REDDIT_BACKEND = config.redditBackend;
    if (config.redditRelayStrict !== undefined) {
      redditEnv.AURIX_REDDIT_RELAY_STRICT = config.redditRelayStrict ? '1' : '0';
    }

    try {
      const { stdout, stderr } = await execFileAsync('python3', argv, {
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
        cwd: SKILL_DIR,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...redditEnv,
          SKILL_DIR,
          PYTHONPATH: path.join(SKILL_DIR, 'scripts'),
        },
      });

      const result = String(stdout || '').trim();
      const filename = query.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
      const outputFile = path.join(
        outputDir,
        `${filename}-${Date.now()}.${format === 'json' ? 'json' : format === 'html' ? 'html' : 'md'}`
      );
      fs.writeFileSync(outputFile, result || String(stderr || '').trim());

      const activeSources = sources || 'reddit,x,youtube,hackernews,github,web';
      return `${result || String(stderr || '').trim()}\n\n---\n📊 Sources searched: ${activeSources}\n💾 Saved: ${outputFile}`;
    } catch (e: any) {
      const errMsg = String(e.stderr || e.stdout || e.message || e);
      if (errMsg.includes('Python 3.12')) {
        return 'Error: research-forums requires Python 3.12+. Install with: apt install python3.12';
      }
      const partial = String(e.stdout || '').trim();
      if (errMsg.includes('API key') || errMsg.includes('API_KEY')) {
        return `Note: Some sources need API keys for full results.\nSet in environment: SCRAPECREATORS_API_KEY, XAI_API_KEY, BRAVE_API_KEY, APIFY_API_TOKEN\n\nPartial results:\n${partial || 'No results available without API keys.'}`;
      }
      if (partial) {
        const filename = query.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
        const outputFile = path.join(
          outputDir,
          `${filename}-${Date.now()}.${format === 'json' ? 'json' : format === 'html' ? 'html' : 'md'}`
        );
        fs.writeFileSync(outputFile, partial);
        const activeSources = sources || 'reddit,x,youtube,hackernews,github,web';
        return `${partial}\n\n---\n⚠️ research-forums exited with warnings: ${errMsg.slice(0, 300)}\n📊 Sources searched: ${activeSources}\n💾 Saved: ${outputFile}`;
      }
      return `Error running research-forums: ${errMsg.slice(0, 500)}`;
    }
  },
};
