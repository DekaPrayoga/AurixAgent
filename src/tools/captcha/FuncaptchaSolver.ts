/**
 * FunCaptcha (Arkose Labs) solver — API-level approach.
 *
 * Ported and integrated from:
 *   - noahcoolboy/funcaptcha  (BDA fingerprint generation, session/challenge API, crypto, api-breakers)
 *   - useragents/Funcaptcha-Audio-Solver  (audio challenge flow + speech-to-text)
 *
 * This module does NOT require a browser. It speaks directly to the Arkose
 * Labs API: generate BDA → get token → get challenge → solve (audio or
 * vision). The solved token is then injected back into the page.
 *
 * When audio mode is unavailable or denied, falls back to vision-based
 * solving through the existing visionClassify pipeline.
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { writeFileSync, unlinkSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig } from '../../agent/Config.js';
import { request as undiciRequest, ProxyAgent } from 'undici';

// ─── MurmurHash3 x64-128 ───────────────────────────────────────────────────
// Verbatim port from noahcoolboy/funcaptcha/src/murmur.ts
const x64Add = (t: number[], r: number[]): number[] => {
  const _t = [t[0] >>> 16, 65535 & t[0], t[1] >>> 16, 65535 & t[1]];
  const _r = [r[0] >>> 16, 65535 & r[0], r[1] >>> 16, 65535 & r[1]];
  const e = [0, 0, 0, 0];
  e[3] += _t[3] + _r[3]; e[2] += e[3] >>> 16; e[3] &= 65535;
  e[2] += _t[2] + _r[2]; e[1] += e[2] >>> 16; e[2] &= 65535;
  e[1] += _t[1] + _r[1]; e[0] += e[1] >>> 16; e[1] &= 65535;
  e[0] += _t[0] + _r[0]; e[0] &= 65535;
  return [(e[0] << 16) | e[1], (e[2] << 16) | e[3]];
};
const x64Multiply = (t: number[], r: number[]): number[] => {
  const _t = [t[0] >>> 16, 65535 & t[0], t[1] >>> 16, 65535 & t[1]];
  const _r = [r[0] >>> 16, 65535 & r[0], r[1] >>> 16, 65535 & r[1]];
  const e = [0, 0, 0, 0];
  e[3] += _t[3] * _r[3]; e[2] += e[3] >>> 16; e[3] &= 65535;
  e[2] += _t[2] * _r[3]; e[1] += e[2] >>> 16; e[2] &= 65535;
  e[2] += _t[3] * _r[2]; e[1] += e[2] >>> 16; e[2] &= 65535;
  e[1] += _t[1] * _r[3]; e[0] += e[1] >>> 16; e[1] &= 65535;
  e[1] += _t[2] * _r[2]; e[0] += e[1] >>> 16; e[1] &= 65535;
  e[1] += _t[3] * _r[1]; e[0] += e[1] >>> 16; e[1] &= 65535;
  e[0] += _t[0] * _r[3] + _t[1] * _r[2] + _t[2] * _r[1] + _t[3] * _r[0];
  e[0] &= 65535;
  return [(e[0] << 16) | e[1], (e[2] << 16) | e[3]];
};
const x64Rotl = (t: number[], r: number): number[] => {
  const m = r % 64;
  if (m === 32) return [t[1], t[0]];
  if (m < 32) return [(t[0] << m) | (t[1] >>> (32 - m)), (t[1] << m) | (t[0] >>> (32 - m))];
  const s = m - 32;
  return [(t[1] << s) | (t[0] >>> (32 - s)), (t[0] << s) | (t[1] >>> (32 - s))];
};
const x64LeftShift = (t: number[], r: number): number[] => {
  const m = r % 64;
  if (m === 0) return t;
  if (m < 32) return [(t[0] << m) | (t[1] >>> (32 - m)), t[1] << m];
  return [t[1] << (m - 32), 0];
};
const x64Xor = (t: number[], r: number[]): number[] => [t[0] ^ r[0], t[1] ^ r[1]];
const x64Fmix = (t: number[]): number[] => {
  let h = x64Xor(t, [0, t[0] >>> 1]);
  h = x64Multiply(h, [4283543511, 3981806797]);
  h = x64Xor(h, [0, h[0] >>> 1]);
  h = x64Multiply(h, [3301882366, 444984403]);
  h = x64Xor(h, [0, h[0] >>> 1]);
  return h;
};

function x64hash128(key: string, seed: number = 0): string {
  const t = key || '';
  const e = t.length % 16;
  const o = t.length - e;
  let x = [0, seed], c = [0, seed];
  let h: number[], a: number[];
  const d = [2277735313, 289559509], ii = [1291169091, 658871167];
  for (let l = 0; l < o; l += 16) {
    h = [(255 & t.charCodeAt(l+4))|((255&t.charCodeAt(l+5))<<8)|((255&t.charCodeAt(l+6))<<16)|((255&t.charCodeAt(l+7))<<24),
         (255 & t.charCodeAt(l))|((255&t.charCodeAt(l+1))<<8)|((255&t.charCodeAt(l+2))<<16)|((255&t.charCodeAt(l+3))<<24)];
    a = [(255 & t.charCodeAt(l+12))|((255&t.charCodeAt(l+13))<<8)|((255&t.charCodeAt(l+14))<<16)|((255&t.charCodeAt(l+15))<<24),
         (255 & t.charCodeAt(l+8))|((255&t.charCodeAt(l+9))<<8)|((255&t.charCodeAt(l+10))<<16)|((255&t.charCodeAt(l+11))<<24)];
    h = x64Multiply(h, d); h = x64Rotl(h, 31); h = x64Multiply(h, ii);
    x = x64Xor(x, h); x = x64Rotl(x, 27); x = x64Add(x, c);
    x = x64Add(x64Multiply(x, [0, 5]), [0, 1390208809]);
    a = x64Multiply(a, ii); a = x64Rotl(a, 33); a = x64Multiply(a, d);
    c = x64Xor(c, a); c = x64Rotl(c, 31); c = x64Add(c, x);
    c = x64Add(x64Multiply(c, [0, 5]), [0, 944331445]);
  }
  h = [0, 0]; a = [0, 0];
  /* eslint-disable no-fallthrough */
  switch (e) {
    case 15: a = x64Xor(a, x64LeftShift([0, t.charCodeAt(o + 14)], 48));
    case 14: a = x64Xor(a, x64LeftShift([0, t.charCodeAt(o + 13)], 40));
    case 13: a = x64Xor(a, x64LeftShift([0, t.charCodeAt(o + 12)], 32));
    case 12: a = x64Xor(a, x64LeftShift([0, t.charCodeAt(o + 11)], 24));
    case 11: a = x64Xor(a, x64LeftShift([0, t.charCodeAt(o + 10)], 16));
    case 10: a = x64Xor(a, x64LeftShift([0, t.charCodeAt(o + 9)], 8));
    case 9:
      a = x64Xor(a, [0, t.charCodeAt(o + 8)]);
      a = x64Multiply(a, ii); a = x64Rotl(a, 33); a = x64Multiply(a, d);
      c = x64Xor(c, a);
    case 8: h = x64Xor(h, x64LeftShift([0, t.charCodeAt(o + 7)], 56));
    case 7: h = x64Xor(h, x64LeftShift([0, t.charCodeAt(o + 6)], 48));
    case 6: h = x64Xor(h, x64LeftShift([0, t.charCodeAt(o + 5)], 40));
    case 5: h = x64Xor(h, x64LeftShift([0, t.charCodeAt(o + 4)], 32));
    case 4: h = x64Xor(h, x64LeftShift([0, t.charCodeAt(o + 3)], 24));
    case 3: h = x64Xor(h, x64LeftShift([0, t.charCodeAt(o + 2)], 16));
    case 2: h = x64Xor(h, x64LeftShift([0, t.charCodeAt(o + 1)], 8));
    case 1:
      h = x64Xor(h, [0, t.charCodeAt(o)]);
      h = x64Multiply(h, d); h = x64Rotl(h, 31); h = x64Multiply(h, ii);
      x = x64Xor(x, h);
  }
  /* eslint-enable no-fallthrough */
  x = x64Xor(x, [0, t.length]); c = x64Xor(c, [0, t.length]);
  x = x64Add(x, c); c = x64Add(c, x);
  x = x64Fmix(x); c = x64Fmix(c);
  x = x64Add(x, c); c = x64Add(c, x);
  return ('00000000' + (x[0] >>> 0).toString(16)).slice(-8) +
         ('00000000' + (x[1] >>> 0).toString(16)).slice(-8) +
         ('00000000' + (c[0] >>> 0).toString(16)).slice(-8) +
         ('00000000' + (c[1] >>> 0).toString(16)).slice(-8);
}

