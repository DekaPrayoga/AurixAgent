import { EventEmitter } from 'events';
import type { Platform, IncomingMessage } from './Gateway.js';
import { useSQLiteAuthState } from './WASessionStore.js';
import * as path from 'path';
import * as os from 'os';

export class WhatsAppPlatform extends EventEmitter implements Platform {
  name = 'whatsapp';
  private socket: any;
  private dbPath: string;

  constructor(dbPath?: string) {
    super();
    this.dbPath = dbPath || path.join(os.homedir(), '.aurix', 'wa-session.db');
  }

  async connect(): Promise<void> {
    try {
      const { default: makeWASocket, DisconnectReason } = await import('@whiskeysockets/baileys');
      const pino = (await import('pino')).default;

      const { state, saveCreds } = await useSQLiteAuthState(this.dbPath);

      this.socket = makeWASocket({
        auth: state as any,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
      });

      this.socket.ev.on('creds.update', saveCreds);

      this.socket.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          console.log(`  WhatsApp: connected`);
        }

        if (connection === 'close') {
          const reason = lastDisconnect?.error?.output?.statusCode;
          if (reason !== DisconnectReason.loggedOut) {
            this.connect();
          } else {
            console.log('  WhatsApp: logged out, need to re-scan QR');
          }
        }
      });

      this.socket.ev.on('messages.upsert', async (event: any) => {
        for (const msg of event.messages) {
          if (msg.key.fromMe) continue;
          if (!msg.message?.textMessage && !msg.message?.conversation) continue;

          const text = msg.message.textMessage || msg.message.conversation || '';
          if (!text.trim()) continue;
          if (!text.trim().toLowerCase().startsWith('!ai')) continue;

          const chatId = msg.key.remoteJid;
          const senderId = msg.key.participant || chatId;

          this.emit('message', {
            platform: 'whatsapp',
            authorId: senderId,
            authorName: msg.pushName || senderId,
            channelId: chatId,
            content: text.trim(),
            replyTo: msg.key.id,
          } as IncomingMessage);
        }
      });
    } catch (e: any) {
      console.error(`  WhatsApp: Baileys not installed. Run: npm install @whiskeysockets/baileys pino better-sqlite3`);
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.end(undefined);
    }
  }

  async send(content: string, channelId: string, replyTo?: string): Promise<void> {
    if (!this.socket) return;

    try {
      const options: any = {};
      if (replyTo) {
        options.quoted = { key: { remoteJid: channelId, id: replyTo, fromMe: false } };
      }
      await this.socket.sendMessage(channelId, { text: content }, options);
    } catch (e: any) {
      console.error(`  WhatsApp send error: ${e.message}`);
    }
  }
}
