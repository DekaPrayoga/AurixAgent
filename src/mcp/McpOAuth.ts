import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import net from 'net';
import { createHash, randomBytes } from 'crypto';
import { spawn } from 'child_process';

export interface McpOAuthConfig {
  clientId?: string;
  clientSecretEnv?: string;
  scope?: string;
  callbackPort?: number;
  redirectUri?: string;
}

interface OAuthMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

interface OAuthRecord {
  serverUrl: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: number;
  clientId?: string;
  clientSecret?: string;
  clientSecretExpiresAt?: number;
  metadata?: OAuthMetadata;
}

interface PendingLogin {
  state: string;
  verifier: string;
  redirectUri: string;
  metadata: OAuthMetadata;
  clientId: string;
  clientSecret?: string;
  serverUrl: string;
  scope?: string;
  resolve: (code: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  server?: http.Server;
}

const pending = new Map<string, PendingLogin>();
const refreshes = new Map<string, Promise<string | undefined>>();

function home(): string { return process.env.HOME || os.homedir(); }
function safeName(name: string): string { return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120); }
function tokenDir(): string { return path.join(home(), '.aurix', 'mcp-tokens'); }
function tokenPath(name: string): string { return path.join(tokenDir(), `${safeName(name)}.json`); }

function readRecord(name: string, serverUrl?: string): OAuthRecord | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(tokenPath(name), 'utf8')) as OAuthRecord;
    if (serverUrl && value.serverUrl !== serverUrl) return undefined;
    return value;
  } catch { return undefined; }
}