// ─── AES-256-CBC encrypt/decrypt (Arkose protocol) ─────────────────────────
function arkoseEncrypt(data: string, key: string): string {
  const salt = String.fromCharCode(...Array(8).fill(0).map(() => Math.floor(Math.random() * 26) + 97));
  let salted = '';
  let dx = Buffer.alloc(0);
  for (let x = 0; x < 3; x++) {
    dx = createHash('md5').update(Buffer.concat([Buffer.from(dx), Buffer.from(key), Buffer.from(salt)])).digest();
    salted += dx.toString('hex');
  }
  const aes = createCipheriv('aes-256-cbc', Buffer.from(salted.substring(0, 64), 'hex'), Buffer.from(salted.substring(64, 96), 'hex'));
  return JSON.stringify({
    ct: aes.update(data, undefined, 'base64') + aes.final('base64'),
    iv: salted.substring(64, 96),
    s: Buffer.from(salt).toString('hex'),
  });
}

function arkoseDecrypt(rawData: string, key: string): string {
  const data = JSON.parse(rawData);
  const dk = Buffer.concat([Buffer.from(key), Buffer.from(data.s, 'hex')]);
  const arr = [Buffer.from(createHash('md5').update(dk).digest()).toString('hex')];
  let result = arr[0];
  for (let x = 1; x < 3; x++) {
    arr.push(Buffer.from(createHash('md5').update(Buffer.concat([Buffer.from(arr[x - 1], 'hex'), dk])).digest()).toString('hex'));
    result += arr[x];
  }
  const aes = createDecipheriv('aes-256-cbc', Buffer.from(result.substring(0, 64), 'hex'), Buffer.from(data.iv, 'hex'));
  return aes.update(data.ct, 'base64', 'utf8') + aes.final('utf8');
}

// ─── Fingerprint generation ────────────────────────────────────────────────
const SCREEN_RESOLUTIONS = [
  [1920, 1080], [1920, 1200], [2048, 1080], [2560, 1440],
  [1366, 768], [1440, 900], [1536, 864], [1680, 1050],
  [1280, 1024], [1280, 800], [1280, 720], [1600, 1200], [1600, 900],
];

const LANGUAGES = [
  'en-US', 'en-GB', 'en-CA', 'en-AU', 'en-NZ', 'en',
  'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'it-IT', 'nl-NL',
  'ja-JP', 'ko-KR', 'zh-CN', 'zh-TW', 'ru-RU', 'pl-PL',
];

