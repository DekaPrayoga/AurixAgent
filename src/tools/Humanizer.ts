import type { Tool } from './Registry.js';

export const humanizerTool: Tool = {
  name: 'humanize_text',
  description: 'Remove AI writing patterns from text to make it sound more natural and human.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to humanize' },
      style: { type: 'string', description: 'casual, professional, or academic' },
    },
    required: ['text'],
  },
  async execute(args) {
    const text = args.text as string;
    const style = (args.style as string) || 'professional';

    const aiPatterns = [
      [/\bIt is important to note that\b/gi, ''],
      [/\bIt's worth mentioning that\b/gi, ''],
      [/\bIn today's (?:fast-paced|rapidly evolving|digital) (?:world|landscape|era)\b/gi, ''],
      [/\bDelve (?:into|deeper)\b/gi, 'Explore'],
      [/\bLeverage\b/gi, 'Use'],
      [/\bUtilize\b/gi, 'Use'],
      [/\bFacilitate\b/gi, 'Help'],
      [/\bFurthermore\b/gi, 'Also'],
      [/\bMoreover\b/gi, 'Also'],
      [/\bAdditionally\b/gi, 'Also'],
      [/\bIn conclusion\b/gi, ''],
      [/\bIt is worth noting\b/gi, ''],
      [/\bA testament to\b/gi, 'Shows'],
      [/\bNavigating the complexities\b/gi, 'Understanding'],
      [/\bIn the realm of\b/gi, 'In'],
      [/\bMultifaceted\b/gi, 'Complex'],
      [/\bPivotal\b/gi, 'Key'],
      [/\bTapestry\b/gi, 'Mix'],
      [/\bRobust\b/gi, 'Strong'],
      [/\bSeamless(?:ly)?\b/gi, 'Smooth'],
    ];

    let result = text;
    for (const [pattern, replacement] of aiPatterns) {
      result = result.replace(pattern, replacement as string);
    }

    result = result.replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim();

    return `Humanized (${style}):\n\n${result}\n\n---\nPatterns removed: ${aiPatterns.length} common AI phrases filtered.`;
  },
};
