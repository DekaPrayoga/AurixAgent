import type { Provider } from '../providers/index.js';
import { MemoryEngine } from './MemoryEngine.js';

export interface MemoryLifecycleStatus {
  summaryChars: number;
  rawBytes: number;
  memoryBytes: number;
  sessionCount: number;
  lastSyncAt?: string;
}

export class MemoryManager {
  private engine: MemoryEngine;
  private lastSyncAt?: string;

  constructor(provider?: Provider) {
    this.engine = new MemoryEngine(provider);
  }

  setProvider(provider: Provider | undefined): void {
    this.engine.setProvider(provider);
  }

  loadForPrompt(): string {
    return this.engine.loadSummary();
  }

  rememberRaw(content: string): void {
    this.engine.appendRaw(content);
  }

  async sync(): Promise<void> {
    await this.engine.consolidate();
    await this.engine.mergeMemories();
    this.engine.purgeOldSessions();
    this.lastSyncAt = new Date().toISOString();
  }

  getStatus(): MemoryLifecycleStatus {
    const stats = this.engine.getStats();
    return {
      summaryChars: this.engine.loadSummary().length,
      rawBytes: stats.rawSize,
      memoryBytes: stats.memorySize,
      sessionCount: stats.sessionCount,
      lastSyncAt: this.lastSyncAt,
    };
  }

  getEngine(): MemoryEngine {
    return this.engine;
  }
}