const BASE_FONTS = [
  'Andale Mono', 'Arial', 'Arial Black', 'Arial Hebrew', 'Arial MT',
  'Arial Narrow', 'Arial Rounded MT Bold', 'Arial Unicode MS',
  'Bitstream Vera Sans Mono', 'Book Antiqua', 'Bookman Old Style',
  'Calibri', 'Cambria', 'Cambria Math', 'Century', 'Century Gothic',
  'Century Schoolbook', 'Comic Sans', 'Comic Sans MS', 'Consolas',
  'Courier', 'Courier New', 'Garamond', 'Geneva', 'Georgia',
  'Helvetica', 'Helvetica Neue', 'Impact', 'Lucida Bright',
  'Lucida Calligraphy', 'Lucida Console', 'Lucida Fax', 'LUCIDA GRANDE',
  'Lucida Handwriting', 'Lucida Sans', 'Lucida Sans Typewriter',
  'Lucida Sans Unicode', 'Microsoft Sans Serif', 'Monaco',
  'Monotype Corsiva', 'MS Gothic', 'MS Outlook', 'MS PGothic',
  'MS Reference Sans Serif', 'MS Sans Serif', 'MS Serif', 'MYRIAD',
  'MYRIAD PRO', 'Palatino', 'Palatino Linotype', 'Segoe Print',
  'Segoe Script', 'Segoe UI', 'Segoe UI Light', 'Segoe UI Semibold',
  'Segoe UI Symbol', 'Tahoma', 'Times', 'Times New Roman',
  'Times New Roman PS', 'Trebuchet MS', 'Verdana', 'Wingdings',
  'Wingdings 2', 'Wingdings 3',
];

const BASE_PLUGINS = [
  'Chrome PDF Plugin::Portable Document Format::application/x-google-chrome-pdf~pdf',
  'Chrome PDF Viewer::::application/pdf~pdf',
  'Native Client::::application/x-nacl~,application/x-pnacl~',
];

function cfpHash(s: string): number {
  if (!s) return 0;
  return s.split('').reduce((hash, ch) => {
    hash = (hash << 5) - hash + ch.charCodeAt(0);
    return hash & hash;
  }, 0);
}

interface Fingerprint {
  DNT: string; L: string; D: number; PR: number;
  S: number[]; AS: number[]; TO: number;
  SS: boolean; LS: boolean; IDB: boolean; B: boolean; ODB: boolean;
  CPUC: string; PK: string; CFP: string;
  FR: boolean; FOS: boolean; FB: boolean;
  JSF: string[]; P: string[];
  T: (number | boolean)[]; H: number; SWF: boolean;
}

function getFingerprint(): Fingerprint {
  const screen = SCREEN_RESOLUTIONS[Math.floor(Math.random() * SCREEN_RESOLUTIONS.length)];
  return {
    DNT: 'unknown',
    L: LANGUAGES[Math.floor(Math.random() * LANGUAGES.length)],
    D: [8, 24][Math.floor(Math.random() * 2)],
    PR: Math.round(Math.random() * 100) / 100 * 2 + 0.5,
    S: screen,
    AS: screen,
    TO: (Math.floor(Math.random() * 24) - 12) * 60,
    SS: Math.random() > 0.5,
    LS: Math.random() > 0.5,
    IDB: Math.random() > 0.5,
    B: Math.random() > 0.5,
    ODB: Math.random() > 0.5,
    CPUC: 'unknown',
    PK: 'Win32',
    CFP: 'canvas winding:yes~canvas fp:data:image/png;base64,' + randomBytes(128).toString('base64'),
    FR: false,
    FOS: false,
    FB: false,
    JSF: BASE_FONTS.filter(() => Math.random() > 0.5),
    P: BASE_PLUGINS.filter(() => Math.random() > 0.5),
    T: [Math.floor(Math.random() * 8), Math.random() > 0.5, Math.random() > 0.5],
    H: 2 ** Math.floor(Math.random() * 6),
    SWF: false,
  };
}

function prepareF(fp: Fingerprint): string {
  const vals: string[] = [];
  for (const k of Object.keys(fp)) {
    const v = (fp as any)[k];
    vals.push(Array.isArray(v) ? v.join(';') : String(v));
  }
  return vals.join('~~~');
}

function prepareFe(fp: Fingerprint): string[] {
  const fe: string[] = [];
  for (const k of Object.keys(fp)) {
    const v = (fp as any)[k];
    if (k === 'CFP') fe.push(`${k}:${cfpHash(v)}`);
    else if (k === 'P') fe.push(`${k}:${(v as string[]).map((p: string) => p.split('::')[0])}`);
    else fe.push(`${k}:${v}`);
  }
  return fe;
}

