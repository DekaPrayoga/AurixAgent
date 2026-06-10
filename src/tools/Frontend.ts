import type { Tool } from './Registry.js';

export const frontendTools: Tool[] = [
  {
    name: 'web_fetch',
    description: 'Fetch a URL and extract its text content, links, and metadata.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        extract: { type: 'string', description: 'What to extract: text, links, images, all' },
      },
      required: ['url'],
    },
    async execute(args) {
      const url = args.url as string;
      const extract = (args.extract as string) || 'all';
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'AURIX-Agent/0.1' },
        });
        const html = await res.text();
        const title = html.match(/<title>(.*?)<\/title>/i)?.[1] || 'No title';
        const links: string[] = [];
        const images: string[] = [];
        const linkRe = /<a[^>]+href="([^"]+)"/gi;
        const imgRe = /<img[^>]+src="([^"]+)"/gi;
        let m;
        while ((m = linkRe.exec(html)) !== null) links.push(m[1]);
        while ((m = imgRe.exec(html)) !== null) images.push(m[1]);
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
        const parts = [`Title: ${title}`];
        if (extract === 'all' || extract === 'text') parts.push(`\nContent:\n${text}`);
        if (extract === 'all' || extract === 'links') parts.push(`\nLinks (${links.length}):\n${links.slice(0, 20).join('\n')}`);
        if (extract === 'all' || extract === 'images') parts.push(`\nImages (${images.length}):\n${images.slice(0, 20).join('\n')}`);
        return parts.join('\n');
      } catch (e: any) {
        return `Error fetching ${url}: ${e.message}`;
      }
    },
  },
  {
    name: 'scaffold_project',
    description: 'Generate project scaffolding for React, Next.js, Vue, or Svelte.',
    parameters: {
      type: 'object',
      properties: {
        framework: { type: 'string', description: 'Framework: react, next, vue, svelte' },
        name: { type: 'string', description: 'Project name' },
        typescript: { type: 'boolean', description: 'Use TypeScript (default: true)' },
      },
      required: ['framework', 'name'],
    },
    async execute(args) {
      const framework = (args.framework as string).toLowerCase();
      const name = args.name as string;
      const ts = args.typescript !== false;
      const commands: Record<string, string> = {
        react: `npm create vite@latest ${name} -- --template ${ts ? 'react-ts' : 'react'}`,
        next: `npx create-next-app@latest ${name} ${ts ? '--typescript' : ''} --app --tailwind --src-dir`,
        vue: `npm create vue@latest ${name}`,
        svelte: `npm create svelte@latest ${name}`,
      };
      const cmd = commands[framework];
      if (!cmd) return `Unknown framework: ${framework}. Use: react, next, vue, svelte`;
      return `Run this command to scaffold:\n\n\`\`\`bash\n${cmd}\ncd ${name}\nnpm install\nnpm run dev\n\`\`\``;
    },
  },
  {
    name: 'generate_component',
    description: 'Generate a React/Vue/Svelte component with TypeScript types.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Component name' },
        framework: { type: 'string', description: 'react, vue, or svelte' },
        description: { type: 'string', description: 'What the component does' },
        props: { type: 'string', description: 'Comma-separated props with types' },
      },
      required: ['name', 'description'],
    },
    async execute(args) {
      const name = args.name as string;
      const framework = ((args.framework as string) || 'react').toLowerCase();
      const desc = args.description as string;
      const props = (args.props as string) || '';

      if (framework === 'react') {
        const propLines = props.split(',').filter(Boolean).map(p => {
          const [n, t] = p.split(':').map(s => s.trim());
          return `  ${n}: ${t || 'string'};`;
        });
        return `interface ${name}Props {\n${propLines.join('\n') || '  // add props here'}\n}\n\nexport function ${name}(props: ${name}Props) {\n  // ${desc}\n  return (\n    <div className="${name.toLowerCase()}">\n      {/* ${name} component */}\n    </div>\n  );\n}`;
      }
      return `// ${framework} component "${name}": ${desc}\n// Use your framework's CLI to generate.`;
    },
  },
  {
    name: 'build_check',
    description: 'Run a build and report any errors.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Build command (default: npm run build)' },
      },
    },
    async execute(args) {
      const { execSync } = await import('child_process');
      const cmd = (args.command as string) || 'npm run build';
      try {
        const output = execSync(cmd, { encoding: 'utf8', timeout: 120000, stdio: 'pipe' });
        return `Build succeeded.\n${output.slice(0, 1000)}`;
      } catch (e: any) {
        return `Build failed:\n${(e.stderr || e.stdout || e.message).slice(0, 2000)}`;
      }
    },
  },
];
