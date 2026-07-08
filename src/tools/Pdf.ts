import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';
import type { Tool } from './Registry.js';

const execFileAsync = promisify(execFile);

export const pdfTool: Tool = {
  name: 'pdf',
  description:
    'Generate PDF documents from markdown, HTML, or text content. Supports reports, presentations, invoices, and any document type.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Content in markdown or text format',
      },
      title: {
        type: 'string',
        description: 'Document title',
      },
      output: {
        type: 'string',
        description: 'Output file path (default: ~/Documents/aurix-output.pdf)',
      },
      template: {
        type: 'string',
        description: 'Template: report, invoice, presentation, resume, letter, journal',
      },
      images: {
        type: 'string',
        description: 'Comma-separated image URLs or file paths to embed in the document',
      },
    },
    required: ['content'],
  },
  async execute(args) {
    const content = args.content as string;
    const title = (args.title as string) || 'AURIX Document';
    const template = (args.template as string) || 'report';
    const output =
      (args.output as string) || path.join(os.homedir(), 'Documents', `aurix-${Date.now()}.pdf`);
    const images = (args.images as string) || '';

    const dir = path.dirname(output);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Embed images: convert file paths to base64 data URIs, keep URLs as-is
    let enrichedContent = content;
    if (images) {
      const imgTags = images
        .split(',')
        .map((src) => {
          src = src.trim();
          if (!src) return '';
          if (src.startsWith('http://') || src.startsWith('https://')) {
            return `\n![image](${src})\n`;
          }
          // Local file — convert to base64 data URI
          const imgPath = path.resolve(src);
          if (fs.existsSync(imgPath)) {
            const ext = path.extname(imgPath).slice(1).toLowerCase();
            const mime = ext === 'jpg' ? 'jpeg' : ext;
            const b64 = fs.readFileSync(imgPath).toString('base64');
            return `\n![${path.basename(imgPath)}](data:image/${mime};base64,${b64})\n`;
          }
          return '';
        })
        .join('\n');
      enrichedContent += '\n\n' + imgTags;
    }

    const html = templateToHtml(enrichedContent, title, template);
    const tmpHtml = path.join(os.tmpdir(), `aurix-doc-${process.pid}-${Date.now()}.html`);
    fs.writeFileSync(tmpHtml, html);

    try {
      if (await commandExists('wkhtmltopdf')) {
        await execFileAsync('wkhtmltopdf', ['--quiet', tmpHtml, output], {
          timeout: 60000,
          maxBuffer: 5 * 1024 * 1024,
        });
        return `Document saved: ${output}`;
      }

      const fallbackOutput = output.replace(/\.pdf$/i, '.html');
      fs.writeFileSync(fallbackOutput, html);
      return `PDF tool not available. HTML saved to: ${fallbackOutput}\nInstall wkhtmltopdf for PDF generation.`;
    } catch (e: any) {
      if (!fs.existsSync(output)) {
        const fallbackOutput = output.replace(/\.pdf$/i, '.html');
        fs.writeFileSync(fallbackOutput, html);
        return `PDF generation failed: ${e.message}\nHTML saved to: ${fallbackOutput}`;
      }
      return `Document saved: ${output}`;
    } finally {
      try {
        fs.unlinkSync(tmpHtml);
      } catch {}
    }
  },
};

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['--version'], { timeout: 5000, encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

function templateToHtml(content: string, title: string, template: string): string {
  const baseStyles = `
    * { box-sizing: border-box; }
    body { font-family: 'Georgia', 'Times New Roman', serif; margin: 0; padding: 50px 60px; color: #1a1a1a; line-height: 1.8; font-size: 14px; }
    h1 { font-family: 'Segoe UI', 'Helvetica Neue', sans-serif; color: #1a1a2e; border-bottom: 3px solid #2c3e50; padding-bottom: 10px; margin-top: 32px; font-size: 24px; }
    h2 { font-family: 'Segoe UI', 'Helvetica Neue', sans-serif; color: #2c3e50; margin-top: 28px; font-size: 20px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
    h3 { font-family: 'Segoe UI', 'Helvetica Neue', sans-serif; color: #34495e; margin-top: 20px; font-size: 17px; }
    p { margin: 12px 0; text-align: justify; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; font-size: 13px; }
    th, td { border: 1px solid #ccc; padding: 10px 14px; text-align: left; }
    th { background: #2c3e50; color: white; font-weight: 600; }
    tr:nth-child(even) { background: #f8f9fa; }
    img { max-width: 100%; height: auto; border-radius: 4px; margin: 16px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 13px; }
    pre { background: #1e1e2e; color: #cdd6f4; padding: 20px; border-radius: 8px; overflow-x: auto; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 13px; line-height: 1.5; }
    pre code { background: transparent; color: inherit; padding: 0; }
    blockquote { border-left: 4px solid #2c3e50; margin: 20px 0; padding: 12px 20px; background: #f8f9fa; font-style: italic; color: #555; }
    a { color: #2980b9; text-decoration: none; }
    ul, ol { margin: 12px 0; padding-left: 24px; }
    li { margin: 6px 0; }
    hr { border: none; border-top: 1px solid #ddd; margin: 30px 0; }
    @page { margin: 25mm 20mm; }
  `;

  const templateStyles: Record<string, string> = {
    report: `body { max-width: 800px; margin: 0 auto; padding: 50px 60px; } .title-page { text-align: center; padding-top: 200px; page-break-after: always; } .title-page h1 { border: none; font-size: 32px; }`,
    invoice: `.total { font-size: 24px; font-weight: bold; color: #2c3e50; text-align: right; margin-top: 20px; } .invoice-header { display: flex; justify-content: space-between; align-items: flex-start; }`,
    presentation: `body { padding: 0; } .slide { page-break-after: always; padding: 80px 60px; min-height: 700px; } h1 { font-size: 36px; text-align: center; border: none; padding-top: 120px; } h2 { font-size: 28px; border: none; }`,
    resume: `.section { margin: 24px 0; } .name { font-size: 32px; font-weight: bold; color: #2c3e50; } .contact { color: #666; font-size: 13px; }`,
    letter: `body { max-width: 650px; margin: 0 auto; font-size: 15px; } .date { text-align: right; margin-bottom: 30px; }`,
    journal: `body { max-width: 750px; margin: 0 auto; font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 2; } h1 { font-size: 16pt; text-align: center; border: none; } h2 { font-size: 14pt; border: none; } .abstract { font-style: italic; background: #fafafa; padding: 20px; border: 1px solid #eee; margin: 20px 0; } .references { font-size: 11pt; }`,
  };

  const mdToHtml = (md: string): string => {
    return md
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/^---$/gm, '<hr />')
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/(<blockquote>.*<\/blockquote>\n?)+/g, (m) =>
        m.replace(/<\/blockquote>\n<blockquote>/g, '<br/>')
      )
      .replace(/^(\d+)\. (.+)$/gm, '<oli>$2</oli>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(
        /(<oli>.*<\/oli>\n?)+/g,
        (m) => `<ol>${m.replace(/<\/?oli>/g, (t) => t.replace('oli', 'li'))}</ol>`
      )
      .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[huloipbr])/gm, '');
  };

  const htmlContent = mdToHtml(content);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>${baseStyles}${templateStyles[template] || templateStyles.report}</style>
</head>
<body>
  ${template === 'report' ? `<div class="title-page"><h1>${title}</h1><p style="color:#666;font-size:14px;">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p></div>` : `<h1>${title}</h1>`}
  <div class="content">${htmlContent}</div>
</body>
</html>`;
}
