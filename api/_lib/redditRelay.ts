type RelayDepth = 'quick' | 'default' | 'deep';
type RelaySort = 'relevance' | 'top' | 'new' | 'hot' | 'comments';
type RelayTime = 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';

type SearchParams = {
  q: string;
  from?: string;
  to?: string;
  depth: RelayDepth;
  limit: number;
  subreddits: string[];
  sort: RelaySort;
  time: RelayTime;
};

type NormalizedComment = {
  score: number;
  date?: string;
  author: string;
  excerpt: string;
  url: string;
};

type NormalizedPost = {
  id: string;
  reddit_id: string;
  title: string;
  url: string;
  subreddit: string;
  date?: string;
  engagement: {
    score: number;
    num_comments: number;
    upvote_ratio?: number;
  };
  relevance: number;
  why_relevant: string;
  selftext: string;
  top_comments?: NormalizedComment[];
  comment_insights?: string[];
};

type RelayJson = Record<string, unknown>;

const OAUTH_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const OAUTH_API_BASE = 'https://oauth.reddit.com';
const PUBLIC_REDDIT_BASE = 'https://www.reddit.com';
const DEFAULT_CACHE_TTL_SECONDS = 900;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 30;
const DEFAULT_MAX_LIMIT = 50;
const TOKEN_EXPIRY_SKEW_MS = 60_000;

type CacheEntry<T> = { value: T; expiresAt: number };
const responseCache = new Map<string, CacheEntry<RelayJson>>();
const rateBuckets = new Map<string, number[]>();
let oauthToken: { value: string; expiresAt: number } | undefined;

export function relayHealth() {
  return {
    ok: true,
    service: 'aurix-reddit-relay',
    hasRedditOAuth: Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET),
    requiresRelayToken: Boolean(process.env.AURIX_REDDIT_RELAY_TOKEN),
    cacheTtlSeconds: cacheTtlSeconds(),
  };
}

export function setCors(res: any) {
  res.setHeader?.('Access-Control-Allow-Origin', '*');
  res.setHeader?.('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader?.('Access-Control-Allow-Headers', 'Authorization,Content-Type');
}

export function handleOptions(req: any, res: any): boolean {
  if (String(req.method || 'GET').toUpperCase() !== 'OPTIONS') return false;
  setCors(res);
  res.status(204).end();
  return true;
}

export async function handleSearch(req: any, res: any) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    return sendJson(res, 405, errorPayload('method_not_allowed', 'Use GET for this endpoint.'));
  }

  const auth = authorize(req);
  if ('message' in auth) return sendJson(res, 401, errorPayload('unauthorized', auth.message));

  const rate = checkRateLimit(req);
  if ('retryAfterSeconds' in rate) {
    res.setHeader?.('Retry-After', String(rate.retryAfterSeconds));
    return sendJson(
      res,
      429,
      errorPayload('rate_limited', 'Relay rate limit exceeded.', rate.retryAfterSeconds)
    );
  }

  let params: SearchParams;
  try {
    params = parseSearchParams(req);
  } catch (error: any) {
    return sendJson(res, 400, errorPayload('bad_request', error.message || 'Invalid request.'));
  }

  const key = cacheKey('search', params);
  const cached = getCached<RelayJson>(key);
  if (cached) return sendJson(res, 200, { ...cached, cache: 'hit' });

  try {
    const payload = await searchReddit(params);
    setCached(key, payload);
    res.setHeader?.('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return sendJson(res, 200, payload);
  } catch (error: any) {
    const retryAfter = Number(error?.retryAfterSeconds || 0) || undefined;
    if (retryAfter) res.setHeader?.('Retry-After', String(retryAfter));
    const status = error?.statusCode || (retryAfter ? 429 : 502);
    return sendJson(
      res,
      status,
      errorPayload(
        error?.code || 'upstream_failed',
        error?.message || 'Reddit upstream failed.',
        retryAfter
      )
    );
  }
}

