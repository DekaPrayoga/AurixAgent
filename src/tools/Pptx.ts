import type { Tool } from './Registry.js';

export const pptxTool: Tool = {
  name: 'generate_pptx',
  description: 'Generate a PowerPoint presentation. Uses pptxgenjs.',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Output filename (e.g. presentation.pptx)' },
      title: { type: 'string', description: 'Presentation title' },
      slides: { type: 'string', description: 'JSON array of slide objects {title, bullets: []}' },
    },
    required: ['filename', 'title'],
  },
  async execute(args) {
    const filename = args.filename as string;
    const title = args.title as string;
    let slides: { title: string; bullets: string[] }[] = [];
    try {
      slides = JSON.parse((args.slides as string) || '[]');
    } catch {
      slides = [];
    }

    try {
      // @ts-expect-error optional dependency
      const PptxGenJS = (await import('pptxgenjs')).default;
      const pptx = new PptxGenJS();
      pptx.title = title;

      const titleSlide = pptx.addSlide();
      titleSlide.addText(title, { x: 1, y: 2, w: 8, h: 2, fontSize: 32, bold: true, align: 'center' });

      for (const slide of slides) {
        const s = pptx.addSlide();
        s.addText(slide.title, { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 24, bold: true });
        if (slide.bullets?.length) {
          s.addText(slide.bullets.map(b => ({ text: b, options: { bullet: true, fontSize: 16 } })), {
            x: 1, y: 1.8, w: 8, h: 4,
          });
        }
      }

      await pptx.writeFile({ fileName: filename });
      return `Presentation created: ${filename} (${slides.length + 1} slides)`;
    } catch (e: any) {
      return `PPTX generation failed: ${e.message}\nInstall pptxgenjs: npm install pptxgenjs`;
    }
  },
};
