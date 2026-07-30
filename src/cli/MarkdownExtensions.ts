const FENCE = /^\s*(`{3,}|~{3,})([^`]*)$/;

export function expandAurixHighlights(content: string): string {
  const lines = content.split('\n');
  let fenceCharacter = '';
  let fenceLength = 0;

  return lines.map((line) => {
    const fence = line.match(FENCE);
    if (!fenceCharacter && fence) {
      fenceCharacter = fence[1][0];
      fenceLength = fence[1].length;
      return line;
    }
    if (fenceCharacter) {
      const closing = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (closing && closing[1][0] === fenceCharacter && closing[1].length >= fenceLength) {
        fenceCharacter = '';
        fenceLength = 0;
      }
      return line;
    }
    if (/^\s*#{1,6}\s/.test(line)) return line;

    let output = '';
    let cursor = 0;
    let inlineDelimiter = 0;
    while (cursor < line.length) {
      if (line[cursor] === '`') {
        let run = 1;
        while (line[cursor + run] === '`') run++;
        if (inlineDelimiter === 0) inlineDelimiter = run;
        else if (run === inlineDelimiter) inlineDelimiter = 0;
        output += line.slice(cursor, cursor + run);
        cursor += run;
        continue;
      }
      if (inlineDelimiter === 0 && line[cursor] === '#') {
        const tokenStart = Math.max(line.lastIndexOf(' ', cursor - 1), line.lastIndexOf('\t', cursor - 1)) + 1;
        const tokenPrefix = line.slice(tokenStart, cursor);
        if (/^(?:https?:\/\/|www\.)/i.test(tokenPrefix)) {
          output += line[cursor++];
          continue;
        }
        const end = line.indexOf('#', cursor + 1);
        if (end > cursor + 1) {
          const value = line.slice(cursor + 1, end);
          const before = cursor > 0 ? line[cursor - 1] : '';
          const after = line[end + 1] || '';
          if (
            value.trim() === value &&
            !/\s{2,}/.test(value) &&
            before !== '/' &&
            after !== '/' &&
            !/^\d+$/.test(value) &&
            !/^[0-9a-f]{6,}$/i.test(value)
          ) {
            output += `*${value}*`;
            cursor = end + 1;
            continue;
          }
        }
      }
      output += line[cursor++];
    }
    return output;
  }).join('\n');
}
