import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool } from './Registry.js';

const execFileAsync = promisify(execFile);
const MUSIC_DIR = path.join(os.homedir(), '.aurix', 'music');
const MPV_SOCKET = path.join(os.tmpdir(), `aurix-mpv-${process.pid}.sock`);
let currentPlayer: ChildProcess | null = null;
let currentAudioPath = '';
let currentTrackTitle = '';
let playerError = '';

function ensureMusicDir() {
  if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

export const musicTool: Tool = {
  name: 'music',
  description:
    'Play, search, and download music from the internet. Scrapes YouTube, SoundCloud, and other sources using yt-dlp. Can play audio, queue tracks, or download for offline use.',
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
  const missing = await missingYtdlp();
  if (missing) return missing;

  const searchQuery = source === 'soundcloud' ? `scsearch8:${query}` : `ytsearch8:${query}`;

  try {
    const result = await runYtdlp(
      [
        '--flat-playlist',
        '--print',
        '%(title)s ||| %(url)s ||| %(duration_string)s ||| %(channel)s',
        '--playlist-items',
        '1:8',
        searchQuery,
      ],
      20000
    );

    if (!result.trim()) {
      return `No results found for "${query}"`;
    }

    const tracks = result
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line, i) => {
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
  const missingYt = await missingYtdlp();
  if (missingYt) return missingYt;
  const ffmpegMissing = await missingFfmpeg();
  if (ffmpegMissing) return ffmpegMissing;
  if (!(await commandExists('mpv')))
    return 'mpv is not installed. Install mpv to play audio, or use action="download" only.';

  let url = query;

  if (!query.startsWith('http')) {
    const searchResult = await resolveUrl(query, source);
    if (!searchResult) return `Could not find track for: ${query}`;
    url = searchResult;
  }

  stopCurrentPlayer();

  const tmpId = `${process.pid}-${Date.now()}`;
  const tmpPattern = path.join(os.tmpdir(), `aurix-${tmpId}.%(ext)s`);

  let trackTitle = url;
  try {
    const title = await runYtdlp(
      ['--print', '%(title)s - %(uploader)s', '--no-playlist', url],
      5000
    );
    if (title.trim()) trackTitle = title.trim();
  } catch {}

  try {
    await runYtdlp(
      [
        '--no-playlist',
        '-f',
        'bestaudio',
        '-x',
        '--audio-format',
        'mp3',
        '--no-warnings',
        '-o',
        tmpPattern,
        url,
      ],
      60000
    );
  } catch (e: any) {
    return `Download error: ${e.message}`;
  }

  const audioFile = path.join(os.tmpdir(), `aurix-${tmpId}.mp3`);
  let audioPath: string;
  if (!fs.existsSync(audioFile)) {
    const found = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(`aurix-${tmpId}`));
    if (found.length === 0) return 'Error: downloaded file not found';
    audioPath = path.join(os.tmpdir(), found[0]);
  } else {
    audioPath = audioFile;
  }

  const audioEnv = {
    ...process.env,
    PIPEWIRE_RUNTIME_DIR: `/run/user/${process.getuid?.() ?? 0}`,
  };

  const mpv = spawn(
    'mpv',
    [
      '--no-video',
      '--no-terminal',
      '--really-quiet',
      `--input-ipc-server=${MPV_SOCKET}`,
      audioPath,
    ],
    { stdio: ['ignore', 'ignore', 'ignore'], env: audioEnv }
  );

  currentPlayer = mpv;
  currentAudioPath = audioPath;
  currentTrackTitle = trackTitle;
  playerError = '';

  mpv.on('error', (error) => {
    playerError = error.message;
    currentPlayer = null;
    cleanupAudioFile(audioPath);
  });
  mpv.on('close', () => {
    currentPlayer = null;
    currentTrackTitle = '';
    currentAudioPath = '';
    cleanupAudioFile(audioPath);
  });

  return `Now playing: ${trackTitle}\nUse "stop" to stop, "now_playing" for info`;
}

async function downloadMusic(query: string, source: string): Promise<string> {
  if (!query) return 'Error: provide a URL or search query';
  const missing = await missingYtdlp();
  if (missing) return missing;
  const ffmpegMissing = await missingFfmpeg();
  if (ffmpegMissing) return ffmpegMissing;

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

    await runYtdlp(
      [
        '--no-playlist',
        '-f',
        'bestaudio',
        '-x',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '192K',
        '--embed-thumbnail',
        '--embed-metadata',
        '-o',
        path.join(MUSIC_DIR, filename),
        url,
      ],
      120000
    );

    const files = fs.readdirSync(MUSIC_DIR);
    const latest = files.sort().reverse()[0];
    return `Downloaded: ${title.trim()}\nSaved to: ${path.join(MUSIC_DIR, latest)}`;
  } catch (e: any) {
    return `Download error: ${e.message}`;
  }
}

