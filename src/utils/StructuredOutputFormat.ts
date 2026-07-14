export type StructuredSurface = 'gateway' | 'terminal' | 'tui' | 'docs';

interface MarkdownTable {
  start: number;
  end: number;
  headers: string[];
  rows: string[][];
}

function parseRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) =>
      cell
        .replace(/<br\s*\/?>/gi, ' / ')
        .replace(/\s+/g, ' ')
        .trim()
    );
}

function isDivider(row: string): boolean {
  return parseRow(row).every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function parseMarkdownTableBlock(lines: string[], start: number): MarkdownTable | null {
  if (!lines[start]?.trim().startsWith('|')) return null;

  const block: string[] = [];
  let i = start;
  while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].includes('|', 1)) {
    block.push(lines[i]);
    i++;
  }

  if (block.length < 2) return null;
  const sepIdx = block.findIndex((line, idx) => idx > 0 && isDivider(line));
  if (sepIdx < 1) return null;

  const headers = parseRow(block[0]);
  const rows = block
    .filter((line, idx) => idx !== 0 && idx !== sepIdx && !isDivider(line))
    .map(parseRow)
    .filter((row) => row.some(Boolean));

  if (headers.length === 0 || rows.length === 0) return null;
  return { start, end: i, headers, rows };
}

function parseLoosePipeTableBlock(lines: string[], start: number): MarkdownTable | null {
  const first = lines[start]?.trim() || '';
  if (!first.includes('|') || first.startsWith('|') || isDivider(first)) return null;

  const headers = parseRow(first);
  if (headers.length < 3) return null;

  const rows: string[][] = [];
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || !line.includes('|') || isDivider(line)) break;
    const row = parseRow(line);
    if (row.length !== headers.length || !row.some(Boolean)) break;
    rows.push(row);
    i++;
  }

  if (rows.length === 0) return null;
  return { start, end: i, headers, rows };
}

function normalizeMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function normalizeTable(
  headers: string[],
  rows: string[][]
): { headers: string[]; rows: string[][] } {
  const colCount = Math.max(headers.length, ...rows.map((row) => row.length));
  return {
    headers: Array.from({ length: colCount }, (_, i) =>
      normalizeMarkdown(headers[i] || `Column ${i + 1}`)
    ),
    rows: rows.map((row) =>
      Array.from({ length: colCount }, (_, i) => normalizeMarkdown(row[i] || ''))
    ),
  };
}

function repairInlineMarkdownTables(text: string): string {
  const rowSplit = text.replace(/\|\s+\|/g, '|\n|');
  const lines = rowSplit.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed.includes('|') || trimmed.startsWith('|')) {
      out.push(line);
      continue;
    }

    const next = lines[i + 1]?.trim() || '';
    if (!next || !isDivider(next)) {
      out.push(line);
      continue;
    }

    const firstPipe = line.indexOf('|');
    const prefix = line.slice(0, firstPipe).trim();
    const suffix = line.slice(firstPipe).trim();
    const dividerCells = parseRow(next).length;
    const suffixCells = parseRow(suffix).length;
    const fullCells = parseRow(line).length;

    if (prefix && suffixCells === dividerCells && fullCells !== dividerCells) {
      out.push(prefix, suffix);
    } else {
      out.push(`| ${trimmed.replace(/^\||\|$/g, '').trim()} |`);
    }
  }

  return out.join('\n');
}

function escapeTableCell(text: string): string {
  return normalizeMarkdown(text || '')
    .replace(/\n+/g, '<br>')
    .replace(/\|/g, '\\|')
    .trim();
}

function renderMarkdownPipeRow(cells: string[]): string {
  return `| ${cells.map(escapeTableCell).join(' | ')} |`;
}

export function renderMarkdownTableAsBlocks(headers: string[], rows: string[][]): string {
  const table = normalizeTable(headers, rows);
  const divider = `| ${table.headers.map(() => '---').join(' | ')} |`;
  return [
    renderMarkdownPipeRow(table.headers),
    divider,
    ...table.rows.map(renderMarkdownPipeRow),
  ].join('\n');
}

export function markdownTablesToBlockCards(text: string): string {
  const lines = repairInlineMarkdownTables(text).split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; ) {
    if (lines[i].trim().startsWith('```')) {
      const fenceLine = lines[i];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      const hasClosingFence = i < lines.length;
      if (hasClosingFence) i++;

      const convertedCode = markdownTablesToBlockCards(codeLines.join('\n'));
      if (convertedCode !== codeLines.join('\n')) {
        out.push(convertedCode);
      } else {
        out.push(fenceLine, ...codeLines);
        if (hasClosingFence) out.push('```');
      }
      continue;
    }

    const table = parseMarkdownTableBlock(lines, i) || parseLoosePipeTableBlock(lines, i);
    if (table) {
      if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
      out.push(renderMarkdownTableAsBlocks(table.headers, table.rows));
      if (table.end < lines.length && lines[table.end]?.trim()) out.push('');
      i = table.end;
      continue;
    }

    out.push(lines[i]);
    i++;
  }

  return out.join('\n');
}

