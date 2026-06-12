import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type { Platform, IncomingMessage } from './Gateway.js';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);
const AUDIO_EXTS = new Set(['mp3', 'm4a', 'ogg', 'wav', 'flac', 'aac']);
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm']);

export class TelegramPlatform extends EventEmitter implements Platform {
  name = 'telegram';
  private token: string;
  private polling: boolean = false;
  private offset: number = 0;

  constructor(token: string) {
    super();
    this.token = token;
  }

  async connect(): Promise<void> {
    const me = await this.api('getMe', {});
    console.log(`  Telegram: logged in as @${me.username}`);

    await this.registerCommands();

    this.polling = true;
    this.poll();
  }

  async disconnect(): Promise<void> {
    this.polling = false;
  }

  async send(content: string, channelId: string, replyTo?: string): Promise<void> {
    const params: Record<string, any> = {
      chat_id: channelId,
      text: content,
    };

    if (replyTo) {
      params.reply_to_message_id = replyTo;
    }

    try {
      await this.api('sendMessage', params);
    } catch (e: any) {
      if (e.message?.includes('parse')) {
        params.text = escapeMarkdown(content);
        try {
          await this.api('sendMessage', params);
        } catch (e2: any) {
          delete params.parse_mode;
          params.text = content;
          await this.api('sendMessage', params);
        }
      } else {
        console.error(`  Telegram send error: ${e.message}`);
      }
    }
  }

  async sendFile(filePath: string, channelId: string, caption?: string, replyTo?: string): Promise<void> {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    const ext = path.extname(filePath).toLowerCase().slice(1);
    const filename = path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);

    let method: string;
    let fileField: string;

    if (IMAGE_EXTS.has(ext)) {
      method = 'sendPhoto';
      fileField = 'photo';
    } else if (AUDIO_EXTS.has(ext)) {
      method = 'sendAudio';
      fileField = 'audio';
    } else if (VIDEO_EXTS.has(ext)) {
      method = 'sendVideo';
      fileField = 'video';
    } else {
      method = 'sendDocument';
      fileField = 'document';
    }

    const form = new FormData();
    form.append('chat_id', channelId);
    form.append(fileField, new Blob([fileBuffer]), filename);

    if (caption) form.append('caption', caption);
    if (replyTo) form.append('reply_to_message_id', replyTo);

    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    const res = await fetch(url, { method: 'POST', body: form });
    const data = await res.json() as any;

    if (!data.ok) {
      throw new Error(data.description || `Telegram ${method} failed`);
    }
  }

  private async registerCommands(): Promise<void> {
    try {
      await this.api('setMyCommands', {
        commands: [
          { command: 'start', description: '📋 Show all commands' },
          { command: 'help', description: '❓ Quick help' },
          { command: 'reset', description: '🔄 Clear conversation' },
          { command: 'cancel', description: '🛑 Stop current task' },
          { command: 'title', description: '💾 Name & save session' },
          { command: 'resume', description: '📂 Load saved session' },
          { command: 'proxy', description: '🌐 Add proxy to browser pool' },
          { command: 'save', description: '💾 Save session' },
          { command: 'model', description: '🤖 Switch AI model' },
          { command: 'baseurl', description: '🔌 Change API base URL' },
          { command: 'apikey', description: '🔑 Set API key' },
          { command: 'depth', description: '📊 Research depth (low/medium/high/xhigh/max/ultra)' },
          { command: 'fast', description: '⚡ Toggle fast mode' },
          { command: 'review', description: '🔍 AI code review' },
          { command: 'plan', description: '📋 Planning mode' },
          { command: 'research', description: '🔬 Deep research with sources' },
          { command: 'tools', description: '🔧 List available tools' },
          { command: 'skills', description: '📚 List available skills' },
          { command: 'status', description: '⏳ Show current status' },
          { command: 'history', description: '📝 Message count' },
          { command: 'compress', description: '📦 Compress context' },
          { command: 'agents', description: '🤖 Show active agents' },
        ],
      });
      console.log('  Telegram: commands registered');
    } catch (e: any) {
      console.error(`  Telegram: failed to register commands (${e.message})`);
    }
  }

  private async poll() {
    while (this.polling) {
      try {
        const updates = await this.api('getUpdates', {
          offset: this.offset,
          timeout: 30,
          allowed_updates: ['message'],
        });

        for (const update of updates) {
          this.offset = update.update_id + 1;
          const msg = update.message;
          if (!msg) continue;

          const text = msg.text || msg.caption || '';
          const hasPhoto = msg.photo?.length > 0;
          const hasImageDoc = msg.document?.mime_type?.startsWith('image/');

          if (!text && !hasPhoto && !hasImageDoc) continue;

          let forwardedFrom: string | undefined;
          if (msg.forward_from) {
            forwardedFrom = msg.forward_from.username || msg.forward_from.first_name || 'telegram';
          } else if (msg.forward_from_chat) {
            forwardedFrom = msg.forward_from_chat.username || msg.forward_from_chat.title || 'telegram';
          } else if (msg.forward_sender_name) {
            forwardedFrom = msg.forward_sender_name;
          } else if (msg.forward_origin) {
            forwardedFrom = msg.forward_origin.chat?.username || msg.forward_origin.sender_user?.first_name || 'telegram';
          }

          const attachments: { type: string; url?: string; filename?: string }[] = [];

          if (hasPhoto) {
            const photo = msg.photo[msg.photo.length - 1];
            const filePath = await this.downloadTelegramFile(photo.file_id);
            if (filePath) {
              attachments.push({ type: 'image', url: filePath, filename: path.basename(filePath) });
            }
          } else if (hasImageDoc) {
            const filePath = await this.downloadTelegramFile(msg.document.file_id);
            if (filePath) {
              attachments.push({ type: 'image', url: filePath, filename: msg.document.file_name || path.basename(filePath) });
            }
          }

          this.emit('message', {
            platform: 'telegram',
            authorId: String(msg.from?.id || msg.chat.id),
            authorName: msg.from?.first_name || msg.from?.username || 'Unknown',
            channelId: String(msg.chat.id),
            content: text || (attachments.length ? 'Check this image' : ''),
            replyTo: String(msg.message_id),
            forwardedFrom,
            attachments: attachments.length > 0 ? attachments : undefined,
          } as IncomingMessage);
        }
      } catch (e: any) {
        console.error(`  Telegram poll error: ${e.message}`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  private async downloadTelegramFile(fileId: string): Promise<string | null> {
    try {
      const file = await this.api('getFile', { file_id: fileId });
      const url = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
      const ext = path.extname(file.file_path || '.jpg') || '.jpg';
      const localPath = `/tmp/aurix-telegram-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;

      const res = await fetch(url);
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(localPath, buffer);
      return localPath;
    } catch (e: any) {
      console.error(`  Telegram file download error: ${e.message}`);
      return null;
    }
  }

  private async api(method: string, params: Record<string, any>): Promise<any> {
    const url = `https://api.telegram.org/bot${this.token}/${method}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await res.json() as any;
    if (!data.ok) {
      throw new Error(data.description || 'Telegram API error');
    }

    return data.result;
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}
