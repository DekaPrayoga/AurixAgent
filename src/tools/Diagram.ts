import type { Tool } from './Registry.js';

export const diagramTool: Tool = {
  name: 'generate_diagram',
  description: 'Generate diagrams (flowchart, sequence, architecture) as SVG or text.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'flowchart, sequence, architecture, erd, mindmap' },
      content: { type: 'string', description: 'Diagram description or Mermaid syntax' },
      format: { type: 'string', description: 'mermaid, svg, or text' },
      filename: { type: 'string', description: 'Output filename (for svg)' },
    },
    required: ['type', 'content'],
  },
  async execute(args) {
    const type = args.type as string;
    const content = args.content as string;
    const format = (args.format as string) || 'mermaid';

    if (format === 'mermaid') {
      const mermaidMap: Record<string, string> = {
        flowchart: 'flowchart TD',
        sequence: 'sequenceDiagram',
        architecture: 'flowchart LR',
        erd: 'erDiagram',
        mindmap: 'mindmap',
      };
      const header = mermaidMap[type] || 'flowchart TD';

      if (/--+>|->>/.test(content)) {
        return `\`\`\`mermaid\n${header}\n${content}\n\`\`\``;
      }

      return `\`\`\`mermaid\n${header}\n  ${content.split('\n').map(l => l.trim()).filter(Boolean).join('\n  ')}\n\`\`\`\n\nRender with any Mermaid-compatible viewer.`;
    }

    if (format === 'text') {
      return `Diagram (${type}):\n\n${content}\n\n(ASCII art rendering not available. Use format=mermaid for visual rendering.)`;
    }

    return `Format "${format}" for ${type} diagram.\nUse format=mermaid for inline rendering or install mermaid-cli for SVG export.`;
  },
};