function writeRecord(name: string, value: OAuthRecord): void {
  fs.mkdirSync(tokenDir(), { recursive: true, mode: 0o700 });
  fs.chmodSync(tokenDir(), 0o700);
  const target = tokenPath(name);
  const temp = `${target}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, target);
  fs.chmodSync(target, 0o600);
}

export function removeOAuth(name: string): void { fs.rmSync(tokenPath(name), { force: true }); }
export function hasOAuthTokens(name: string, serverUrl: string): boolean { return Boolean(readRecord(name, serverUrl)?.accessToken); }

function assertSafeUrl(value: string): URL {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error(`OAuth endpoint must use HTTPS: ${url.origin}`);
  return url;
}

async function json(url: string, init?: RequestInit): Promise<any> {
  assertSafeUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`OAuth metadata HTTP ${response.status} at ${new URL(url).origin}`);
    const text = await response.text();
    if (text.length > 1024 * 1024) throw new Error('OAuth metadata response too large');
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

function authenticateParams(header?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const match of header.matchAll(/([a-zA-Z_]+)="([^"]*)"/g)) result[match[1]] = match[2];
  return result;
}

function resourceMetadataCandidates(serverUrl: string, header?: string): string[] {
  const explicit = authenticateParams(header).resource_metadata;
  if (explicit) return [explicit];
  const url = new URL(serverUrl);
  return [
    `${url.origin}/.well-known/oauth-protected-resource${url.pathname === '/' ? '' : url.pathname}`,
    `${url.origin}/.well-known/oauth-protected-resource`,
  ];
}

async function discover(name: string, serverUrl: string, authenticate?: string): Promise<{ metadata: OAuthMetadata; scope?: string }> {
  let header = authenticate;
  if (!header) {
    const response = await fetch(serverUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'aurix-ai', version: '3.1.1' } } }) });
    header = response.headers.get('www-authenticate') || undefined;
    await response.body?.cancel();
  }
  const challenge = authenticateParams(header);
  let protectedMetadata: any;
  for (const candidate of resourceMetadataCandidates(serverUrl, header)) {
    try { protectedMetadata = await json(candidate); break; } catch {}
  }
  if (!protectedMetadata) throw new Error(`OAuth protected-resource metadata not found for ${name}`);
  if (protectedMetadata.resource && new URL(protectedMetadata.resource).origin !== new URL(serverUrl).origin) throw new Error('OAuth resource metadata origin mismatch');
  const issuer = protectedMetadata.authorization_servers?.[0];
  if (!issuer) throw new Error('OAuth metadata did not provide an authorization server');
  const issuerUrl = assertSafeUrl(issuer);
  const candidates = [
    `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname === '/' ? '' : issuerUrl.pathname}`,
    `${issuerUrl.origin}/.well-known/oauth-authorization-server`,
    `${issuerUrl.origin}/.well-known/openid-configuration`,
  ];
  let metadata: OAuthMetadata | undefined;
  for (const candidate of candidates) {
    try { metadata = await json(candidate); break; } catch {}
  }
  if (!metadata?.authorization_endpoint || !metadata.token_endpoint) throw new Error('OAuth authorization server metadata is incomplete');
  assertSafeUrl(metadata.authorization_endpoint);
  assertSafeUrl(metadata.token_endpoint);
  if (metadata.code_challenge_methods_supported && !metadata.code_challenge_methods_supported.includes('S256')) throw new Error('OAuth server does not support PKCE S256');
  return { metadata, scope: challenge.scope || protectedMetadata.scopes_supported?.join(' ') };
}

function freePort(requested = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(requested, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : requested;
      server.close(() => resolve(port));
    });
  });
}

function openBrowser(url: string): void {
  const command: [string, string[]] = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd.exe', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try { spawn(command[0], command[1], { detached: true, stdio: 'ignore' }).unref(); } catch {}
}

async function client(name: string, serverUrl: string, redirectUri: string, metadata: OAuthMetadata, config: McpOAuthConfig): Promise<{ id: string; secret?: string }> {
  const stored = readRecord(name, serverUrl);
  if (config.clientId) return { id: config.clientId, secret: config.clientSecretEnv ? process.env[config.clientSecretEnv] : undefined };
  if (stored?.clientId && (!stored.clientSecretExpiresAt || stored.clientSecretExpiresAt > Date.now() / 1000)) return { id: stored.clientId, secret: stored.clientSecret };
  if (!metadata.registration_endpoint) throw new Error(`OAuth server requires a pre-registered client. Set oauth.clientId${config.clientSecretEnv ? '' : ' and optional oauth.clientSecretEnv'} in ~/.aurix/mcp.json`);
  const result = await json(metadata.registration_endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: 'Aurix Agent', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
  });
  if (!result.client_id) throw new Error('OAuth dynamic client registration returned no client_id');
  writeRecord(name, { ...stored, serverUrl, metadata, clientId: result.client_id, clientSecret: result.client_secret, clientSecretExpiresAt: result.client_secret_expires_at });
  return { id: result.client_id, secret: result.client_secret };
}

async function tokenRequest(metadata: OAuthMetadata, fields: Record<string, string>, secret?: string): Promise<any> {
  const body = new URLSearchParams(fields);
  if (secret) body.set('client_secret', secret);
  const response = await fetch(metadata.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
  const value = await response.json().catch(() => ({})) as any;
  if (!response.ok || value.error) throw new Error(`OAuth token exchange failed: ${value.error_description || value.error || response.status}`);
  return value;
}

async function saveTokens(name: string, serverUrl: string, metadata: OAuthMetadata, clientId: string, clientSecret: string | undefined, value: any): Promise<string> {
  if (!value.access_token) throw new Error('OAuth token response did not include access_token');
  const current = readRecord(name, serverUrl);
  writeRecord(name, {
    ...current, serverUrl, metadata, clientId, clientSecret: clientSecret || current?.clientSecret,
    accessToken: value.access_token, refreshToken: value.refresh_token || current?.refreshToken,
    tokenType: value.token_type || 'Bearer', scope: value.scope || current?.scope,
    expiresAt: value.expires_in ? Date.now() + Number(value.expires_in) * 1000 : undefined,
  });
  return value.access_token;
}

async function startCallback(name: string, state: string, redirectUri: string): Promise<void> {
  const redirect = new URL(redirectUri);
  const item = pending.get(name);
  if (!item) throw new Error(`No pending OAuth login for ${name}`);
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', redirect.origin);
    if (url.pathname !== redirect.pathname) { response.writeHead(404); response.end('Not found'); return; }
    if (url.searchParams.get('state') !== state) { response.writeHead(400); response.end('Invalid OAuth state'); return; }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    response.writeHead(error || !code ? 400 : 200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(error || !code ? '<h2>Authorization failed</h2>' : '<h2>Authorization successful</h2><p>Return to Aurix.</p>');
    if (error || !code) item.reject(new Error(error || 'No authorization code'));
    else item.resolve(code);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(redirect.port), '127.0.0.1', resolve);
  });
  item.server = server;
}

export async function beginOAuthLogin(name: string, serverUrl: string, config: McpOAuthConfig = {}, authenticate?: string, onUrl?: (url: string) => void): Promise<string> {
  const { metadata, scope: discoveredScope } = await discover(name, serverUrl, authenticate);
  const port = config.redirectUri ? Number(new URL(config.redirectUri).port) : await freePort(config.callbackPort || 0);
  const redirectUri = config.redirectUri || `http://127.0.0.1:${port}/mcp/oauth/callback`;
  const registered = await client(name, serverUrl, redirectUri, metadata, config);
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(32).toString('hex');
  const scope = config.scope || discoveredScope || metadata.scopes_supported?.join(' ') || 'mcp';
  const codePromise = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(name); reject(new Error('OAuth callback timed out')); }, 5 * 60_000);
    pending.set(name, { state, verifier, redirectUri, metadata, clientId: registered.id, clientSecret: registered.secret, serverUrl, scope, resolve, reject, timer });
  });
  await startCallback(name, state, redirectUri);
  const authorization = new URL(metadata.authorization_endpoint);
  authorization.searchParams.set('response_type', 'code');
  authorization.searchParams.set('client_id', registered.id);
  authorization.searchParams.set('redirect_uri', redirectUri);
  authorization.searchParams.set('state', state);
  authorization.searchParams.set('code_challenge', challenge);
  authorization.searchParams.set('code_challenge_method', 'S256');
  authorization.searchParams.set('scope', scope);
  authorization.searchParams.set('resource', serverUrl);
  onUrl?.(authorization.toString());
  openBrowser(authorization.toString());
  try {
    const code = await codePromise;
    const value = await tokenRequest(metadata, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: registered.id, code_verifier: verifier }, registered.secret);
    return await saveTokens(name, serverUrl, metadata, registered.id, registered.secret, value);
  } finally {
    const item = pending.get(name);
    if (item) { clearTimeout(item.timer); item.server?.close(); pending.delete(name); }
  }
}