function getEnhancedFingerprint(fp: Fingerprint, ua: string, opts: any): Array<{key: string; value: any}> {
  const base: Record<string, any> = {
    webgl_extensions: 'ANGLE_instanced_arrays;EXT_blend_minmax;EXT_color_buffer_half_float;EXT_disjoint_timer_query;EXT_float_blend;EXT_frag_depth;EXT_shader_texture_lod;EXT_texture_compression_bptc;EXT_texture_compression_rgtc;EXT_texture_filter_anisotropic;EXT_sRGB;KHR_parallel_shader_compile;OES_element_index_uint;OES_fbo_render_mipmap;OES_standard_derivatives;OES_texture_float;OES_texture_float_linear;OES_texture_half_float;OES_texture_half_float_linear;OES_vertex_array_object;WEBGL_color_buffer_float;WEBGL_compressed_texture_s3tc;WEBGL_compressed_texture_s3tc_srgb;WEBGL_debug_renderer_info;WEBGL_debug_shaders;WEBGL_depth_texture;WEBGL_draw_buffers;WEBGL_lose_context;WEBGL_multi_draw',
    webgl_extensions_hash: '',
    webgl_renderer: 'WebKit WebGL',
    webgl_vendor: 'WebKit',
    webgl_version: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
    webgl_shading_language_version: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
    webgl_aliased_line_width_range: '[1, 1]',
    webgl_aliased_point_size_range: '[1, 1023]',
    webgl_antialiasing: 'yes',
    webgl_bits: '8,8,24,8,8,0',
    webgl_max_params: '16,64,16384,4096,8192,32,8192,31,16,32,4096',
    webgl_max_viewport_dims: '[8192, 8192]',
    webgl_unmasked_vendor: 'Google Inc. (Google)',
    webgl_unmasked_renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    webgl_vsf_params: '23,127,127,23,127,127,23,127,127',
    webgl_vsi_params: '0,31,30,0,31,30,0,31,30',
    webgl_fsf_params: '23,127,127,23,127,127,23,127,127',
    webgl_fsi_params: '0,31,30,0,31,30,0,31,30',
    webgl_hash_webgl: null as string | null,
    user_agent_data_brands: 'Chromium,Google Chrome,Not=A?Brand',
    user_agent_data_mobile: null,
    navigator_connection_downlink: null,
    navigator_connection_downlink_max: null,
    network_info_rtt: null,
    network_info_save_data: false,
    network_info_rtt_type: null,
    screen_pixel_depth: 24,
    navigator_device_memory: 0.5,
    navigator_languages: 'en-US,fr-BE,fr,en-BE,en',
    window_inner_width: 0,
    window_inner_height: 0,
    window_outer_width: 2195,
    window_outer_height: 1195,
    browser_detection_firefox: false,
    browser_detection_brave: false,
    audio_codecs: '{"ogg":"probably","mp3":"probably","wav":"probably","m4a":"maybe","aac":"probably"}',
    video_codecs: '{"ogg":"probably","h264":"probably","webm":"probably","mpeg4v":"","mpeg4a":"","theora":""}',
    media_query_dark_mode: true,
    headless_browser_phantom: false,
    headless_browser_selenium: false,
    headless_browser_nightmare_js: false,
    document__referrer: '',
    window__ancestor_origins: [] as string[],
    window__tree_index: [0],
    window__tree_structure: '[[]]',
    window__location_href: '',
    client_config__sitedata_location_href: '',
    client_config__surl: '',
    client_config__language: null,
    navigator_battery_charging: true,
    audio_fingerprint: '124.04347527516074',
  };

  // Randomise WebGL extensions
  base.webgl_extensions = base.webgl_extensions.split(';').filter(() => Math.random() > 0.5).join(';');
  base.webgl_extensions_hash = x64hash128(base.webgl_extensions, 0);
  base.screen_pixel_depth = fp.D;
  base.navigator_languages = fp.L;
  base.window_outer_height = fp.S[0];
  base.window_outer_width = fp.S[1];
  base.window_inner_height = fp.S[0];
  base.window_inner_width = fp.S[1];
  base.browser_detection_firefox = !!ua.match(/Firefox\/\d+/);
  base.browser_detection_brave = !!ua.match(/Brave\/\d+/);
  base.media_query_dark_mode = Math.random() > 0.9;
  base.webgl_hash_webgl = x64hash128(
    Object.entries(base).filter(([k]) => k.startsWith('webgl_') && k !== 'webgl_hash_webgl').map(([, v]) => v).join(','), 0
  );

  base.client_config__language = opts.language || null;
  const surl = opts.surl || 'https://client-api.arkoselabs.com';
  base.window__location_href = `${surl}/v2/1.5.5/enforcement.fbfc14b0d793c6ef8359e0e4b4a91f67.html#${opts.pkey}`;
  if (opts.site) {
    base.document__referrer = opts.site;
    base.window__ancestor_origins = [opts.site];
    base.client_config__sitedata_location_href = opts.site;
  }
  base.client_config__surl = surl;
  base.audio_fingerprint = (124.04347527516074 + Math.random() * 0.001 - 0.0005).toString();

  return Object.entries(base).map(([key, value]) => ({ key, value }));
}

// ─── BDA Generation ────────────────────────────────────────────────────────
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function randomHex32(): string {
  return Array(32).fill(0).map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
}

function generateBda(userAgent: string, opts: any): string {
  const fp = getFingerprint();
  const fe = prepareFe(fp);

  const bda = [
    { key: 'api_type', value: 'js' },
    { key: 'p', value: 1 },
    { key: 'f', value: x64hash128(prepareF(fp), 31) },
    { key: 'n', value: Buffer.from(Math.round(Date.now() / 1000).toString()).toString('base64') },
    { key: 'wh', value: `${randomHex32()}|${randomHex32()}` },
    { key: 'enhanced_fp', value: getEnhancedFingerprint(fp, userAgent, opts) },
    { key: 'fe', value: fe },
    { key: 'ife_hash', value: x64hash128(fe.join(', '), 38) },
    { key: 'cs', value: 1 },
    { key: 'jsbd', value: JSON.stringify({ HL: 4, DT: '', NWD: 'false', DOTO: 1, DMTO: 1 }) },
  ];

  const time = Date.now() / 1000;
  const key = userAgent + Math.round(time - (time % 21600));
  const encrypted = arkoseEncrypt(JSON.stringify(bda), key);
  return Buffer.from(encrypted).toString('base64');
}

// ─── API breakers ──────────────────────────────────────────────────────────
interface TileLoc { x: number; y: number; px: number; py: number }

function tileToLoc(tile: number): TileLoc {
  const xClick = (tile % 3) * 100 + (tile % 3) * 3 + 3 + 10 + Math.floor(Math.random() * 80);
  const yClick = Math.floor(tile / 3) * 100 + Math.floor(tile / 3) * 3 + 3 + 10 + Math.floor(Math.random() * 80);
  return { x: xClick, y: yClick, px: xClick / 300, py: yClick / 200 };
}

