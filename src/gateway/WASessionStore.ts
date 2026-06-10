import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

interface SQLiteAuthState {
  creds: any;
  keys: {
    get(type: string, ids: string[]): Promise<Record<string, any>>;
    set(data: Record<string, Record<string, any>>): Promise<void>;
  };
}

export function useSQLiteAuthState(dbPath?: string): Promise<{ state: SQLiteAuthState; saveCreds: (creds: any) => void }> {
  const resolvedPath = dbPath || path.join(os.homedir(), '.aurix', 'wa-session.db');
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_credentials (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wa_keys (
      type TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (type, id)
    );
  `);

  const getCredsStmt = db.prepare('SELECT data FROM wa_credentials WHERE id = ?');
  const setCredsStmt = db.prepare('INSERT OR REPLACE INTO wa_credentials (id, data) VALUES (?, ?)');
  const setKeyStmt = db.prepare('INSERT OR REPLACE INTO wa_keys (type, id, data) VALUES (?, ?, ?)');
  const deleteKeyStmt = db.prepare('DELETE FROM wa_keys WHERE type = ? AND id = ?');

  let creds: any = null;
  const row = getCredsStmt.get('main') as { data: string } | undefined;
  if (row) {
    try {
      creds = JSON.parse(row.data, bufferReviver);
    } catch {
      creds = null;
    }
  }

  function saveCreds(newCreds: any): void {
    creds = newCreds;
    setCredsStmt.run('main', JSON.stringify(newCreds, bufferReplacer));
  }

  const keys = {
    async get(type: string, ids: string[]): Promise<Record<string, any>> {
      const result: Record<string, any> = {};
      if (ids.length === 0) return result;

      const placeholders = ids.map(() => '?').join(',');
      const stmt = db.prepare(`SELECT id, data FROM wa_keys WHERE type = ? AND id IN (${placeholders})`);
      const rows = stmt.all(type, ...ids) as { id: string; data: string }[];

      for (const row of rows) {
        try {
          result[row.id] = JSON.parse(row.data, bufferReviver);
        } catch {
          result[row.id] = null;
        }
      }

      return result;
    },

    async set(data: Record<string, Record<string, any>>): Promise<void> {
      const transaction = db.transaction(() => {
        for (const [type, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries)) {
            if (value === undefined || value === null) {
              deleteKeyStmt.run(type, id);
            } else {
              setKeyStmt.run(type, id, JSON.stringify(value, bufferReplacer));
            }
          }
        }
      });
      transaction();
    },
  };

  return Promise.resolve({
    state: { creds, keys },
    saveCreds,
  });
}

function bufferReviver(_key: string, value: any): any {
  if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  return value;
}

function bufferReplacer(_key: string, value: any): any {
  if (Buffer.isBuffer(value)) {
    return { type: 'Buffer', data: Array.from(value) };
  }
  return value;
}
