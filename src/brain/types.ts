import type { EvidenceItem } from '../agent/SessionStore.js';

export interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
  json: boolean;
  source: 'config' | 'registry' | 'heuristic' | 'unknown';
  notes?: string[];
}

export interface RepoBrainEntry {
  path: string;
  kind: 'source' | 'config' | 'docs' | 'test' | 'script' | 'unknown';
  language?: string;
  symbols: string[];
  imports: string[];
  summary: string;
  mtimeMs: number;
  size: number;
}

export interface RepoBrainIndex {
  root: string;
  version: 1;
  generatedAt: string;
  entries: RepoBrainEntry[];
}

export interface BrainToolResult {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  status: 'success' | 'error' | 'timeout' | 'cancelled';
  errorType?: string;
  turnId: string;
}

export interface BrainScratchpadState {
  sessionId: string;
  turnId?: string;
  facts: string[];
  openQuestions: string[];
  nextActions: string[];
  risks: string[];
  evidenceRefs: string[];
}

export interface BrowserFusedState {
  session?: string;
  url?: string;
  title?: string;
  screenshotPath?: string;
  domSummary?: string;
  textSummary?: string;
  updatedAt: string;
}

export interface EvidenceGateDecision {
  action: 'allow' | 'allow_with_caveat' | 'block';
  reason: string;
  requiredEvidence?: Array<EvidenceItem['kind']>;
  systemMessage?: string;
}
