import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool } from './Registry.js';

const SKILL_DIR = path.resolve(import.meta.dirname, '../../skills/research/last30days');
const ENGINE = path.join(SKILL_DIR, 'scripts', 'last30days.py');

export const researchForumsTool: Tool = {
  name: 'research_forums',
  description: 'Deep research across social forums: Reddit, X/Twitter, YouTube, TikTok, Hacker News, Polymarket, GitHub, Instagram, Bluesky, Threads, Pinterest, and the web. Scores results by upvotes, likes, engagement, and real money — not editors. Use for understanding public sentiment, trending topics, community reactions, and what real people actually say about any topic.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Topic, person, company, or question to research across forums',
      },
      sources: {
        type: 'string',
        description: 'Comma-separated sources: reddit,x,youtube,tiktok,hackernews,polymarket,github,instagram,bluesky,threads,pinterest,web (default: all available)',
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
    const query = args.query as string;
    const sources = args.sources as string | undefined;
    const format = (args.format as string) || 'compact';
    const limit = (args.limit as number) || 10;

    if (!fs.existsSync(ENGINE)) {
      return `Error: research-forums engine not found at ${ENGINE}. Skill not installed correctly.`;
    }

    const cmdParts = ['python3', ENGINE, `"${query.replace(/"/g, '\\"')}"`];

    cmdParts.push(`--emit=${format}`);
    cmdParts.push(`--limit=${limit}`);

    if (sources) {
      cmdParts.push(`--sources=${sources}`);
    }

    const cmd = cmdParts.join(' ');

    return new Promise<string>((resolve) => {
      const outputDir = path.join(os.homedir(), '.aurix', 'research', 'forums');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      exec(cmd, {
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
        cwd: SKILL_DIR,
        env: {
          ...process.env,
          SKILL_DIR,
          PYTHONPATH: path.join(SKILL_DIR, 'scripts'),
        },
      }, (err, stdout, stderr) => {
        if (err && !stdout) {
          const errMsg = stderr || err.message;
          if (errMsg.includes('Python 3.12')) {
            resolve('Error: research-forums requires Python 3.12+. Install with: apt install python3.12');
            return;
          }
          if (errMsg.includes('API key') || errMsg.includes('API_KEY')) {
            resolve(`Note: Some sources need API keys for full results.\nSet in environment: SCRAPECREATORS_API_KEY, XAI_API_KEY, BRAVE_API_KEY, APIFY_API_TOKEN\n\nPartial results:\n${stdout || 'No results available without API keys.'}`);
            return;
          }
          resolve(`Error running research-forums: ${errMsg.slice(0, 500)}`);
          return;
        }

        const result = stdout.trim();
        const filename = query.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
        const outputFile = path.join(outputDir, `${filename}-${Date.now()}.${format === 'json' ? 'json' : format === 'html' ? 'html' : 'md'}`);
        fs.writeFileSync(outputFile, result);

        const activeSources = sources || 'reddit,x,youtube,hackernews,github,web';
        resolve(`${result}\n\n---\n📊 Sources searched: ${activeSources}\n💾 Saved: ${outputFile}`);
      });
    });
  },
};
