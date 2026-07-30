import assert from "node:assert/strict";
import {
  assistantSemanticClasses,
  enrichAssistantMarkdown,
  expandTextAttachments,
  layoutCommandRows,
  makePasteMarker,
  pendingSidebarTodos,
  removeTouchedPasteAttachment,
  type PasteAttachment,
} from "../../src/cli/TuiPresentation.js";
import { theme } from "../../src/cli/theme.js";
import { formatMcpTextResult } from "../../src/mcp/McpResultFormat.js";
import { applyAgentEvents, boundedLiveToolPreview, createPresentationState } from "../../src/cli/TurnState.js";

const answer = `# Result

Summary: Fixed the renderer.

- Run \`npm test\`
- Open [docs](https://example.com)

> Warning: verify output

| File | Status |
|---|---|
| src/app.ts | Success |

\`\`\`ts
const count = 12
\`\`\``;
const enriched = enrichAssistantMarkdown(answer);
const classes = assistantSemanticClasses(answer);
assert.ok(classes.length >= 7, `expected semantic variety, got ${classes.join(", ")}`);
assert.match(enriched, /\*\*Summary:\*\*/);
assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(enriched));
for (const key of ["markdownText", "markdownHeading", "markdownStrong", "markdownLink", "markdownCode", "markdownQuote"]) {
  assert.ok(String((theme as Record<string, unknown>)[key] || ""), `missing theme color ${key}`);
}
assert.equal(enrichAssistantMarkdown("```ts\nSummary: literal\n```"), "```ts\nSummary: literal\n```");

const image0: PasteAttachment = { id: 0, kind: "image", marker: makePasteMarker("image", 0), payload: "data:image/png;base64,AA" };
const image1: PasteAttachment = { id: 1, kind: "image", marker: makePasteMarker("image", 1), payload: "data:image/png;base64,BB" };
const pasted: PasteAttachment = { id: 2, kind: "text", marker: makePasteMarker("text", 2), payload: "line one\nline two" };
let result = removeTouchedPasteAttachment("[Image 0] [Image 1]", "[Image 0 [Image 1]", [image0, image1]);
assert.deepEqual(result.attachments.map((item) => item.id), [1]);
assert.equal(result.value, "[Image 1]");
result = removeTouchedPasteAttachment("[Pasted 2] prompt", "[Pasted  prompt", [pasted]);
assert.equal(result.attachments.length, 0);
assert.equal(result.value, "prompt");
assert.equal(expandTextAttachments("Use [Pasted 2]", [pasted]), "Use line one\nline two");

const todoPanel = pendingSidebarTodos([
  { text: "done", done: true },
  { text: "active", done: false },
  { text: "queued", done: false },
], 1);
assert.deepEqual(todoPanel.visible.map((todo) => todo.text), ["active"]);
assert.equal(todoPanel.pending, 2);
assert.equal(todoPanel.hidden, 1);
assert.equal(pendingSidebarTodos([{ text: "done", done: true }]).pending, 0);

