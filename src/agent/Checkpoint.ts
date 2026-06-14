import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';

// Lightweight file-history engine for the rewind feature. A "checkpoint" is
// keyed by a user-message id. We track every file BEFORE it is edited (so the
// pre-edit bytes are captured), then a snapshot records which backup version
// represents each tracked file at that point. Restore replays a snapshot to
// disk. Backups are content-addressed copies — no git, no temp worktrees.

const HISTORY_ROOT = path.join(os.homedir(), '.aurix', 'file-history');
const MAX_SNAPSHOTS = 100;

export interface FileBackup {
  backupFileName: string | null; // null => file did not exist at this version
  version: number;
}
export interface Snapshot {
  checkpointId: string;
  fileBackups: Record<string, FileBackup>;
  timestamp: number;
}

interface HistoryState {
  snapshots: Snapshot[];
  trackedFiles: Set<string>;
  versions: Record<string, number>; // path -> latest backup version
}

export class CheckpointEngine {
  private sessionId: string;
  private dir: string;
  private state: HistoryState = { snapshots: [], trackedFiles: new Set(), versions: {} };

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.dir = path.join(HISTORY_ROOT, sessionId);
    this.load();
  }

  private statePath(): string {
    return path.join(this.dir, 'snapshots.json');
  }

  private load(): void {
    try {
      const p = this.statePath();
      if (!fs.existsSync(p)) return;
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
      this.state.snapshots = raw.snapshots || [];
      this.state.trackedFiles = new Set(raw.trackedFiles || []);
      this.state.versions = raw.versions || {};
      this.nullVersions = new Set(raw.nullVersions || []);
    } catch {
      // corrupt/missing state must never break startup
    }
  }

  private save(): void {
    try {
      this.ensureDir();
      const data = {
        snapshots: this.state.snapshots,
        trackedFiles: Array.from(this.state.trackedFiles),
        versions: this.state.versions,
        nullVersions: Array.from(this.nullVersions),
      };
      fs.writeFileSync(this.statePath(), JSON.stringify(data));
    } catch {
      // persistence is best-effort
    }
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  private backupName(filePath: string, version: number): string {
    const hash = createHash('sha256').update(filePath).digest('hex').slice(0, 16);
    return `${hash}@v${version}`;
  }

  private backupPath(name: string): string {
    return path.join(this.dir, name);
  }

  // Capture a file's CURRENT bytes before it is edited. Safe to call repeatedly;
  // only creates a new backup version when the file actually changed.
  trackBeforeEdit(filePath: string): void {
    try {
      const abs = path.resolve(filePath);
      this.state.trackedFiles.add(abs);
      const exists = fs.existsSync(abs);
      const curVersion = this.state.versions[abs] || 0;

      // If we already have a backup and the file is unchanged since it, skip.
      if (curVersion > 0) {
        const prevName = this.backupName(abs, curVersion);
        if (!this.differs(abs, prevName)) return;
      }

      const nextVersion = curVersion + 1;
      this.ensureDir();
      if (!exists) {
        // record a "did not exist" marker by leaving no file; version maps to null
        this.state.versions[abs] = nextVersion;
        this.nullVersions.add(`${abs}@v${nextVersion}`);
        this.save();
        return;
      }
      const name = this.backupName(abs, nextVersion);
      fs.copyFileSync(abs, this.backupPath(name));
      try { fs.chmodSync(this.backupPath(name), fs.statSync(abs).mode); } catch {}
      this.state.versions[abs] = nextVersion;
      this.save();
    } catch {
      // tracking must never break a tool call
    }
  }

  private nullVersions = new Set<string>();

  // true if the on-disk file differs from a stored backup (or backup missing).
  private differs(filePath: string, backupName: string): boolean {
    try {
      const bp = this.backupPath(backupName);
      if (!fs.existsSync(bp)) return true;
      if (!fs.existsSync(filePath)) return true;
      const a = fs.readFileSync(filePath);
      const b = fs.readFileSync(bp);
      return !a.equals(b);
    } catch {
      return true;
    }
  }

  // Commit a snapshot for the given checkpoint id, recording the current backup
  // version of every tracked file.
  commit(checkpointId: string): void {
    const fileBackups: Record<string, FileBackup> = {};
    for (const f of this.state.trackedFiles) {
      const version = this.state.versions[f] || 0;
      const isNull = this.nullVersions.has(`${f}@v${version}`);
      fileBackups[f] = {
        version,
        backupFileName: isNull || version === 0 ? null : this.backupName(f, version),
      };
    }
    this.state.snapshots.push({ checkpointId, fileBackups, timestamp: Date.now() });
    if (this.state.snapshots.length > MAX_SNAPSHOTS) this.state.snapshots.shift();
    this.save();
  }

  hasSnapshot(checkpointId: string): boolean {
    return this.state.snapshots.some(s => s.checkpointId === checkpointId);
  }

  private findSnapshot(checkpointId: string): Snapshot | undefined {
    for (let i = this.state.snapshots.length - 1; i >= 0; i--) {
      if (this.state.snapshots[i].checkpointId === checkpointId) return this.state.snapshots[i];
    }
    return undefined;
  }

  // Count of files that changed between a checkpoint and now (for UI hints).
  changedSince(checkpointId: string): number {
    const snap = this.findSnapshot(checkpointId);
    if (!snap) return 0;
    let n = 0;
    for (const f of Object.keys(snap.fileBackups)) {
      const b = snap.fileBackups[f];
      if (b.backupFileName === null) {
        if (fs.existsSync(f)) n++;
      } else if (this.differs(f, b.backupFileName)) {
        n++;
      }
    }
    return n;
  }

  // Restore disk state to the chosen checkpoint. Pure side-effect; snapshots are
  // not popped, so the user can rewind repeatedly. Returns changed file paths.
  restore(checkpointId: string): string[] {
    const snap = this.findSnapshot(checkpointId);
    if (!snap) return [];
    const changed: string[] = [];
    for (const f of Object.keys(snap.fileBackups)) {
      const b = snap.fileBackups[f];
      try {
        if (b.backupFileName === null) {
          if (fs.existsSync(f)) { fs.unlinkSync(f); changed.push(f); }
          continue;
        }
        if (this.differs(f, b.backupFileName)) {
          fs.copyFileSync(this.backupPath(b.backupFileName), f);
          changed.push(f);
        }
      } catch {
        // skip files that can't be restored
      }
    }
    return changed;
  }
}

let engine: CheckpointEngine | null = null;
export function getCheckpointEngine(): CheckpointEngine | null {
  return engine;
}
export function initCheckpointEngine(sessionId: string): CheckpointEngine {
  engine = new CheckpointEngine(sessionId);
  return engine;
}
