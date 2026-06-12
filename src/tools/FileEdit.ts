import type { Tool } from './Registry.js';

export const fileEditTool: Tool = {
  name: 'file_edit',
  description: `Performs exact string replacements in files.

Usage:
- You must use your read_file tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file first.
- When editing text from read_file output, preserve the exact indentation (tabs/spaces) as it appears in the file content.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- The edit will FAIL if old_string is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use replace_all to change every instance.
- Use replace_all for replacing and renaming strings across the file. This is useful for renaming variables.
- Use the smallest old_string that is clearly unique — usually 2-4 adjacent lines is sufficient.`,
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file to edit' },
      old_string: { type: 'string', description: 'Exact text to find and replace (empty string to create new file)' },
      new_string: { type: 'string', description: 'Text to replace old_string with' },
      replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false, replace first only)' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  async execute(args) {
    const fs = await import('fs');
    const filePath = args.file_path as string;
    const oldStr = args.old_string as string;
    const newStr = args.new_string as string;
    const replaceAll = args.replace_all === true;

    if (oldStr === '') {
      fs.writeFileSync(filePath, newStr);
      const newLinesArr = newStr.split('\n');
      const createdBlock = [
        `Created ${filePath}  (${newLinesArr.length} new lines)`,
        ...newLinesArr.map(l => `+ ${l}`),
      ].join('\n');
      return createdBlock;
    }

    if (!fs.existsSync(filePath)) {
      return `Error: File not found: ${filePath}`;
    }

    let content = fs.readFileSync(filePath, 'utf-8');
    const count = content.split(oldStr).length - 1;

    if (count === 0) {
      return `Error: old_string not found in ${filePath}`;
    }

    if (count > 1 && !replaceAll) {
      return `Error: Found ${count} occurrences of old_string. Use replace_all=true or make old_string more specific.`;
    }

    const updated = replaceAll
      ? content.split(oldStr).join(newStr)
      : content.replace(oldStr, newStr);

    fs.writeFileSync(filePath, updated);

    const oldLinesArr = oldStr.split('\n');
    const newLinesArr = newStr.split('\n');
    const oldCount = oldLinesArr.length;
    const newCount = newLinesArr.length;
    const diff = newCount - oldCount;
    const diffStr = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '0';

    // Find the starting line number of the replacement for display.
    const beforeContent = content.slice(0, content.indexOf(oldStr));
    const lineStart = beforeContent.split('\n').length;

    const diffBlock = [
      `Edited ${filePath}  (replaced ${replaceAll ? count : 1} occurrence(s), lines ${lineStart}-${lineStart + oldCount - 1}, ${diffStr})`,
      ...oldLinesArr.map(l => `- ${l}`),
      ...newLinesArr.map(l => `+ ${l}`),
    ].join('\n');

    return diffBlock;
  },
};