const apiBreakers: Record<string, any> = {
  v1: {
    3: {
      default: (c: any) => c,
      method_1: (c: any) => ({ x: c.y, y: c.x }),
      method_2: (c: any) => ({ x: c.x, y: (c.y + c.x) * c.x }),
      method_3: (c: any) => ({ a: c.x, b: c.y }),
      method_4: (c: any) => [c.x, c.y],
      method_5: (c: any) => [c.y, c.x].map(v => Math.sqrt(v)),
    },
    4: { default: (c: any) => c },
  },
  v2: {
    3: {
      value: {
        alpha: (c: any) => ({ x: c.x, y: (c.y + c.x) * c.x, px: c.px, py: c.py }),
        beta: (c: any) => ({ x: c.y, y: c.x, py: c.px, px: c.py }),
        gamma: (c: any) => ({ x: c.y + 1, y: -c.x, px: c.px, py: c.py }),
        delta: (c: any) => ({ x: c.y + 0.25, y: c.x + 0.5, px: c.px, py: c.py }),
        epsilon: (c: any) => ({ x: c.x * 0.5, y: c.y * 5, px: c.px, py: c.py }),
        zeta: (c: any) => ({ x: c.x + 1, y: c.y + 2, px: c.px, py: c.py }),
        method_1: (c: any) => ({ x: c.x, y: c.y, px: c.px, py: c.py }),
        method_2: (c: any) => ({ x: c.y, y: (c.y + c.x) * c.x, px: c.px, py: c.py }),
        method_3: (c: any) => ({ x: Math.sqrt(c.x), y: Math.sqrt(c.y), px: c.px, py: c.py }),
      },
      key: {
        alpha: (c: any) => [c.y, c.px, c.py, c.x],
        beta: (c: any) => JSON.stringify({ x: c.x, y: c.y, px: c.px, py: c.py }),
        gamma: (c: any) => [c.x, c.y, c.px, c.py].join(' '),
        delta: (c: any) => [1, c.x, 2, c.y, 3, c.px, 4, c.py],
        epsilon: (c: any) => ({ answer: { x: c.x, y: c.y, px: c.px, py: c.py } }),
        zeta: (c: any) => [c.x, [c.y, [c.px, [c.py]]]],
        method_1: (c: any) => ({ a: c.x, b: c.y, px: c.px, py: c.py }),
        method_2: (c: any) => [c.x, c.y],
        method_3: (c: any) => [c.y, c.x],
      },
    },
    4: {
      value: {
        alpha: (c: any) => ({ index: (String(c.index) as any) + 1 - 2 }),
        beta: (c: any) => ({ index: -c.index }),
        gamma: (c: any) => ({ index: 3 * (3 - c.index) }),
        delta: (c: any) => ({ index: 7 * c.index }),
        epsilon: (c: any) => ({ index: 2 * c.index }),
        zeta: (c: any) => ({ index: c.index ? 100 / c.index : c.index }),
        va: (c: any) => ({ index: c.index + 3 }),
        vb: (c: any) => ({ index: -c.index }),
        vc: (c: any) => ({ index: 10 - c.index }),
        vd: (c: any) => ({ index: 3 * c.index }),
      },
      key: {
        alpha: (c: any) => [Math.round(100 * Math.random()), c.index, Math.round(100 * Math.random())],
        beta: (c: any) => ({ size: 50 - c.index, id: c.index, limit: 10 * c.index, req_timestamp: Date.now() }),
        gamma: (c: any) => c.index,
        delta: (c: any) => ({ index: c.index }),
        epsilon: (c: any) => {
          const arr: any[] = [];
          const len = Math.round(5 * Math.random()) + 1;
          const rand = Math.round(Math.random() * len);
          for (let i = 0; i < len; i++) arr.push(i === rand ? c.index : Math.round(10 * Math.random()));
          arr.push(rand);
          return arr;
        },
        zeta: (c: any) => Array(Math.round(5 * Math.random()) + 1).concat(c.index),
        ka: (c: any) => c.index,
        kb: (c: any) => [c.index],
        kc: (c: any) => ({ guess: c.index }),
      },
    },
  },
};

function solveBreaker(v2: boolean, breaker: any, gameType: number, value: any): any {
  if (!v2 && typeof breaker === 'string') {
    return (apiBreakers.v1[gameType]?.[breaker || 'default'] || ((v: any) => v))(value);
  }
  if (typeof breaker !== 'string' && breaker) {
    const b = apiBreakers.v2[gameType];
    let v = (breaker.value || []).reduce((acc: any, cur: string) => {
      if (b?.value?.[cur]) return b.value[cur](acc);
      return cur;
    }, value);
    return b?.key?.[breaker.key]?.(v) ?? v;
  }
  return value;
}

// ─── Timestamp helper ──────────────────────────────────────────────────────
function getTimestamp(): { cookie: string; value: string } {
  const time = Date.now().toString();
  const value = `${time.substring(0, 7)}00${time.substring(7, 13)}`;
  return { cookie: `timestamp=${value};path=/;secure;samesite=none`, value };
}

// ─── HTTP helper ───────────────────────────────────────────────────────────
function constructFormData(data: Record<string, any>): string {
  return Object.keys(data)
    .filter(v => data[v] !== undefined)
    .map(k => `${k}=${encodeURIComponent(data[k])}`)
    .join('&');
}

// Minimal HTTP requester using undici (supports proxy)
async function arkoseRequest(
  baseUrl: string,
  path: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: string,
  proxy?: string,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const url = path ? `${baseUrl}${path}` : baseUrl;

  let dispatcher = undefined;
  if (proxy) {
    let auth = undefined;
    const proxyUrl = new URL(proxy);
    if (proxyUrl.username && proxyUrl.password) {
      auth = Buffer.from(`${proxyUrl.username}:${proxyUrl.password}`).toString('base64');
    }
    dispatcher = new ProxyAgent({
      uri: proxyUrl.origin,
      token: auth ? `Basic ${auth}` : undefined
    });
  }

  const resp = await undiciRequest(url, {
    method,
    headers,
    body,
    dispatcher,
  });

  const text = await resp.body.text();
  const respHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(resp.headers)) {
    if (Array.isArray(v)) respHeaders[k] = v.join(', ');
    else if (v) respHeaders[k] = String(v);
  }
  return { status: resp.statusCode, body: text, headers: respHeaders };
}

// ─── Token info parser ─────────────────────────────────────────────────────
interface TokenInfo {
  token: string; r: string; pk: string; dc: string; at: string;
  cdn_url: string; surl: string; kbio: boolean; mbio: boolean; tbio: boolean;
  sup?: string;
  [key: string]: any;
}

