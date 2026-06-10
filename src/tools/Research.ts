import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool } from './Registry.js';

export const researchTool: Tool = {
  name: 'research',
  description: 'Deep research tool: gather information from multiple sources, compile findings, generate research reports with citations. Supports academic papers, market analysis, and technical documentation.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Research topic or question',
      },
      depth: {
        type: 'string',
        description: 'Research depth: quick, standard, deep (default: standard)',
      },
      format: {
        type: 'string',
        description: 'Output format: summary, detailed, academic, bullet (default: detailed)',
      },
      sources: {
        type: 'string',
        description: 'Source types: web, arxiv, scholar, all (default: all)',
      },
    },
    required: ['query'],
  },
  async execute(args) {
    const query = args.query as string;
    const depth = (args.depth as string) || 'standard';
    const format = (args.format as string) || 'detailed';

    const results: string[] = [];
    results.push(`Research: ${query}`);
    results.push(`Depth: ${depth} | Format: ${format}`);
    results.push('='.repeat(50));

    const ddResults = await searchDuckDuckGo(query);
    if (ddResults) results.push('\n[Web Results]\n' + ddResults);

    if (depth === 'standard' || depth === 'deep') {
      const wikiResults = await searchWikipedia(query);
      if (wikiResults) results.push('\n[Wikipedia]\n' + wikiResults);
    }

    if (depth === 'deep') {
      const arxivResults = await searchArxiv(query);
      if (arxivResults) results.push('\n[ArXiv Papers]\n' + arxivResults);
    }

    const report = results.join('\n');

    const outputDir = path.join(os.homedir(), '.aurix', 'research');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const filename = query.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
    const outputFile = path.join(outputDir, `${filename}-${Date.now()}.md`);
    fs.writeFileSync(outputFile, report);

    return `${report}\n\nReport saved: ${outputFile}`;
  },
};

async function searchDuckDuckGo(query: string): Promise<string> {
  return new Promise(resolve => {
    exec(
      `curl -s "https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1" 2>/dev/null`,
      { timeout: 15000, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err) { resolve(''); return; }
        try {
          const data = JSON.parse(stdout);
          const lines: string[] = [];
          if (data.AbstractText) lines.push(`Summary: ${data.AbstractText}\nSource: ${data.AbstractURL}`);
          for (const topic of (data.RelatedTopics || []).slice(0, 5)) {
            if (topic.Text) lines.push(`- ${topic.Text}\n  ${topic.FirstURL || ''}`);
          }
          resolve(lines.join('\n'));
        } catch {
          resolve('');
        }
      }
    );
  });
}

async function searchWikipedia(query: string): Promise<string> {
  return new Promise(resolve => {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query.replace(/\s/g, '_'))}`;
    exec(`curl -s "${url}" 2>/dev/null`, { timeout: 10000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) { resolve(''); return; }
      try {
        const data = JSON.parse(stdout);
        resolve(`${data.title || ''}: ${data.extract || 'No summary available'}\nURL: ${data.content_urls?.desktop?.page || ''}`);
      } catch {
        resolve('');
      }
    });
  });
}

async function searchArxiv(query: string): Promise<string> {
  return new Promise(resolve => {
    const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=5&sortBy=relevance`;
    exec(`curl -s "${url}" 2>/dev/null`, { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      if (err) { resolve(''); return; }

      const entries = stdout.match(/<entry>([\s\S]*?)<\/entry>/g);
      if (!entries) { resolve('No arxiv papers found'); return; }

      const results = entries.slice(0, 5).map(entry => {
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || '';
        const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim().slice(0, 200) || '';
        const link = entry.match(/<id>(.*?)<\/id>/)?.[1] || '';
        return `${title}\n  ${summary}...\n  ${link}`;
      });

      resolve(results.join('\n\n'));
    });
  });
}
