interface CapabilityEntry {
  name?: unknown;
  title?: unknown;
  category?: unknown;
  danger_level?: unknown;
  async?: unknown;
  min_plan?: unknown;
  description?: unknown;
  when_to_use?: unknown;
  implemented?: unknown;
}

type RecordValue = Record<string, unknown>;

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function clean(value: unknown): string {
  return text(value).replace(/\s+/g, ' ').trim();
}

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function label(value: unknown): string {
  return clean(value).replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function inlineCounts(value: unknown): string {
  const input = record(value);
  if (!input) return '';
  return Object.entries(input).map(([key, count]) => `${label(key)}: ${clean(count)}`).join(' · ');
}

function duration(start: unknown, finish: unknown): string {
  const from = Date.parse(text(start));
  const to = Date.parse(text(finish));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return '';
  const seconds = Math.round((to - from) / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${rest}s` : `${seconds}s`;
}

function formatNextActions(value: unknown): string[] {
  const next = record(value);
  if (!next) return [];
  const lines = ['', '## Next Actions'];
  for (const [action, params] of Object.entries(next)) {
    const values = record(params);
    const args = values
      ? Object.entries(values).map(([key, item]) => `${key}=${JSON.stringify(item)}`).join(', ')
      : clean(params);
    lines.push(`- **${label(action)}:** \`${action}(${args})\``);
  }
  return lines.length > 2 ? lines : [];
}

function formatFindings(items: unknown): string[] {
  const findings = list(items).map(record).filter((item): item is RecordValue => Boolean(item));
  if (!findings.length) return [];
  const lines = ['', '## Findings'];
  findings.forEach((finding, index) => {
    const title = clean(finding.title || finding.name || finding.type || `Finding ${index + 1}`);
    const metadata = [
      clean(finding.severity || finding.level),
      clean(finding.type),
      finding.target ? `target: \`${clean(finding.target)}\`` : '',
      finding.source_tool || finding.sourcetool ? `source: \`${clean(finding.source_tool || finding.sourcetool)}\`` : '',
      finding.confidence ? `confidence: ${clean(finding.confidence)}` : '',
    ].filter(Boolean).join(' · ');
    lines.push(`${index + 1}. **${title}**${metadata ? ` — ${metadata}` : ''}`);
    const description = clean(finding.description || finding.summary || finding.detail || finding.value);
    if (description && description !== title) lines.push(`   ${description}`);
    const id = finding.finding_id || finding.findingid || finding.id;
    if (id) lines.push(`   ID: \`${clean(id)}\``);
  });
  return lines;
}

function formatStats(countsValue: unknown, fallback?: unknown): string[] {
  const counts = record(countsValue);
  if (!counts && fallback === undefined) return [];
  const total = counts?.findings ?? counts?.total ?? fallback;
  const lines = ['', '## Counts'];
  if (total !== undefined) lines.push(`- **Findings:** ${clean(total)}`);
  const severity = inlineCounts(counts?.by_severity || counts?.severity);
  const types = inlineCounts(counts?.by_type || counts?.types);
  if (severity) lines.push(`- **Severity:** ${severity}`);
  if (types) lines.push(`- **Types:** ${types}`);
  return lines.length > 2 ? lines : [];
}

function isCapabilityCatalog(value: unknown): value is RecordValue & { tools: CapabilityEntry[] } {
  const input = record(value);
  return Boolean(input && Array.isArray(input.tools) && (
    typeof input.catalog_total === 'number' ||
    typeof input.category_counts === 'object' ||
    input.tools.some((tool) => tool && typeof tool === 'object' && ('category' in tool || 'danger_level' in tool))
  ));
}