function parseTokenInfo(token: string): TokenInfo {
  return Object.fromEntries(
    token.split('|').map(v => v.split('=').map(s => decodeURIComponent(s)))
  ) as any;
}

// ─── Main solver class ─────────────────────────────────────────────────────
export interface FuncaptchaOptions {
  publicKey: string;
  serviceUrl?: string;
  site?: string;
  dataBlob?: string;
  proxy?: string;
  userAgent?: string;
  visionFn?: (imageBase64: string, prompt: string) => Promise<string>;
}

export interface FuncaptchaSolveResult {
  success: boolean;
  token?: string;
  error?: string;
  solveTime?: number;
  method?: 'audio' | 'vision' | 'suppressed';
}

const _dbg = (msg: string) => console.log(`[funcaptcha-solver] ${msg}`);

export class FuncaptchaSolver {
  private publicKey: string;
  private serviceUrl: string;
  private site?: string;
  private dataBlob?: string;
  private proxy?: string;
  private userAgent: string;
  private visionFn?: (imageBase64: string, prompt: string) => Promise<string>;

  constructor(opts: FuncaptchaOptions) {
    this.publicKey = opts.publicKey;
    this.serviceUrl = opts.serviceUrl || 'https://client-api.arkoselabs.com';
    this.site = opts.site;
    this.dataBlob = opts.dataBlob;
    this.proxy = opts.proxy;
    this.userAgent = opts.userAgent || DEFAULT_USER_AGENT;
    this.visionFn = opts.visionFn;
  }

  async getToken(): Promise<{ token: string; tokenInfo: TokenInfo; mbio: boolean }> {
    const bda = generateBda(this.userAgent, {
      pkey: this.publicKey,
      surl: this.serviceUrl,
      site: this.site,
      language: 'en',
    });

    const headers: Record<string, string> = {
      'Accept': '*/*',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': this.userAgent,
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Site': 'same-origin',
      'sec-fetch-mode': 'cors',
    };

    if (this.site) {
      headers['Origin'] = this.serviceUrl;
      headers['Referer'] = `${this.serviceUrl}/v2/${this.publicKey}/1.5.5/enforcement.fbfc14b0d793c6ef8359e0e4b4a91f67.html`;
    }

    const formData: Record<string, any> = {
      bda,
      public_key: this.publicKey,
      site: this.site ? new URL(this.site).origin : undefined,
      userbrowser: this.userAgent,
      capi_version: '1.5.5',
      capi_mode: 'inline',
      style_theme: 'default',
      rnd: Math.random().toString(),
      language: 'en',
    };

    if (this.dataBlob) formData['data[blob]'] = this.dataBlob;

    const resp = await arkoseRequest(
      this.serviceUrl,
      `/fc/gt2/public_key/${this.publicKey}`,
      'POST',
      headers,
      constructFormData(formData),
      this.proxy
    );

    const data = JSON.parse(resp.body);
    if (data.error === 'DENIED ACCESS') {
      throw new Error('Arkose DENIED ACCESS — your IP is blocked (datacenter/VPN IPs are rejected). Use a residential proxy or solve through the browser instead.');
    }
    if (!data.token) throw new Error(`Failed to get Arkose token: ${resp.body.substring(0, 200)}`);

    const tokenInfo = parseTokenInfo(data.token);
    return { token: data.token, tokenInfo, mbio: data.mbio ?? false };
  }

  async getChallenge(tokenStr: string, tokenInfo: TokenInfo): Promise<any> {
    const embedUrl = `${tokenInfo.surl}/fc/gc/?${constructFormData(tokenInfo)}`;
    const resp = await arkoseRequest(
      tokenInfo.surl,
      '/fc/gfct/',
      'POST',
      {
        'User-Agent': this.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Site': 'same-origin',
        'Referer': embedUrl,
      },
      constructFormData({
        sid: tokenInfo.r,
        render_type: 'canvas',
        token: tokenInfo.token,
        analytics_tier: tokenInfo.at,
        'data%5Bstatus%5D': 'init',
        lang: 'en',
        apiBreakerVersion: 'green',
      }),
      this.proxy
    );

    const data = JSON.parse(resp.body);
    data.token = tokenStr;
    data.tokenInfo = tokenInfo;
    return data;
  }