export async function completeOAuthCallback(name: string, redirectUrl: string): Promise<void> {
  const item = pending.get(name);
  if (!item) throw new Error(`No pending OAuth login for ${name}`);
  const url = new URL(redirectUrl);
  if (url.searchParams.get('state') !== item.state) throw new Error('Invalid OAuth state');
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  if (error || !code) throw new Error(error || 'Redirect URL has no authorization code');
  item.resolve(code);
}

export async function accessToken(name: string, serverUrl: string, config: McpOAuthConfig = {}): Promise<string | undefined> {
  const record = readRecord(name, serverUrl);
  if (!record?.accessToken) return undefined;
  if (!record.expiresAt || record.expiresAt > Date.now() + 60_000) return record.accessToken;
  return refreshToken(name, serverUrl, config);
}

export async function refreshToken(name: string, serverUrl: string, config: McpOAuthConfig = {}): Promise<string | undefined> {
  if (refreshes.has(name)) return refreshes.get(name)!;
  const operation = (async () => {
    const record = readRecord(name, serverUrl);
    if (!record?.refreshToken || !record.metadata || !record.clientId) return undefined;
    try {
      const value = await tokenRequest(record.metadata, { grant_type: 'refresh_token', refresh_token: record.refreshToken, client_id: record.clientId }, config.clientSecretEnv ? process.env[config.clientSecretEnv] : record.clientSecret);
      return saveTokens(name, serverUrl, record.metadata, record.clientId, record.clientSecret, value);
    } catch { return undefined; }
  })().finally(() => refreshes.delete(name));
  refreshes.set(name, operation);
  return operation;
}
