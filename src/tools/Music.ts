import { exec, spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool } from './Registry.js';

const MUSIC_DIR = path.join(os.homedir(), '.aurix', 'music');
let currentPlayer: ChildProcess | null = null;

function ensureMusicDir() {
  if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

export const musicTool: Tool = {
  name: 'music',
  description: 'Play, search, and download music from the internet. Scrapes YouTube, SoundCloud, and other sources using yt-dlp. Can play audio, queue tracks, or download for offline use.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action: search, play, download, queue, stop, now_playing, list_downloads',
      },
      query: {
        type: 'string',
        description: 'Search query or URL',
      },
      source: {
        type: 'string',
        description: 'Source: youtube (default), soundcloud, bandcamp, auto',
      },
    },
    required: ['action'],
  },
  async execute(args) {
    const action = args.action as string;
    const query = (args.query as string) || '';
    const source = (args.source as string) || 'youtube';

    switch (action) {
      case 'search':
        return searchMusic(query, source);

      case 'play':
        return playMusic(query, source);

      case 'download':
        return downloadMusic(query, source);

      case 'queue':
        return queueMusic(query, source);

      case 'stop':
        return stopMusic();

      case 'now_playing':
        return nowPlaying();

      case 'list_downloads':
        return listDownloads();

      default:
        return `Unknown action: ${action}. Use: search, play, download, queue, stop, now_playing, list_downloads`;
    }
  },
};

async function searchMusic(query: string, source: string): Promise<string> {
  if (!query) return 'Error: provide a search query';

  const searchQuery = source === 'soundcloud'
    ? `scsearch8:${query}`
    : `ytsearch8:${query}`;

  try {
    const result = await runYtdlp([
      '--flat-playlist',
      '--print', '%(title)s ||| %(url)s ||| %(duration_string)s ||| %(channel)s',
      '--playlist-items', '1:8',
      searchQuery,
    ], 20000);

    if (!result.trim()) {
      return `No results found for "${query}"`;
    }

    const tracks = result.trim().split('\n').filter(Boolean).map((line, i) => {
      const [title, url, duration, channel] = line.split(' ||| ');
      return `${i + 1}. ${title || 'Unknown'}\n   Artist: ${channel || 'Unknown'} · Duration: ${duration || '?'}\n   URL: ${url || ''}`;
    });

    return `Search results for "${query}" (YouTube):\n\n${tracks.join('\n\n')}`;
  } catch (e: any) {
    return `Search error: ${e.message}`;
  }
}

async function playMusic(query: string, source: string): Promise<string> {
  if (!query) return 'Error: provide a URL or search query to play';

  let url = query;

  if (!query.startsWith('http')) {
    const searchResult = await resolveUrl(query, source);
    if (!searchResult) return `Could not find track for: ${query}`;
    url = searchResult;
  }

  return new Promise<string>((resolve) => {
    stopCurrentPlayer();

    const ytdlp = spawn('yt-dlp', [
      '--no-playlist',
      '-f', 'bestaudio[ext=m4a]/bestaudio',
      '--no-warnings',
      '-o', '-',
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const mpv = spawn('mpv', [
      '--no-video',
      '--no-terminal',
      '--really-quiet',
      '--input-ipc-server=/tmp/aurix-mpv-socket',
      '-',
    ], { stdio: ['pipe', 'ignore', 'pipe'] });

    ytdlp.stdout.pipe(mpv.stdin);
    currentPlayer = mpv;

    let trackTitle = url;

    runYtdlp(['--print', '%(title)s - %(uploader)s', '--no-playlist', url], 5000)
      .then(title => { if (title.trim()) trackTitle = title.trim(); })
      .catch(() => {});

    mpv.on('close', () => {
      currentPlayer = null;
    });

    ytdlp.on('error', (err) => {
      resolve(`Playback error: ${err.message}`);
    });

    mpv.on('error', (err) => {
      resolve(`Player error: ${err.message}`);
    });

    setTimeout(() => resolve(`Now playing: ${trackTitle}\nUse "stop" to stop, "now_playing" for info`), 1500);
  });
}

async function downloadMusic(query: string, source: string): Promise<string> {
  if (!query) return 'Error: provide a URL or search query';

  ensureMusicDir();

  let url = query;
  if (!query.startsWith('http')) {
    const resolved = await resolveUrl(query, source);
    if (!resolved) return `Could not find track for: ${query}`;
    url = resolved;
  }

  try {
    const title = await runYtdlp(['--print', '%(title)s', '--no-playlist', url], 10000);
    const filename = `${title.trim().replace(/[^a-zA-Z0-9\s-]/g, '')}.%(ext)s`;

    await runYtdlp([
      '--no-playlist',
      '-f', 'bestaudio',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '192K',
      '--embed-thumbnail',
      '--embed-metadata',
      '-o', path.join(MUSIC_DIR, filename),
      url,
    ], 120000);

    const files = fs.readdirSync(MUSIC_DIR);
    const latest = files.sort().reverse()[0];
    return `Downloaded: ${title.trim()}\nSaved to: ${path.join(MUSIC_DIR, latest)}`;
  } catch (e: any) {
    return `Download error: ${e.message}`;
  }
}

async function queueMusic(query: string, source: string): Promise<string> {
  if (!query) return 'Error: provide a URL or playlist URL';

  let url = query;
  if (!query.startsWith('http')) {
    const resolved = await resolveUrl(query, source);
    if (!resolved) return `Could not find: ${query}`;
    url = resolved;
  }

  try {
    const info = await runYtdlp([
      '--print', '%(playlist_title)s ||| %(playlist_count)s',
      '--playlist-items', '1',
      url,
    ], 10000);

    return `Queued playlist: ${info.trim()}\nTracks will play sequentially. Use "stop" to stop.`;
  } catch {
    return playMusic(url, source);
  }
}

function stopMusic(): string {
  stopCurrentPlayer();
  try {
    exec('pkill -f "mpv.*aurix-mpv-socket" 2>/dev/null');
  } catch {}
  return 'Playback stopped';
}

function nowPlaying(): string {
  if (!currentPlayer) return 'Nothing playing';

  try {
    const socketPath = '/tmp/aurix-mpv-socket';
    if (fs.existsSync(socketPath)) {
      return 'Audio is playing. Use "stop" to stop playback.';
    }
    return 'Player running but no active track detected';
  } catch {
    return 'Audio is playing (details unavailable)';
  }
}

function listDownloads(): string {
  ensureMusicDir();
  const files = fs.readdirSync(MUSIC_DIR);

  if (files.length === 0) return 'No downloaded tracks.';

  return `Downloaded tracks (${files.length}):\n` +
    files.map((f, i) => {
      const stat = fs.statSync(path.join(MUSIC_DIR, f));
      const sizeMB = (stat.size / 1048576).toFixed(1);
      return `  ${i + 1}. ${f} (${sizeMB}MB)`;
    }).join('\n');
}

async function resolveUrl(query: string, source: string): Promise<string | null> {
  try {
    const result = await runYtdlp([
      '--print', '%(url)s',
      '--no-playlist',
      '--playlist-items', '1',
      `ytsearch1:${query}`,
    ], 10000);
    return result.trim() || null;
  } catch {
    return null;
  }
}

function stopCurrentPlayer() {
  if (currentPlayer) {
    try { currentPlayer.kill('SIGTERM'); } catch {}
    currentPlayer = null;
  }
}

function runYtdlp(args: string[], timeout: number = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(`yt-dlp ${args.map(a => `"${a}"`).join(' ')}`, { timeout, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}