  async solveChallenge(challengeData: any, mbio: boolean): Promise<FuncaptchaSolveResult> {
    const startTime = Date.now();
    const tokenInfo = challengeData.tokenInfo;
    const gameType = challengeData.game_data?.gameType;
    const waves = challengeData.game_data?.waves || 1;
    const sessionToken = challengeData.session_token;
    const challengeID = challengeData.challengeID;
    const isV2 = !!challengeData.game_data?.customGUI?.is_using_api_breaker_v2;
    const breaker = challengeData.game_data?.customGUI?.api_breaker;

    _dbg(`Challenge: gameType=${gameType}, waves=${waves}, variant=${challengeData.game_data?.game_variant || 'unknown'}`);

    const audioResult = await this.tryAudioSolve(sessionToken, challengeID, tokenInfo, challengeData.token);
    if (audioResult.success) {
      return { success: true, token: audioResult.captchaToken, solveTime: Date.now() - startTime, method: 'audio' };
    }

    _dbg(`Audio solve not available: ${audioResult.error}. Falling back to vision.`);

    if (!this.visionFn) return { success: false, error: 'No vision function provided and audio solve unavailable' };

    const answerHistory: any[] = [];
    for (let wave = 0; wave < waves; wave++) {
      _dbg(`Wave ${wave + 1}/${waves}`);
      const imgUrl = challengeData.game_data?.customGUI?._challenge_imgs?.[wave];
      if (!imgUrl) return { success: false, error: `No image URL for wave ${wave}` };

      let imgBuffer: Buffer;
      try {
        const imgResp = await fetch(imgUrl, { headers: { 'User-Agent': this.userAgent, 'Referer': tokenInfo.surl } });
        imgBuffer = Buffer.from(await imgResp.arrayBuffer());
      } catch (e: any) {
        return { success: false, error: `Failed to fetch challenge image: ${e.message}` };
      }

      try {
        JSON.parse(imgBuffer.toString());
        const keyResp = await arkoseRequest(
          tokenInfo.surl, '/fc/ekey/', 'POST',
          { 'User-Agent': this.userAgent, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': tokenInfo.surl },
          constructFormData({ session_token: sessionToken, game_token: challengeID }),
          this.proxy
        );
        const decKey = JSON.parse(keyResp.body).decryption_key;
        imgBuffer = Buffer.from(arkoseDecrypt(imgBuffer.toString(), decKey), 'base64');
      } catch {}

      const imgPath = join(homedir(), `.aurix-funcaptcha-wave-${wave}.png`);
      writeFileSync(imgPath, imgBuffer);
      const imgBase64 = imgBuffer.toString('base64');

      const variant = challengeData.game_data?.game_variant || challengeData.game_data?.instruction_string || '';
      const instruction = challengeData.string_table?.[`${gameType}.instructions-${variant}`] || '';

      let visionPrompt: string;
      if (gameType === 1) {
        const increment = (() => {
          const clr = challengeData.game_data?.customGUI?._guiFontColr;
          let inc = parseInt(clr ? clr.replace('#', '').substring(3) : '28', 16);
          inc = inc > 113 ? inc / 10 : inc;
          return inc;
        })();
        visionPrompt = `This is a FunCaptcha rotation puzzle. ${instruction ? `Instruction: "${instruction}". ` : ''}The image needs to be rotated to its correct orientation. Each click rotates by ${increment}° clockwise. How many clicks are needed? Reply with ONLY a number 0-6.`;
      } else if (gameType === 3) {
        visionPrompt = `This is a FunCaptcha tile-pick puzzle with a 2x3 grid (6 tiles). ${instruction ? `Instruction: "${instruction}". ` : ''}Pick the correct tile. Reply with ONLY a number 0-5 (0=top-left, 1=top-center, 2=top-right, 3=bottom-left, 4=bottom-center, 5=bottom-right).`;
      } else if (gameType === 4) {
        const difficulty = challengeData.game_data?.game_difficulty || 6;
        visionPrompt = `This is a FunCaptcha image-matching puzzle. ${instruction ? `Instruction: "${instruction}". ` : ''}Pick the image from the selection that matches the prompt. Reply with ONLY a number 0-${difficulty - 1}.`;
      } else {
        visionPrompt = `This is a FunCaptcha challenge (type ${gameType}). ${instruction ? `Instruction: "${instruction}". ` : ''}What is the answer? Reply with ONLY a number.`;
      }

      let answer: number;
      try {
        const visionResp = await this.visionFn(imgBase64, visionPrompt);
        _dbg(`Vision response: "${visionResp}"`);
        const numMatch = visionResp.match(/\d+/);
        answer = numMatch ? parseInt(numMatch[0]) : 0;
      } catch (e: any) {
        return { success: false, error: `Vision model failed: ${e.message}` };
      }

      try { unlinkSync(imgPath); } catch {}

      let answerPayload: any;
      if (gameType === 1) {
        const increment = (() => {
          const clr = challengeData.game_data?.customGUI?._guiFontColr;
          let inc = parseInt(clr ? clr.replace('#', '').substring(3) : '28', 16);
          inc = inc > 113 ? inc / 10 : inc;
          return inc;
        })();
        const rounded = (Math.round(answer * increment * 10) / 10).toFixed(2);
        answerHistory.push(rounded);
        answerPayload = answerHistory.toString();
      } else if (gameType === 3) {
        const pos = tileToLoc(answer);
        answerHistory.push(solveBreaker(isV2, breaker, 3, pos));
        answerPayload = JSON.stringify(answerHistory);
      } else if (gameType === 4) {
        answerHistory.push(solveBreaker(isV2, breaker, 4, { index: answer }));
        answerPayload = JSON.stringify(answerHistory);
      } else {
        answerHistory.push(answer);
        answerPayload = JSON.stringify(answerHistory);
      }

      const encrypted = arkoseEncrypt(answerPayload, sessionToken);
      const requestedId = arkoseEncrypt(JSON.stringify({}), `REQUESTED${sessionToken}ID`);
      const { cookie: tCookie, value: tValue } = getTimestamp();

      const embedUrl = `${tokenInfo.surl}/fc/gc/?${constructFormData(tokenInfo)}`;
      const ansResp = await arkoseRequest(
        tokenInfo.surl, '/fc/ca/', 'POST',
        {
          'User-Agent': this.userAgent,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Newrelic-Timestamp': tValue,
          'X-Requested-ID': requestedId,
          'Cookie': tCookie,
          'Referer': embedUrl,
        },
        constructFormData({
          session_token: sessionToken,
          game_token: challengeID,
          guess: encrypted,
          analytics_tier: tokenInfo.at,
          sid: tokenInfo.r,
          bio: mbio ? 'eyJtYmlvIjoiMTI1MCwwLDE0NywyMDQ7IiwidGJpbyI6IiIsImtiaW8iOiIifQ==' : '',
        }),
        this.proxy
      );

      const ansData = JSON.parse(ansResp.body);
      _dbg(`Answer response: solved=${ansData.solved}, response=${ansData.response}`);

      if (ansData.solved) {
        return { success: true, token: challengeData.token, solveTime: Date.now() - startTime, method: 'vision' };
      }
      if (ansData.response === 'answered' && wave < waves - 1) continue;
      if (ansData.response === 'answered' && wave === waves - 1 && !ansData.solved) {
        return { success: false, error: 'All waves answered but not marked as solved' };
      }
    }
    return { success: false, error: 'Challenge not solved after all waves' };
  }

  private async tryAudioSolve(
    sessionToken: string, challengeID: string, tokenInfo: TokenInfo, captchaToken: string
  ): Promise<{ success: boolean; captchaToken?: string; error?: string }> {
    try {
      await arkoseRequest(
        tokenInfo.surl, '/fc/a/', 'POST',
        { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': this.userAgent },
        constructFormData({
          sid: tokenInfo.r, session_token: sessionToken, render_type: 'canvas',
          label: 'swapped to audio captcha', game_type: '3', game_token: challengeID,
          category: 'audio captcha', analytics_tier: tokenInfo.at, action: 'user clicked audio',
        }),
        this.proxy
      );

      const audioResp = await arkoseRequest(
        tokenInfo.surl,
        `/fc/get_audio/?session_token=${encodeURIComponent(sessionToken)}&analytics_tier=${tokenInfo.at}&r=${tokenInfo.r}&game=0&language=en`,
        'POST',
        { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': this.userAgent },
        constructFormData({
          session_token: sessionToken, analytics_tier: tokenInfo.at,
          r: tokenInfo.r, game: '0', language: 'en',
        }),
        this.proxy
      );

      if (audioResp.body.includes('DENIED ACCESS')) return { success: false, error: 'Audio access denied by Arkose' };
      if (audioResp.status !== 200 || audioResp.body.length < 1000) return { success: false, error: `Audio download failed` };

      const audioPath = join(homedir(), '.aurix-funcaptcha-audio.wav');
      writeFileSync(audioPath, audioResp.body);

      const config = loadConfig();
      const groqApiKey = config.groqApiKey || '';
      if (!groqApiKey) {
        try { unlinkSync(audioPath); } catch {}
        return { success: false, error: 'No Groq API key configured for audio transcription' };
      }

      _dbg('Transcribing audio with Groq Whisper...');
      const audioBuffer = readFileSync(audioPath);
      const formData = new FormData();
      formData.append('file', new Blob([audioBuffer]), 'audio.wav');
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('temperature', '0');
      formData.append('response_format', 'verbose_json');
      formData.append('language', 'en');

      const whisperResp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST', headers: { 'Authorization': `bearer ${groqApiKey}` }, body: formData,
      });

      try { unlinkSync(audioPath); } catch {}

      if (!whisperResp.ok) return { success: false, error: `Whisper API error: ${whisperResp.status}` };

      const whisperData = await whisperResp.json() as any;
      let transcription = (whisperData.text || '').trim();
      transcription = audioToDigits(transcription);

      if (transcription.length !== 7 || !/^\d+$/.test(transcription)) {
        return { success: false, error: `Invalid transcription result: "${transcription}"` };
      }

      const submitResp = await arkoseRequest(
        tokenInfo.surl, '/fc/audio/', 'POST',
        { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': this.userAgent },
        constructFormData({
          session_token: sessionToken, analytics_tier: tokenInfo.at, response: transcription,
          language: 'en', r: tokenInfo.r, audio_type: '2', bio: '',
        }),
        this.proxy
      );

      const submitData = JSON.parse(submitResp.body);
      if (submitData.response === 'correct') {
        _dbg('Audio solve: CORRECT!');
        return { success: true, captchaToken };
      }
      return { success: false, error: `Audio answer incorrect: ${submitData.error_reply || 'unknown'}` };
    } catch (e: any) {
      return { success: false, error: `Audio solve error: ${e.message}` };
    }
  }

  async solve(): Promise<FuncaptchaSolveResult> {
    try {
      _dbg(`Getting Arkose token for pkey=${this.publicKey}...`);
      const { token, tokenInfo, mbio } = await this.getToken();

      if (tokenInfo.sup === '1') {
        _dbg('Captcha suppressed! Token is immediately valid.');
        return { success: true, token, method: 'suppressed', solveTime: 0 };
      }

      _dbg('Loading challenge...');
      const challengeData = await this.getChallenge(token, tokenInfo);
      return await this.solveChallenge(challengeData, mbio);
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
}

function audioToDigits(text: string): string {
  let s = text.toLowerCase();
  const replacements: [string, string][] = [
    ['rightfully', '53'], ['rightly', '53'], ['wireless', '8'], ['knights', '9'], ['knight', '9'],
    ['nights', '9'], ['lights', '9'], ['sites', '9'], ['sides', '9'], ['night', '9'], ['light', '9'],
    ['store', '44'], ['three', '3'], ['seven', '7'], ['eight', '8'], ['italy', '34'], ['pwell', '9'],
    ['zero', '0'], ['hero', '4'], ['five', '5'], ['four', '4'], ['nine', '9'], ['tree', '3'],
    ['guys', '9'], ['wine', '1'], ['door', '04'], ['dial', '69'], ['well', '9'], ['size', '9'],
    ['find', '5'], ['rise', '1'], ['soon', '2'], ['whine', '1'], ['white', '1'],
    ['one', '1'], ['two', '2'], ['six', '6'], ['ice', '0'], ['buy', '55'], ['lee', '53'],
    ['now', '9'], ['for', '4'], ['side', '9'], ['site', '9'], ['to', '2'], ['do', '5'],
    ['or', '4'], ['by', '1'], ['-', ''], [' ', ''], ['r', '9'], ['l', '2'], ['a', '4'],
  ];
  for (const [from, to] of replacements) {
    while (s.includes(from)) s = s.replace(from, to);
  }
  return s;
}

export function extractPublicKey(frameUrl: string): string | null {
  const urlMatch = frameUrl.match(/public_key\/([A-F0-9-]{36})/i) || frameUrl.match(/#([A-F0-9-]{36})/i);
  return urlMatch ? urlMatch[1] : null;
}

export function extractServiceUrl(frameUrl: string): string {
  try { return `${new URL(frameUrl).protocol}//${new URL(frameUrl).host}`; }
  catch { return 'https://client-api.arkoselabs.com'; }
}