const rows = layoutCommandRows([
  { command: "/mcp", description: "MCP manager", hint: "[name]" },
  { command: "/addskills", description: "Load skills" },
  { command: "/history-search", description: "Search history", hint: "<query>" },
], 72, Bun.stringWidth);
const starts = rows.map((row) => Bun.stringWidth(row.command + row.commandPad));
assert.equal(new Set(starts).size, 1, `descriptions do not align: ${starts.join(",")}`);
const queued = formatMcpTextResult(JSON.stringify({
  ok: true,
  mode: "async",
  jobid: "job_123",
  status: "queued",
  message: "url_enum queued",
  counts: { findings: 0 },
  top_findings: [],
  next: {
    job_status: { jobid: "job_123" },
    get_findings: { jobid: "job_123" },
    engagement_summary: { engagementid: "eng_456" },
  },
  engagementid: "eng_456",
}));
assert.match(queued, /# Job Queued/);
assert.match(queued, /`job_123`/);
assert.match(queued, /job_status\(jobid="job_123"\)/);
assert.ok(!queued.includes('"jobid":'));

const completed = formatMcpTextResult(JSON.stringify({
  ok: true,
  job: {
    jobid: "job_123",
    tool: "playbook_osint_domain",
    status: "succeeded",
    started_at: "2026-07-30T09:49:09.151005+00:00",
    finished_at: "2026-07-30T09:52:04.113401+00:00",
    progress: { percent: 100, message: "succeeded" },
    danger_level: "passive",
    timeout_sec: 1800,
    summary: "dns\ntransparency=31",
    findings_count: 59,
    exit_code: 0,
    engagementid: "eng_456",
  },
  counts: { findings: 59, by_severity: { info: 59 }, by_type: { subdomain: 31 } },
  top_findings: [
    { findingid: "fnd_1", type: "subdomain", severity: "info", title: "api.example.com", target: "example.com", sourcetool: "dns", confidence: "medium" },
    { findingid: "fnd_2", type: "info", severity: "info", title: "SPF record", target: "example.com" },
  ],
}));
for (const expected of ["# Job Succeeded", "100%", "2m 55s", "59", "Info: 59", "Subdomain: 31", "dns transparency=31", "fnd_1", "fnd_2", "eng_456"]) {
  assert.ok(completed.includes(expected), `missing formatted job detail: ${expected}`);
}
assert.ok(!completed.includes('"top_findings"'));
assert.equal(formatMcpTextResult('{broken'), '{broken');

const searchTools = formatMcpTextResult(JSON.stringify({
  ok: true,
  query: "ssrf auth bypass",
  count: 2,
  matches: [
    { name: "open_redirect_test", title: "Open Redirect Test", category: "scan", danger_level: "active", async: true, min_plan: "free", description: "Open redirect parameter checks.", tags: ["scan", "web", "redirect"], implemented: true, score: 61 },
    { name: "oauth_misconfig", title: "OAuth Misconfig Check", category: "scan", danger_level: "active", async: true, min_plan: "free", description: "OAuth redirect checks.", tags: ["auth", "oauth"], implemented: true, score: 39 },
  ],
  hint: "Call get_tool_info(name) for full params before invoking.",
}));
assert.match(searchTools, /# MCP Search Results/);
assert.match(searchTools, /Open Redirect Test/);
assert.match(searchTools, /`open_redirect_test`/);
assert.match(searchTools, /scan · danger: active · async · plan: free · score: 61/);
assert.match(searchTools, /Tags: `scan`, `web`, `redirect`/);
assert.match(searchTools, /Call get_tool_info/);
assert.ok(!searchTools.includes('"matches"'));

const chatAreaSource = await Bun.file(new URL("../../src/cli/ChatArea.tsx", import.meta.url)).text();
assert.match(chatAreaSource, /stickyScroll=\{true\}/);
assert.ok(!chatAreaSource.includes("scroll.stickyScroll = false"));
assert.ok(!chatAreaSource.includes("stickyScroll={atBottom}"));

const chunkEvents = [
  { type: "tool_start", data: "", toolName: "terminal", toolCallId: "call-1", turnId: "turn-1" },
  ...Array.from({ length: 1000 }, (_, index) => ({ type: "tool_chunk", data: `line ${index} ${"x".repeat(40)}`, toolName: "terminal", toolCallId: "call-1", turnId: "turn-1" })),
  { type: "tool_end", data: "complete final output", toolName: "terminal", toolCallId: "call-1", turnId: "turn-1", status: "success" },
] as any[];
const batchStarted = performance.now();
const batchState = applyAgentEvents(createPresentationState(), chunkEvents, { model: "test" });
assert.ok(performance.now() - batchStarted < 1500, "batched tool events exceeded performance budget");
const toolMessage = batchState.messages.find((message) => message.role === "tool");
assert.equal(toolMessage?.content, "complete final output");
const bounded = boundedLiveToolPreview(Array.from({ length: 500 }, (_, index) => `line-${index}`).join("\n"));
assert.ok(bounded.length <= 17_000);
assert.match(bounded, /live output trimmed/);

console.log("TUI regression checks passed: semantic colors, atomic paste, slash alignment, MCP jobs, event batching");
