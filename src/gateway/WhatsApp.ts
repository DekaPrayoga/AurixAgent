import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { useSQLiteAuthState } from './WASessionStore.js';

import type { Platform, IncomingMessage } from './Gateway.js';
import * as os from 'os';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const AUDIO_EXTS = new Set(['mp3', 'm4a', 'ogg', 'wav', 'opus']);
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm']);

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav', opus: 'audio/opus',
  mp4: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mov: 'video/quicktime', webm: 'video/webm',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: 'application/zip', txt: 'text/plain', json: 'application/json',
};

export class WhatsAppPlatform extends EventEmitter implements Platform {
  name = 'whatsapp';
  private socket: any;
  private dbPath: string;
  private onQR?: (qr: string) => void;
  private onConnected?: () => void;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private reconnecting = false;
  private closed = false;

  constructor(options?: { dbPath?: string; onQR?: (qr: string) => void; onConnected?: () => void }) {
    super();
    this.dbPath = options?.dbPath || path.join(os.homedir(), '.aurix', 'wa-session.db');
    this.onQR = options?.onQR;
    this.onConnected = options?.onConnected;
  }

  async connect(): Promise<void> {
    this.closed = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.socket) {
      try { this.socket.ev?.removeAllListeners?.(); } catch {}
      try { this.socket.end?.(undefined); } catch {}
      this.socket = undefined;
    }
    try {
      const { default: makeWASocket, DisconnectReason } = await import('@whiskeysockets/baileys');
      const pino = (await import('pino')).default;

      const { state, saveCreds } = await useSQLiteAuthState(this.dbPath);

      this.socket = makeWASocket({
        auth: state as any,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: !this.onQR,
      });

      this.socket.ev.on('creds.update', saveCreds);

      this.socket.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && this.onQR) {
          this.onQR(qr);
        }

        if (connection === 'open') {
          console.log(`  WhatsApp: connected`);
          this.reconnectAttempts = 0;
          this.reconnecting = false;
          if (this.onConnected) this.onConnected();
        }

        if (connection === 'close') {
          const reason = lastDisconnect?.error?.output?.statusCode;
          if (reason !== DisconnectReason.loggedOut && !this.closed) {
            this.scheduleReconnect();
          } else {
            console.log('  WhatsApp: logged out, need to re-scan QR');
          }
        }
      });

      this.socket.ev.on('messages.upsert', async (event: any) => {
        for (const msg of event.messages) {
          if (msg.key.fromMe) continue;

          const textMsg = msg.message?.extendedTextMessage?.text || msg.message?.conversation;
          const imageMsg = msg.message?.imageMessage;
          const text = textMsg || imageMsg?.caption || '';

          if (!text.trim() && !imageMsg) continue;
          if (text.trim() && !text.trim().toLowerCase().startsWith('!ai') && !imageMsg) continue;
          if (imageMsg && imageMsg.caption && !imageMsg.caption.toLowerCase().startsWith('!ai')) continue;

          const chatId = msg.key.remoteJid;
          const senderId = msg.key.participant || chatId;
          const contextInfo = msg.message?.extendedTextMessage?.contextInfo || imageMsg?.contextInfo;
          const forwardedFrom = contextInfo?.forwardingScore > 0
            ? (contextInfo.forwardedNewsletterMessageInfo?.newsletterName || 'forwarded')
            : undefined;

          const attachments: { type: string; url?: string; filename?: string }[] = [];

          if (imageMsg) {
            try {
              const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
              const buffer = await downloadMediaMessage(msg, 'buffer', {});
              const mime = imageMsg.mimetype || 'image/jpeg';
              const ext = mime.split('/')[1]?.split(';')[0] || 'jpg';
              const localPath = `/tmp/aurix-whatsapp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
              fs.writeFileSync(localPath, buffer);
              attachments.push({ type: 'image', url: localPath, filename: path.basename(localPath) });
            } catch (e: any) {
              console.error(`  WhatsApp image download error: ${e.message}`);
            }
          }

          this.emit('message', {
            platform: 'whatsapp',
            authorId: senderId,
            authorName: msg.pushName || senderId,
            channelId: chatId,
            content: text.trim() || (attachments.length ? 'Check this image' : ''),
            replyTo: msg.key.id,
            forwardedFrom,
            attachments: attachments.length > 0 ? attachments : undefined,
          } as IncomingMessage);
        }
      });
    } catch (e: any) {
      console.error(`  WhatsApp: Baileys not installed. Run: npm install @whiskeysockets/baileys pino`);
      throw e;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnecting || this.closed) return;
    this.reconnecting = true;
    this.reconnectAttempts += 1;
    const base = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempts, 5));
    const jitter = Math.floor(Math.random() * 1000);
    const delay = base + jitter;
    console.log(`  WhatsApp: reconnecting in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnecting = false;
      this.connect().catch((e) => {
        console.error(`  WhatsApp reconnect error: ${e.message}`);
        this.scheduleReconnect();
      });
    }, delay);
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.socket) {
      try { this.socket.ev?.removeAllListeners?.(); } catch {}
      this.socket.end(undefined);
      this.socket = undefined;
    }
  }

  async send(content: string, channelId: string, replyTo?: string, options?: any): Promise<void> {
    if (!this.socket) return;

    try {
      const sendOptions: any = { ...(options || {}) };
      if (replyTo) {
        sendOptions.quoted = { key: { remoteJid: channelId, id: replyTo, fromMe: false } };
      }
      await this.socket.sendMessage(channelId, { text: content }, sendOptions);
    } catch (e: any) {
      console.error(`  WhatsApp send error: ${e.message}`);
    }
  }

  async sendFile(filePath: string, channelId: string, caption?: string, replyTo?: string): Promise<void> {
    if (!this.socket) throw new Error('WhatsApp not connected');
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    const ext = path.extname(filePath).toLowerCase().slice(1);
    const filename = path.basename(filePath);
    const buffer = fs.readFileSync(filePath);
    const mimetype = MIME_TYPES[ext] || 'application/octet-stream';

    let message: any;

    if (IMAGE_EXTS.has(ext)) {
      message = { image: buffer, caption, mimetype, fileName: filename };
    } else if (AUDIO_EXTS.has(ext)) {
      message = { audio: buffer, mimetype, ptt: false };
    } else if (VIDEO_EXTS.has(ext)) {
      message = { video: buffer, caption, mimetype, fileName: filename };
    } else {
      message = { document: buffer, fileName: filename, mimetype, caption };
    }

    const sendOptions: any = {};
    if (replyTo) {
      sendOptions.quoted = { key: { remoteJid: channelId, id: replyTo, fromMe: false } };
    }

    await this.socket.sendMessage(channelId, message, sendOptions);
  }
}