export async function handleComments(req: any, res: any) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    return sendJson(res, 405, errorPayload('method_not_allowed', 'Use GET for this endpoint.'));
  }

  const auth = authorize(req);
  if ('message' in auth) return sendJson(res, 401, errorPayload('unauthorized', auth.message));

  const rate = checkRateLimit(req);
  if ('retryAfterSeconds' in rate) {
    res.setHeader?.('Retry-After', String(rate.retryAfterSeconds));
    return sendJson(
      res,
      429,
      errorPayload('rate_limited', 'Relay rate limit exceeded.', rate.retryAfterSeconds)
    );
  }

  try {
    const query = requestUrl(req).searchParams;
    const limit = clampNumber(query.get('limit'), 10, 1, 50);
    const target = parseCommentTarget(
      query.get('url') || '',
      query.get('subreddit') || '',
      query.get('postId') || ''
    );
    const key = cacheKey('comments', { ...target, limit });
    const cached = getCached<RelayJson>(key);
    if (cached) return sendJson(res, 200, { ...cached, cache: 'hit' });
    const comments = await fetchOAuthComments(target.subreddit, target.postId, limit);
    const payload = {
      ok: true,
      backend: 'reddit_oauth',
      cache: 'miss',
      comments,
      comment_insights: commentInsights(comments),
      warnings: [],
    };
    setCached(key, payload);
    return sendJson(res, 200, payload);
  } catch (error: any) {
    const status = error?.statusCode || 400;
    return sendJson(
      res,
      status,
      errorPayload(error?.code || 'bad_request', error?.message || 'Invalid request.')
    );
  }
}

function parseSearchParams(req: any): SearchParams {
  const query = requestUrl(req).searchParams;
  const q = String(query.get('q') || '').trim();
  if (!q) throw new Error('q is required.');
  if (q.length > 300) throw new Error('q must be 300 characters or fewer.');

  const depth = pick(query.get('depth'), ['quick', 'default', 'deep'], 'default');
  const sort = pick(query.get('sort'), ['relevance', 'top', 'new', 'hot', 'comments'], 'relevance');
  const defaultTime = depth === 'quick' ? 'week' : 'month';
  const time = pick(
    query.get('time'),
    ['hour', 'day', 'week', 'month', 'year', 'all'],
    defaultTime
  );
  const limit = clampNumber(query.get('limit'), Math.min(DEFAULT_MAX_LIMIT, 25), 1, maxLimit());
  const subreddits = parseSubreddits(query.get('subreddits') || '');
  const from = validDate(query.get('from'));
  const to = validDate(query.get('to'));

  return { q, from, to, depth, limit, subreddits, sort, time };
}

async function searchReddit(params: SearchParams): Promise<RelayJson> {
  const warnings: string[] = [];
  if (hasOAuthConfig()) {
    const items = await searchOAuth(params);
    return {
      ok: true,
      backend: 'reddit_oauth',
      cache: 'miss',
      items,
      warnings,
      rateLimit: {},
    };
  }

  if (publicFallbackEnabled()) {
    const items = await searchPublicRss(params);
    warnings.push('OAuth unavailable; used public RSS fallback with limited engagement metadata.');
    return {
      ok: true,
      backend: 'public_rss',
      cache: 'miss',
      items,
      warnings,
      rateLimit: {},
    };
  }

  const error: any = new Error('Reddit OAuth is not configured and public fallback is disabled.');
  error.statusCode = 503;
  error.code = 'oauth_unavailable';
  throw error;
}

async function searchOAuth(params: SearchParams): Promise<NormalizedPost[]> {
  const searches = params.subreddits.length
    ? params.subreddits.map((subreddit) => searchSubredditOAuth(subreddit, params))
    : [searchGlobalOAuth(params)];
  const batches = await Promise.all(searches);
  const posts = dedupePosts(batches.flat()).slice(0, params.limit);

  const enrichCount =
    params.depth === 'quick'
      ? Math.min(3, posts.length)
      : params.depth === 'deep'
        ? Math.min(8, posts.length)
        : Math.min(5, posts.length);
  await Promise.all(
    posts.slice(0, enrichCount).map(async (post) => {
      if (!post.subreddit || !post.reddit_id) return;
      try {
        const comments = await fetchOAuthComments(post.subreddit, post.reddit_id, 10);
        if (comments.length) {
          post.top_comments = comments;
          post.comment_insights = commentInsights(comments);
        }
      } catch {
        // Keep the post even when comment enrichment fails.
      }
    })
  );
  return posts.map((post, index) => ({ ...post, id: `R${index + 1}` }));
}

async function searchGlobalOAuth(params: SearchParams): Promise<NormalizedPost[]> {
  const data = await redditOAuthGet('/search', {
    q: params.q,
    sort: params.sort,
    t: params.time,
    limit: String(params.limit),
    type: 'link',
    raw_json: '1',
  });
  return parseListing(data, 'Reddit OAuth search', params.q, params.from, params.to);
}

