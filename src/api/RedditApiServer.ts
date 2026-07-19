import http, { type IncomingMessage, type Server, type ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { handleComments, handleOptions, handleSearch, relayHealth, setCors } from './RedditRelayCore.js';

type JsonPayload = unknown;
type RedditApiHandle = {
  server?: Server;
  url: string;
  port: number;
  host: string;
  close: () => Promise<void>;
};

let autoServer: RedditApiHandle | undefined;

class ApiResponse {
  private statusCode = 200;

  constructor(private readonly res: ServerResponse) {}

  setHeader(name: string, value: string) {
    this.res.setHeader(name, value);
    return this;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(payload: JsonPayload) {
    if (!this.res.headersSent) {
      this.res.statusCode = this.statusCode;
      this.res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    this.res.end(JSON.stringify(payload));
  }

  end(payload?: string) {
    if (!this.res.headersSent) this.res.statusCode = this.statusCode;
    this.res.end(payload);
  }
}

function sendNotFound(res: ApiResponse) {
  return res.status(404).json({
    ok: false,
    error: { code: 'not_found', message: 'Unknown Aurix API endpoint.' },
  });
}

function handleHealth(req: IncomingMessage, res: ApiResponse) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    return res.status(405).json({
      ok: false,
      error: { code: 'method_not_allowed', message: 'Use GET for this endpoint.' },
    });
  }
  return res.status(200).json(relayHealth());
}

function normalizePath(req: IncomingMessage): string {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);
  return url.pathname.replace(/\/+$/, '') || '/';
}

export function createRedditApiServer() {
  return http.createServer(async (req, rawRes) => {
    const res = new ApiResponse(rawRes);
    const path = normalizePath(req);

    try {
      if (path === '/api/health' || path === '/health') return handleHealth(req, res);
      if (path === '/api/reddit/search' || path === '/reddit/search') {
        return await handleSearch(req, res);
      }
      if (path === '/api/reddit/comments' || path === '/reddit/comments') {
        return await handleComments(req, res);
      }
      setCors(res);
      if (handleOptions(req, res)) return;
      return sendNotFound(res);
    } catch (error: any) {
      return res.status(500).json({
        ok: false,
        error: {
          code: 'internal_error',
          message: String(error?.message || error || 'Internal server error.').slice(0, 300),
        },
        items: [],
      });
    }
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function resolvePort(raw: string | number | undefined, fallback: number): number {
  const port = Number(raw ?? fallback);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return fallback;
  return port;
}

async function probeExisting(url: string): Promise<RedditApiHandle | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(`${url}/api/health`, { signal: controller.signal });
    if (!response.ok) return undefined;
    const json = await response.json().catch(() => undefined);
    if (json?.service !== 'aurix-reddit-relay') return undefined;
    const parsed = new URL(url);
    return {
      url,
      host: parsed.hostname,
      port: Number(parsed.port),
      close: async () => {},
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function listen(server: Server, port: number, host: string): Promise<RedditApiHandle> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address() as AddressInfo;
      const actualHost = address.address === '::' ? '127.0.0.1' : address.address;
      const url = `http://${actualHost}:${address.port}`;
      resolve({
        server,
        url,
        port: address.port,
        host: actualHost,
        close: () => closeServer(server),
      });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export async function ensureRedditApiServer(
  port = resolvePort(process.env.AURIX_API_PORT || process.env.PORT, 3001)
): Promise<RedditApiHandle> {
  if (autoServer) return autoServer;
  const host = process.env.AURIX_API_HOST || '127.0.0.1';
  const preferredUrl = `http://127.0.0.1:${port}`;
  const existing = port > 0 ? await probeExisting(preferredUrl) : undefined;
  if (existing) {
    autoServer = existing;
    process.env.AURIX_REDDIT_RELAY_URL = existing.url;
    process.env.AURIX_REDDIT_LOCAL_API = '1';
    console.error(`[aurix api] Reddit API already running on ${existing.url}`);
    return existing;
  }
  try {
    autoServer = await listen(createRedditApiServer(), port, host);
  } catch (error: any) {
    if (error?.code !== 'EADDRINUSE' || port === 0) throw error;
    autoServer = await listen(createRedditApiServer(), 0, '127.0.0.1');
    console.warn(
      `[aurix api] port ${port} busy; Reddit API auto-started on ${autoServer.url}`
    );
  }
  process.env.AURIX_REDDIT_RELAY_URL = autoServer.url;
  process.env.AURIX_REDDIT_LOCAL_API = '1';
  console.error(`[aurix api] Reddit API auto-started on ${autoServer.url}`);
  return autoServer;
}

export async function startRedditApiServer(
  port = resolvePort(process.env.AURIX_API_PORT || process.env.PORT, 3001)
) {
  const handle = await listen(createRedditApiServer(), port, process.env.AURIX_API_HOST || '0.0.0.0');
  console.log(`[aurix api] listening on ${handle.url}`);
  console.log('[aurix api] endpoints: /api/health, /api/reddit/search, /api/reddit/comments');
  return handle.server;
}