function formatCapabilityCatalog(catalog: RecordValue & { tools: CapabilityEntry[] }): string {
  const total = Number(catalog.catalog_total ?? catalog.registry_defined ?? catalog.tools.length);
  const count = Number(catalog.count ?? catalog.tools.length);
  const offset = Number(catalog.offset ?? 0);
  const lines = [
    '# MCP Capabilities',
    '',
    `Total: ${Number.isFinite(total) ? total : catalog.tools.length} · Returned: ${count} · Range: ${count ? offset + 1 : 0}-${offset + count}`,
  ];
  const categoryCounts = record(catalog.category_counts);
  const categories = categoryCounts
    ? Object.entries(categoryCounts).map(([name, value]) => `${name}: ${clean(value)}`).join(' · ')
    : '';
  if (categories) lines.push(`Categories: ${categories}`);
  lines.push('', '## Tools');
  for (const tool of catalog.tools) {
    const name = text(tool.name) || 'unnamed';
    const title = text(tool.title);
    const metadata = [text(tool.category), text(tool.danger_level) ? `danger: ${text(tool.danger_level)}` : '', text(tool.min_plan) ? `plan: ${text(tool.min_plan)}` : '', tool.async === true ? 'async' : tool.async === false ? 'sync' : '', tool.implemented === false ? 'not implemented' : ''].filter(Boolean).join(' · ');
    lines.push(`- **${title || name}**${title && title !== name ? ` (\`${name}\`)` : ''}${metadata ? ` — ${metadata}` : ''}`);
    if (tool.description) lines.push(`  ${clean(tool.description)}`);
    if (tool.when_to_use) lines.push(`  Use when: ${clean(tool.when_to_use)}`);
  }
  if (catalog.truncated === true) {
    const next = record(catalog.next);
    const nextCall = next ? record(next.list_capabilities) : undefined;
    const nextOffset = nextCall?.offset;
    lines.push('', `> ⚠ Catalog truncated after ${count} entries.${nextOffset !== undefined ? ` Continue from offset ${clean(nextOffset)}.` : ''}`);
  }
  if (Array.isArray(catalog.notes) && catalog.notes.length) lines.push('', '## Notes', ...catalog.notes.map((note) => `- ${clean(note)}`));
  return lines.join('\n');
}

function isSearchResult(value: unknown): value is RecordValue & { matches: unknown[] } {
  const input = record(value);
  return Boolean(input && Array.isArray(input.matches) && (input.query !== undefined || input.count !== undefined));
}

function formatSearchResult(result: RecordValue & { matches: unknown[] }): string {
  const lines = ['# MCP Search Results'];
  if (result.query !== undefined) lines.push('', `**Query:** ${clean(result.query)}`);
  lines.push(`**Matches:** ${clean(result.count ?? result.matches.length)}`);
  const matches = result.matches.map(record).filter((item): item is RecordValue => Boolean(item));
  if (matches.length) lines.push('', '## Tools');
  matches.forEach((match, index) => {
    const name = clean(match.name || match.id || `result_${index + 1}`);
    const title = clean(match.title || match.label || name);
    const metadata = [
      clean(match.category || match.type),
      match.danger_level ? `danger: ${clean(match.danger_level)}` : '',
      match.async === true ? 'async' : match.async === false ? 'sync' : '',
      match.min_plan ? `plan: ${clean(match.min_plan)}` : '',
      match.score !== undefined ? `score: ${clean(match.score)}` : '',
      match.implemented === false ? 'not implemented' : '',
    ].filter(Boolean).join(' · ');
    lines.push(`${index + 1}. **${title}**${title !== name ? ` (\`${name}\`)` : ''}${metadata ? ` — ${metadata}` : ''}`);
    const description = clean(match.description || match.summary || match.detail);
    if (description) lines.push(`   ${description}`);
    const tags = list(match.tags).map(clean).filter(Boolean);
    if (tags.length) lines.push(`   Tags: ${tags.map((tag) => `\`${tag}\``).join(', ')}`);
  });
  if (result.hint) lines.push('', '## Hint', clean(result.hint));
  if (result.truncated === true) lines.push('', '> ⚠ Search results were truncated by the MCP server.');
  lines.push(...formatNextActions(result.next));
  return lines.join('\n');
}

function isJobStatus(value: unknown): value is RecordValue & { job: RecordValue } {
  const input = record(value);
  return Boolean(input && record(input.job) && ('status' in (input.job as RecordValue) || 'progress' in (input.job as RecordValue)));
}

function formatJobStatus(result: RecordValue & { job: RecordValue }): string {
  const job = result.job;
  const progress = record(job.progress);
  const status = clean(job.status || progress?.message || 'unknown');
  const elapsed = duration(job.started_at || job.startedAt, job.finished_at || job.finishedAt);
  const lines = [
    `# Job ${label(status)}`,
    '',
    `**Tool:** ${label(job.tool || job.tool_name || job.name || 'Unknown')}`,
    `**Job:** \`${clean(job.jobid || job.job_id || job.id)}\``,
  ];
  const percent = progress?.percent;
  lines.push(`**Progress:** ${percent !== undefined ? `${clean(percent)}% · ` : ''}${clean(progress?.message || status)}${progress?.phase ? ` · ${clean(progress.phase)}` : ''}`);
  if (elapsed) lines.push(`**Duration:** ${elapsed}`);
  if (job.created_at || job.createdAt) lines.push(`**Created:** ${clean(job.created_at || job.createdAt)}`);
  if (job.started_at || job.startedAt) lines.push(`**Started:** ${clean(job.started_at || job.startedAt)}`);
  if (job.finished_at || job.finishedAt) lines.push(`**Finished:** ${clean(job.finished_at || job.finishedAt)}`);
  if (job.danger_level) lines.push(`**Danger:** ${clean(job.danger_level)}`);
  if (job.timeout_sec !== undefined) lines.push(`**Timeout:** ${clean(job.timeout_sec)}s`);
  if (job.exit_code !== undefined && job.exit_code !== null) lines.push(`**Exit Code:** ${clean(job.exit_code)}`);
  const engagement = job.engagementid || job.engagement_id || result.engagementid || result.engagement_id;
  if (engagement) lines.push(`**Engagement:** \`${clean(engagement)}\``);
  if (job.error) lines.push('', '## Error', clean(job.error));
  if (job.summary) lines.push('', '## Summary', clean(job.summary));
  lines.push(...formatStats(result.counts, job.findings_count));
  lines.push(...formatFindings(result.top_findings || result.findings));
  const artifacts = list(job.artifacts || result.artifacts);
  if (artifacts.length) lines.push('', '## Artifacts', ...artifacts.map((artifact) => `- ${clean(record(artifact)?.name || record(artifact)?.path || artifact)}`));
  if (result.truncated === true) lines.push('', '> ⚠ Results were truncated by the MCP server. Use the continuation action below.');
  lines.push(...formatNextActions(result.next));
  return lines.join('\n');
}

function isAsyncResult(value: unknown): value is RecordValue {
  const input = record(value);
  return Boolean(input && (input.mode === 'async' || input.status === 'queued') && (input.jobid || input.job_id));
}

function formatAsyncResult(result: RecordValue): string {
  const status = clean(result.status || 'queued');
  const lines = [
    `# Job ${label(status)}`,
    '',
    `**Job:** \`${clean(result.jobid || result.job_id)}\``,
  ];
  if (result.tool || result.tool_name) lines.push(`**Tool:** ${label(result.tool || result.tool_name)}`);
  if (result.mode) lines.push(`**Mode:** ${clean(result.mode)}`);
  if (result.message) lines.push(`**Message:** ${clean(result.message)}`);
  if (result.engagementid || result.engagement_id) lines.push(`**Engagement:** \`${clean(result.engagementid || result.engagement_id)}\``);
  if (result.summary) lines.push('', '## Summary', clean(result.summary));
  lines.push(...formatStats(result.counts));
  lines.push(...formatFindings(result.top_findings || result.findings));
  if (result.truncated === true) lines.push('', '> ⚠ Results were truncated by the MCP server.');
  lines.push(...formatNextActions(result.next));
  return lines.join('\n');
}

function isFindingsResult(value: unknown): value is RecordValue {
  const input = record(value);
  return Boolean(input && (Array.isArray(input.findings) || Array.isArray(input.top_findings)) && (input.counts || input.engagementid || input.engagement_id));
}

function formatFindingsResult(result: RecordValue): string {
  const lines = ['# MCP Findings'];
  if (result.engagementid || result.engagement_id) lines.push('', `**Engagement:** \`${clean(result.engagementid || result.engagement_id)}\``);
  if (result.summary) lines.push('', '## Summary', clean(result.summary));
  lines.push(...formatStats(result.counts));
  lines.push(...formatFindings(result.findings || result.top_findings));
  if (result.truncated === true) lines.push('', '> ⚠ Results were truncated by the MCP server.');
  lines.push(...formatNextActions(result.next));
  return lines.join('\n');
}

function formatGenericMcpResult(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return 'No result.';
  if (typeof value !== 'object') return clean(value);
  if (Array.isArray(value)) {
    if (!value.length) return 'No items.';
    return value.map((item, index) => {
      const formatted = formatGenericMcpResult(item, depth + 1);
      return typeof item === 'object' && item !== null
        ? `${index + 1}. ${formatted.replace(/\n/g, '\n   ')}`
        : `- ${formatted}`;
    }).join('\n');
  }
  const entries = Object.entries(value as RecordValue);
  if (!entries.length) return 'No fields.';
  return entries.map(([key, item]) => {
    const heading = depth === 0 ? `**${label(key)}:**` : `${label(key)}:`;
    if (item && typeof item === 'object') {
      const nested = formatGenericMcpResult(item, depth + 1).replace(/\n/g, '\n  ');
      return `${heading}\n  ${nested}`;
    }
    return `${heading} ${clean(item)}`;
  }).join('\n');
}

export function formatMcpTextResult(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;
  try {
    const parsed = JSON.parse(trimmed);
    if (isCapabilityCatalog(parsed)) return formatCapabilityCatalog(parsed);
    if (isSearchResult(parsed)) return formatSearchResult(parsed);
    if (isJobStatus(parsed)) return formatJobStatus(parsed);
    if (isAsyncResult(parsed)) return formatAsyncResult(parsed);
    if (isFindingsResult(parsed)) return formatFindingsResult(parsed);
    return formatGenericMcpResult(parsed);
  } catch {
    return value;
  }
}

export function withMcpToolDefaults(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  if (toolName !== 'list_capabilities' || args.limit !== undefined) return args;
  return { ...args, limit: 200 };
}