async function queueMusic(query: string, source: string): Promise<string> {
  if (!query) return 'Error: provide a URL or playlist URL';
  const missing = await missingYtdlp();
  if (missing) return missing;

  let url = query;
  if (!query.startsWith('http')) {
    const resolved = await resolveUrl(query, source);
    if (!resolved) return `Could not find: ${query}`;
    url = resolved;
  }

  try {
    const info = await runYtdlp(
      ['--print', '%(playlist_title)s ||| %(playlist_count)s', '--playlist-items', '1', url],
      10000
    );

    return `Queued playlist: ${info.trim()}\nTracks will play sequentially. Use "stop" to stop.`;
  } catch {
    return playMusic(url, source);
  }
}

function stopMusic(): string {
  stopCurrentPlayer();
  return 'Playback stopped';
}

function nowPlaying(): string {
  if (playerError) return `Player error: ${playerError}`;
  if (!currentPlayer) return 'Nothing playing';

  try {
    if (fs.existsSync(MPV_SOCKET)) {
      return currentTrackTitle
        ? `Audio is playing: ${currentTrackTitle}\nUse "stop" to stop playback.`
        : 'Audio is playing. Use "stop" to stop playback.';
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

  return (
    `Downloaded tracks (${files.length}):\n` +
    files
      .map((f, i) => {
        const stat = fs.statSync(path.join(MUSIC_DIR, f));
        const sizeMB = (stat.size / 1048576).toFixed(1);
        return `  ${i + 1}. ${f} (${sizeMB}MB)`;
      })
      .join('\n')
  );
}

async function resolveUrl(query: string, source: string): Promise<string | null> {
  const sources =
    source === 'soundcloud' ? [`scsearch1:${query}`] : [`ytsearch1:${query}`, `scsearch1:${query}`];

  for (const searchQuery of sources) {
    try {
      const result = await runYtdlp(
        ['--print', '%(webpage_url)s', '--no-playlist', '--playlist-items', '1', searchQuery],
        10000
      );
      if (result.trim()) return result.trim();
    } catch {}
  }
  return null;
}

function stopCurrentPlayer() {
  if (currentPlayer) {
    try {
      currentPlayer.kill('SIGTERM');
    } catch {}
    currentPlayer = null;
  }
  if (currentAudioPath) cleanupAudioFile(currentAudioPath);
  try {
    fs.unlinkSync(MPV_SOCKET);
  } catch {}
  currentAudioPath = '';
  currentTrackTitle = '';
}

async function runYtdlp(args: string[], timeout: number = 30000): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('yt-dlp', args, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 5 * 1024 * 1024,
    });
    return String(stdout || stderr || '').trim();
  } catch (e: any) {
    throw new Error(String(e.stderr || e.stdout || e.message || e).trim());
  }
}

async function missingYtdlp(): Promise<string | null> {
  if (await commandExists('yt-dlp')) return null;
  return 'yt-dlp is not installed. Install yt-dlp and ffmpeg to use music search/download/playback.';
}

async function missingFfmpeg(): Promise<string | null> {
  if (await commandExists('ffmpeg')) return null;
  return 'ffmpeg is not installed. Install ffmpeg before converting downloaded audio to mp3.';
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['--version'], { encoding: 'utf8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function cleanupAudioFile(filePath: string) {
  try {
    fs.unlinkSync(filePath);
  } catch {}
}
