import initSqlJs, { Database } from 'sql.js';
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

// Global cache to prevent multiple initSqlJs calls
let SQL: initSqlJs.SqlJsStatic | null = null;

export async function useSQLiteAuthState(dbPath?: string): Promise<{ state: SQLiteAuthState; saveCreds: (creds: any) => void }> {
  const resolvedPath = dbPath || path.join(os.homedir(), '.aurix', 'wa-session.db');
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!SQL) {
    SQL = await initSqlJs();
  }

  let db: Database;
  if (fs.existsSync(resolvedPath)) {
    const fileBuffer = fs.readFileSync(resolvedPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

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

  // Debounced save to disk
  let saveTimeout: NodeJS.Timeout | null = null;
  const saveToDisk = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      const data = db.export();
      const buffer = Buffer.from(data);
      // Atomic write using a temporary file
      const tempPath = `${resolvedPath}.tmp`;
      fs.writeFileSync(tempPath, buffer);
      fs.renameSync(tempPath, resolvedPath);
      saveTimeout = null;
    }, 1000); // Save after 1 second of inactivity
  };

  const getCredsStmt = db.prepare('SELECT data FROM wa_credentials WHERE id = ?');
  const setCredsStmt = db.prepare('INSERT OR REPLACE INTO wa_credentials (id, data) VALUES (?, ?)');
  const setKeyStmt = db.prepare('INSERT OR REPLACE INTO wa_keys (type, id, data) VALUES (?, ?, ?)');
  const deleteKeyStmt = db.prepare('DELETE FROM wa_keys WHERE type = ? AND id = ?');

  let creds: any = null;

  // Read main creds
  getCredsStmt.bind(['main']);
  if (getCredsStmt.step()) {
    const row = getCredsStmt.getAsObject();
    try {
      if (row && typeof row.data === 'string') {
        creds = JSON.parse(row.data);
      }
    } catch {}
  }
  getCredsStmt.reset();

  if (!creds) {
    const { initAuthCreds } = await import('@whiskeysockets/baileys');
    creds = initAuthCreds();
  }

  const saveCreds = (newCreds: any) => {
    const data = JSON.stringify(newCreds);
    setCredsStmt.run(['main', data]);
    saveToDisk();
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const data: Record<string, any> = {};
          const stmt = db.prepare('SELECT id, data FROM wa_keys WHERE type = ? AND id IN (' + ids.map(() => '?').join(',') + ')');
          stmt.bind([type, ...ids]);
          while (stmt.step()) {
            const row = stmt.getAsObject();
            if (row && typeof row.id === 'string' && typeof row.data === 'string') {
              try {
                data[row.id] = JSON.parse(row.data);
              } catch {}
            }
          }
          stmt.free();

          return ids.reduce((dict, id) => {
            let value = data[id];
            if (type === 'app-state-sync-key' && value) {
              const { proto } = require('@whiskeysockets/baileys');
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            dict[id] = value;
            return dict;
          }, {} as Record<string, any>);
        },
        set: async (data: Record<string, Record<string, any>>) => {
          db.exec('BEGIN TRANSACTION;');
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              if (value) {
                const valStr = JSON.stringify(value, (key, val) => {
                  if (val && val.type === 'Buffer' && Array.isArray(val.data)) {
                    return Buffer.from(val.data).toString('base64');
                  }
                  return val;
                });
                setKeyStmt.run([category, id, valStr]);
              } else {
                deleteKeyStmt.run([category, id]);
              }
            }
          }
          db.exec('COMMIT;');
          saveToDisk();
        }
      }
    },
    saveCreds: (newCreds: any) => {
      creds = newCreds;
      saveCreds(newCreds);
    }
  };
}