export function boxDrawingTablesToBlockCards(text: string): string {
  return text;
}

function normalizeLine(line: string): string {
  return normalizeMarkdown(line)
    .toLowerCase()
    .replace(/[\s:,.!?'"`*_~]+/g, ' ')
    .trim();
}

function isGenericIntro(line: string): boolean {
  const normalized = normalizeLine(line);
  if (!normalized) return false;
  return (
    /^(oke|ok|siap|gas|langsung|nih|berikut|ini dia|gw bikin|aku bikin|saya buat|dibuat|here is|here are|below is|below are)\b/.test(
      normalized
    ) &&
    /(tabel|table|style|layout|langsung|sini|bro|bang|nih|berikut|structured|comparison|summary|data|format)/.test(
      normalized
    )
  );
}

function removeIntroSpam(text: string): string {
  let cleaned = text.replace(/(Oke bro,[^\n]{8,140}?)(?:\1)+/gi, '$1');
  const lines = cleaned.split('\n');

  while (lines.length > 1 && isGenericIntro(lines[0])) lines.shift();

  const deduped: string[] = [];
  for (const line of lines) {
    const current = normalizeLine(line);
    const previous = deduped.length ? normalizeLine(deduped[deduped.length - 1]) : '';
    if (current && current === previous) continue;
    deduped.push(line);
  }

  return deduped.join('\n').trim();
}

function removeTrailingOffers(text: string): string {
  const lines = text.trim().split('\n');
  while (lines.length > 1) {
    const last = normalizeLine(lines[lines.length - 1]);
    if (
      /\?$/.test(lines[lines.length - 1].trim()) &&
      /(mau|ingin|perlu|shall|should|want).*(kirim|buat|bikin|lanjut|ulang|continue|send|create|generate|retry|pdf|excel|file)/.test(
        last
      )
    ) {
      lines.pop();
      continue;
    }
    if (/(pdf|file|excel).*?(mau|ingin|perlu).*?(kirim|ulang|buat|bikin)/.test(last)) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join('\n').trim();
}

function normalizeSeparators(text: string): string {
  return text.replace(/^[\s─━═—-]{10,}\s*$/gm, '---');
}

function splitInlineMarkdownTables(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const firstPipe = line.indexOf('|');
    const next = lines[i + 1]?.trim() || '';
    if (firstPipe > 0 && isDivider(next) && line.slice(firstPipe).split('|').length >= 4) {
      const prefix = line.slice(0, firstPipe).trim();
      const tableStart = line.slice(firstPipe).trim();
      if (prefix && tableStart.startsWith('|')) {
        out.push(prefix, tableStart);
        continue;
      }
    }
    out.push(line);
  }

  return out.join('\n');
}

export function formatStructuredOutput(
  text: string,
  surface: StructuredSurface = 'gateway'
): string {
  if (surface === 'docs') return text;
  return normalizeSeparators(
    removeTrailingOffers(
      removeIntroSpam(markdownTablesToBlockCards(splitInlineMarkdownTables(text)))
    )
  );
}

export const STRUCTURED_OUTPUT_PROMPT = `# Structured output formatting
- For comparisons, summaries, rankings, specs, benchmarks, pros/cons, and other dense structured data, prefer compact summary tables with real columns.
- Use short headers, concise cell text, and status emoji only when it helps scanning.
- Keep tables narrow enough for mobile chat. Wrap long cells instead of turning the table into vertical cards.
- Start directly with the useful heading or content. Do not repeat filler intros or meta commentary about formatting.
- Do not end with permission/offering questions. If a file or artifact was generated, state the path once.
- Example summary-table style:
  📊 SUMMARY
  | Item | Category | Metric | Status |
  |---|---|---|---|
  | Example A | General | 123 | 🟢 Good |
  | Example B | General | 456 | 🟡 Watch |
- Use markdown pipe tables for structured chat answers when a compact summary is clearer; the runtime preserves pipe tables for gateway/mobile surfaces instead of converting them into box/ascii grids.
- For sections named like source confidence, benchmark results, claim status, model comparison, release status, pricing, specs, or capabilities, ALWAYS format the dense rows as a markdown pipe table with a header and divider row. Do not write loose A | B | C rows inside a paragraph.
- Use vertical label/value blocks only when each item has too many fields for a readable table.`;