async function searchSubredditOAuth(
  subreddit: string,
  params: SearchParams
): Promise<NormalizedPost[]> {
  const data = await redditOAuthGet(`/r/${encodeURIComponent(subreddit)}/search`, {
    q: params.q,
    restrict_sr: '1',
    sort: params.sort,
    t: params.time,
    limit: String(params.limit),
    type: 'link',
    raw_json: '1',
  });
  return parseListing(data, `Reddit OAuth r/${subreddit} search`, params.q, params.from, params.to);
}

async function fetchOAuthComments(
  subreddit: string,
  postId: string,
  limit: number
): Promise<NormalizedComment[]> {
  if (!hasOAuthConfig()) {
    const error: any = new Error('Reddit OAuth is not configured.');
    error.statusCode = 503;
    error.code = 'oauth_unavailable';
    throw error;
  }
  const data = await redditOAuthGet(
    `/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}`,
    {
      limit: String(limit),
      sort: 'top',
      raw_json: '1',
    }
  );
  const listing = Array.isArray(data) ? data[1] : undefined;
  const children = Array.isArray(listing?.data?.children) ? listing.data.children : [];
  return children
    .map((child: any) => child?.data)
    .filter(
      (row: any) =>
        row &&
        typeof row.body === 'string' &&
        row.body &&
        row.body !== '[deleted]' &&
        row.body !== '[removed]'
    )
    .map((row: any) => normalizeComment(row))
    .sort((a: NormalizedComment, b: NormalizedComment) => b.score - a.score)
    .slice(0, limit);
}

async function redditOAuthGet(path: string, params: Record<string, string>): Promise<any> {
  const token = await getOAuthToken();
  const url = new URL(`${OAUTH_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': redditUserAgent(),
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  const json = safeJson(text);
  if (!response.ok) throw upstreamError(response, json, text);
  return json;
}

async function getOAuthToken(): Promise<string> {
  if (oauthToken && oauthToken.expiresAt > Date.now() + TOKEN_EXPIRY_SKEW_MS)
    return oauthToken.value;
  const clientId = process.env.REDDIT_CLIENT_ID || '';
  const clientSecret = process.env.REDDIT_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    const error: any = new Error('REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are required.');
    error.statusCode = 503;
    error.code = 'oauth_unavailable';
    throw error;
  }

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': redditUserAgent(),
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
  });
  const text = await response.text();
  const json = safeJson(text);
  if (!response.ok) throw upstreamError(response, json, text);
  const accessToken = String(json?.access_token || '');
  if (!accessToken) {
    const error: any = new Error('Reddit OAuth response did not include an access token.');
    error.statusCode = 502;
    error.code = 'oauth_token_missing';
    throw error;
  }
  const expiresIn = Math.max(60, Number(json?.expires_in || 3600));
  oauthToken = { value: accessToken, expiresAt: Date.now() + expiresIn * 1000 };
  return accessToken;
}

function parseListing(
  data: any,
  whyRelevant: string,
  q: string,
  from?: string,
  to?: string
): NormalizedPost[] {
  const children = Array.isArray(data?.data?.children) ? data.data.children : [];
  return children
    .map((child: any) => child?.data)
    .filter(Boolean)
    .map((row: any, index: number) => normalizePost(row, index + 1, whyRelevant, q))
    .filter((post: NormalizedPost) => inDateRange(post.date, from, to));
}

function normalizePost(row: any, index: number, whyRelevant: string, q: string): NormalizedPost {
  const redditId = stripFullname(String(row?.id || row?.name || ''));
  const permalink = String(row?.permalink || '');
  const url = permalink ? `${PUBLIC_REDDIT_BASE}${permalink}` : String(row?.url || '');
  const title = decodeHtml(String(row?.title || '')).trim();
  const selftext = decodeHtml(String(row?.selftext || '')).slice(0, 500);
  const subreddit = String(row?.subreddit || '').trim();
  return {
    id: `R${index}`,
    reddit_id: redditId,
    title,
    url,
    subreddit,
    date: unixDate(row?.created_utc),
    engagement: {
      score: numberValue(row?.ups ?? row?.score),
      num_comments: numberValue(row?.num_comments),
      upvote_ratio: typeof row?.upvote_ratio === 'number' ? row.upvote_ratio : undefined,
    },
    relevance: simpleRelevance(q, `${title} ${selftext}`),
    why_relevant: whyRelevant,
    selftext,
  };
}

function normalizeComment(row: any): NormalizedComment {
  const permalink = String(row?.permalink || '');
  return {
    score: numberValue(row?.ups ?? row?.score),
    date: unixDate(row?.created_utc),
    author: String(row?.author || '[deleted]'),
    excerpt: decodeHtml(String(row?.body || '')).slice(0, 400),
    url: permalink ? `${PUBLIC_REDDIT_BASE}${permalink}` : '',
  };
}

async function searchPublicRss(params: SearchParams): Promise<NormalizedPost[]> {
  const url = new URL(`${PUBLIC_REDDIT_BASE}/search.rss`);
  url.searchParams.set('q', params.q);
  url.searchParams.set('sort', params.sort === 'comments' ? 'relevance' : params.sort);
  url.searchParams.set('t', params.time);
  const response = await fetch(url, {
    headers: {
      'User-Agent': redditUserAgent(),
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
  });
  const text = await response.text();
  if (!response.ok) throw upstreamError(response, {}, text);
  return parseRss(text, params.q, params.from, params.to).slice(0, params.limit);
}

function parseRss(xml: string, q: string, from?: string, to?: string): NormalizedPost[] {
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return entries
    .map((entry, index) => {
      const title = decodeHtml(stripTags(xmlField(entry, 'title'))).trim();
      const url = decodeHtml(xmlAttr(entry, 'link', 'href') || xmlField(entry, 'id')).trim();
      const published = xmlField(entry, 'updated') || xmlField(entry, 'published');
      const date = published ? published.slice(0, 10) : undefined;
      const subredditMatch = url.match(/reddit\.com\/r\/([^/]+)/i);
      const idMatch = url.match(/comments\/([^/]+)/i);
      const selftext = decodeHtml(stripTags(xmlField(entry, 'content'))).slice(0, 500);
      return {
        id: `R${index + 1}`,
        reddit_id: idMatch?.[1] || '',
        title,
        url,
        subreddit: subredditMatch?.[1] || '',
        date,
        engagement: { score: 0, num_comments: 0 },
        relevance: simpleRelevance(q, `${title} ${selftext}`),
        why_relevant: 'Reddit public RSS fallback',
        selftext,
      };
    })
    .filter((post) => post.title && post.url && inDateRange(post.date, from, to));
}

function commentInsights(comments: NormalizedComment[]): string[] {
  return comments
    .filter(
      (comment) =>
        comment.excerpt.length >= 30 &&
        !['[deleted]', '[removed]', 'AutoModerator'].includes(comment.author)
    )
    .slice(0, 10)
    .map((comment) => sentenceExcerpt(comment.excerpt, 150));
}

function parseCommentTarget(urlRaw: string, subredditRaw: string, postIdRaw: string) {
  let subreddit = subredditRaw.replace(/^r\//i, '').trim();
  let postId = postIdRaw.trim();
  if (urlRaw) {
    const url = new URL(urlRaw);
    if (!/(^|\.)reddit\.com$/i.test(url.hostname)) throw new Error('url must be a reddit.com URL.');
    const match = url.pathname.match(/\/r\/([^/]+)\/comments\/([^/]+)/i);
    if (!match) throw new Error('url must point to a Reddit comments thread.');
    subreddit = match[1];
    postId = match[2];
  }
  subreddit = cleanSubreddit(subreddit);
  if (!postId || !/^[A-Za-z0-9_]+$/.test(postId)) throw new Error('postId is invalid.');
  return { subreddit, postId: stripFullname(postId) };
}

function parseSubreddits(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(cleanSubreddit)
    .slice(0, 10);
}

function cleanSubreddit(value: string): string {
  const subreddit = value.replace(/^r\//i, '').trim();
  if (!/^[A-Za-z0-9_]{2,21}$/.test(subreddit)) throw new Error(`Invalid subreddit: ${value}`);
  return subreddit;
}

function authorize(req: any): { ok: true } | { ok: false; message: string } {
  const token = process.env.AURIX_REDDIT_RELAY_TOKEN || '';
  if (!token) return { ok: true };
  const header = String(req.headers?.authorization || req.headers?.Authorization || '');
  if (header === `Bearer ${token}`) return { ok: true };
  return { ok: false, message: 'Missing or invalid relay token.' };
}

function checkRateLimit(req: any): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const limit = rateLimitPerMinute();
  if (limit <= 0) return { ok: true };
  const key = String(req.headers?.authorization || clientIp(req) || 'anonymous');
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (rateBuckets.get(key) || []).filter((stamp) => stamp > windowStart);
  if (hits.length >= limit) {
    const oldest = hits[0] || now;
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000)) };
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  return { ok: true };
}

function clientIp(req: any): string {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0]
    .trim();
}

function cacheKey(prefix: string, value: unknown): string {
  return `${prefix}:${JSON.stringify(value)}`;
}

function getCached<T>(key: string): T | undefined {
  const entry = responseCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function setCached(key: string, value: RelayJson) {
  responseCache.set(key, { value, expiresAt: Date.now() + cacheTtlSeconds() * 1000 });
}

function sendJson(res: any, status: number, payload: unknown) {
  res.status(status).json(payload);
}

function errorPayload(code: string, message: string, retryAfterSeconds?: number) {
  return {
    ok: false,
    error: { code, message, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) },
    items: [],
  };
}

function requestUrl(req: any): URL {
  const host = req.headers?.host || 'localhost';
  return new URL(req.url || '/', `https://${host}`);
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function clampNumber(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function validDate(value: string | null): string | undefined {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function inDateRange(date: string | undefined, from?: string, to?: string): boolean {
  if (!date) return true;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function hasOAuthConfig(): boolean {
  return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

function publicFallbackEnabled(): boolean {
  return (
    String(process.env.REDDIT_RELAY_ENABLE_PUBLIC_FALLBACK || 'true').toLowerCase() !== 'false'
  );
}

function cacheTtlSeconds(): number {
  return Math.max(
    30,
    Number(process.env.REDDIT_RELAY_CACHE_TTL_SECONDS || DEFAULT_CACHE_TTL_SECONDS)
  );
}

function rateLimitPerMinute(): number {
  return Math.max(
    0,
    Number(process.env.REDDIT_RELAY_RATE_LIMIT_PER_MINUTE || DEFAULT_RATE_LIMIT_PER_MINUTE)
  );
}

function maxLimit(): number {
  return Math.max(1, Number(process.env.REDDIT_RELAY_MAX_LIMIT || DEFAULT_MAX_LIMIT));
}

function redditUserAgent(): string {
  return process.env.REDDIT_USER_AGENT || 'aurix-agent-reddit-relay/1.0';
}

function upstreamError(response: Response, json: any, text: string) {
  const retryAfter = Number(response.headers.get('retry-after') || 0) || undefined;
  const error: any = new Error(
    String(json?.message || json?.error || text || `Reddit upstream HTTP ${response.status}`).slice(
      0,
      300
    )
  );
  error.statusCode = response.status === 429 ? 429 : 502;
  error.code = response.status === 429 ? 'rate_limited' : 'upstream_failed';
  if (retryAfter) error.retryAfterSeconds = retryAfter;
  return error;
}

function safeJson(text: string): any {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function unixDate(value: unknown): string | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function numberValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function stripFullname(value: string): string {
  return value.startsWith('t3_') ? value.slice(3) : value;
}

function dedupePosts(posts: NormalizedPost[]): NormalizedPost[] {
  const seen = new Set<string>();
  const out: NormalizedPost[] = [];
  for (const post of posts) {
    const key = post.reddit_id || post.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(post);
  }
  return out;
}

function simpleRelevance(query: string, text: string): number {
  const terms = new Set(
    query
      .toLowerCase()
      .split(/\W+/)
      .filter((term) => term.length > 2)
  );
  if (!terms.size) return 0.7;
  const haystack = text.toLowerCase();
  let hits = 0;
  for (const term of terms) if (haystack.includes(term)) hits += 1;
  return Math.max(0.1, Math.min(1, Math.round((hits / terms.size) * 100) / 100));
}

function sentenceExcerpt(value: string, limit: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= limit) return trimmed;
  const cut = trimmed.slice(0, limit);
  const sentenceEnd = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
  return (
    (sentenceEnd > 50 ? cut.slice(0, sentenceEnd + 1) : cut).trimEnd() +
    (sentenceEnd > 50 ? '' : '...')
  );
}

function xmlField(xml: string, field: string): string {
  const match = xml.match(new RegExp(`<${field}[^>]*>([\\s\\S]*?)<\\/${field}>`, 'i'));
  return match?.[1] || '';
}

function xmlAttr(xml: string, tag: string, attr: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, 'i'));
  return match?.[1] || '';
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}
