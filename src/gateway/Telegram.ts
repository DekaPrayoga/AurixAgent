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
  private _polling: boolean = false;
  private offset: number = 0;
  private pendingText = new Map<
    string,
    { msg: any; text: string; timer: ReturnType<typeof setTimeout> }
  >();
  private pendingPhoto = new Map<
    string,
    {
      msg: any;
      attachments: { type: string; url?: string; filename?: string }[];
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(token: string) {
    super();
    this.token = token;
  }

  async connect(): Promise<void> {
    const me = await this.api('getMe', {});
    console.log(`  Telegram: logged in as @${me.username}`);

    await this.registerCommands();

    // Clear any webhook and pending updates from previous instances
    try {
      await this.api('deleteWebhook', { drop_pending_updates: true });
      // Clear pending updates by getting latest offset
      const updates = await this.api('getUpdates', { offset: -1, timeout: 0 });
      if (updates.length > 0) {
        this.offset = updates[updates.length - 1].update_id + 1;
        console.log(`  Telegram: cleared ${updates.length} pending updates`);
      }
    } catch (e: any) {
      console.error(`  Telegram: failed to clear pending updates: ${e.message}`);
    }

    this.polling = true;
    this.poll();
  }

  async disconnect(): Promise<void> {
    this.polling = false;
    this._polling = false;
    for (const pending of this.pendingText.values()) clearTimeout(pending.timer);
    for (const pending of this.pendingPhoto.values()) clearTimeout(pending.timer);
    this.pendingText.clear();
    this.pendingPhoto.clear();
    try {
      await this.api('deleteWebhook', { drop_pending_updates: false });
    } catch {}
  }

  async send(
    content: string,
    channelId: string,
    replyTo?: string,
    options?: any
  ): Promise<{ messageId?: string } | void> {
    if (looksLikeMarkdownTable(content) && !options?.reply_markup) {
      try {
        const result = await this.sendRichMarkdown(content, channelId, replyTo, options);
        if (result) return result;
      } catch (e: any) {
        const msg = String(e.message || '');
        if (
          !/method not found|not found|endpoint|can't parse rich message|bad request/i.test(msg)
        ) {
          console.error(`  Telegram rich table send error: ${msg}`);
          return;
        }
      }
    }

    const params: Record<string, any> = {
      chat_id: channelId,
      text: content,
    };

    if (replyTo) {
      params.reply_to_message_id = replyTo;
    }

    if (options) {
      if (options.reply_markup) params.reply_markup = options.reply_markup;
      if (options.parse_mode) params.parse_mode = options.parse_mode;
      if (options.disable_web_page_preview !== undefined) {
        params.disable_web_page_preview = options.disable_web_page_preview;
      }
    }

    try {
      const result = await this.api('sendMessage', params);
      return { messageId: result?.message_id ? String(result.message_id) : undefined };
    } catch (e: any) {
      if (/message is too long/i.test(String(e.message || '')) && content.length > 3900) {
        const chunks = splitTelegramMessage(content, 3900);
        let firstId: string | undefined;
        for (let i = 0; i < chunks.length; i++) {
          const chunkParams = { ...params, text: chunks[i] };
          const result = await this.api('sendMessage', chunkParams);
          if (i === 0 && result?.message_id) firstId = String(result.message_id);
        }
        return { messageId: firstId };
      }
      if (e.message?.includes('parse')) {
        delete params.parse_mode;
        params.text = stripTelegramHtml(content);
        try {
          const result = await this.api('sendMessage', params);
          return { messageId: result?.message_id ? String(result.message_id) : undefined };
        } catch (e2: any) {
          params.text = content;
          const result = await this.api('sendMessage', params);
          return { messageId: result?.message_id ? String(result.message_id) : undefined };
        }
      } else {
        console.error(`  Telegram send error: ${e.message}`);
      }
    }
  }

  async edit(content: string, channelId: string, messageId: string, options?: any): Promise<void> {
    const params: Record<string, any> = {
      chat_id: channelId,
      message_id: messageId,
      text: content,
    };
    if (options?.parse_mode) params.parse_mode = options.parse_mode;
    if (options?.disable_web_page_preview !== undefined) {
      params.disable_web_page_preview = options.disable_web_page_preview;
    }
    try {
      await this.api('editMessageText', params);
    } catch (e: any) {
      const msg = String(e.message || '').toLowerCase();
      if (msg.includes('not modified')) return;
      if (msg.includes('parse')) {
        delete params.parse_mode;
        params.text = stripTelegramHtml(content);
        try {
          await this.api('editMessageText', params);
        } catch {}
      }
    }
  }

  async react(channelId: string, messageId: string, emoji: string): Promise<void> {
    try {
      await this.api('setMessageReaction', {
        chat_id: channelId,
        message_id: messageId,
        reaction: [{ type: 'emoji', emoji }],
        is_big: false,
      });
    } catch {}
  }

  async typing(channelId: string): Promise<void> {
    try {
      await this.api('sendChatAction', { chat_id: channelId, action: 'typing' });
    } catch {}
  }

  async sendFile(
    filePath: string,
    channelId: string,
    caption?: string,
    replyTo?: string
  ): Promise<void> {
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
    const data = (await res.json()) as any;

    if (!data.ok) {
      throw new Error(data.description || `Telegram ${method} failed`);
    }
  }

  private async sendRichMarkdown(
    content: string,
    channelId: string,
    replyTo?: string,
    options?: any
  ): Promise<{ messageId?: string } | null> {
    const markdown = stripTelegramHtml(content);
    const params: Record<string, any> = {
      chat_id: channelId,
      rich_message: { markdown },
    };

    if (replyTo) {
      const id = Number(replyTo);
      params.reply_parameters = Number.isFinite(id) ? { message_id: id } : { message_id: replyTo };
    }
    if (options?.disable_web_page_preview !== undefined) {
      params.link_preview_options = { is_disabled: Boolean(options.disable_web_page_preview) };
    }

    const result = await this.api('sendRichMessage', params);
    return { messageId: result?.message_id ? String(result.message_id) : undefined };
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
          { command: 'code_review', description: '🔍 Review current git diff' },
          { command: 'security_review', description: '🛡️ Security review' },
          { command: 'diff', description: '📋 Summarize git diff' },
          { command: 'verify', description: '✅ Verify current changes' },
          { command: 'plan', description: '📋 Planning mode' },
          { command: 'research', description: '🔬 Deep research with sources' },
          { command: 'research_forums', description: '🌐 Research forums/social sources' },
          { command: 'summarize', description: '📝 Summarize text' },
          { command: 'deep', description: '🧠 Enable ultra depth' },
          { command: 'deep_research', description: '🧠 Ultra-depth research' },
          { command: 'pdf', description: '📄 Generate PDF' },
          { command: 'pptx', description: '📊 Generate PowerPoint' },
          { command: 'xlsx', description: '📈 Generate spreadsheet' },
          { command: 'tools', description: '🔧 List available tools' },
          { command: 'skills', description: '📚 List available skills' },
          { command: 'status', description: '⏳ Show current status' },
          { command: 'history', description: '📝 Message count' },
          { command: 'history_search', description: '🔎 Search durable sessions' },
          { command: 'sessions', description: '💾 List saved sessions' },
          { command: 'compress', description: '📦 Compress context' },
          { command: 'agents', description: '🤖 Show active agents' },
          { command: 'usage', description: '📊 Usage/tool stats' },
          { command: 'insights', description: '💡 Learned workflow insights' },
          { command: 'evals', description: '🧪 Evaluate recent run' },
          { command: 'replay', description: '🎬 Replay observer timeline' },
          { command: 'trash', description: '🗑️ Recover deleted files' },
          { command: 'cron', description: '⏰ Manage scheduled jobs' },
          { command: 'new', description: '🆕 Start fresh session' },
          { command: 'whoami', description: '👤 Show access identity' },
          { command: 'cost', description: '💰 Token usage' },
          { command: 'doctor', description: '🩺 Gateway health check' },
          { command: 'permissions', description: '🔐 Permission mode/status' },
          { command: 'yolo', description: '⚡ Auto-approve tool calls' },
          { command: 'btw', description: '❄️ Check status or inject context' },
        ],
      });
      console.log('  Telegram: commands registered');
    } catch (e: any) {
      console.error(`  Telegram: failed to register commands (${e.message})`);
    }
  }

  private async poll() {
    if (this._polling) return; // Prevent multiple polling loops
    this._polling = true;

    while (this.polling) {
      try {
        const updates = await this.api('getUpdates', {
          offset: this.offset,
          timeout: 30,
          allowed_updates: ['message', 'callback_query'],
        });

        for (const update of updates) {
          this.offset = update.update_id + 1;

          if (update.callback_query) {
            const cb = update.callback_query;
            try {
              await this.api('answerCallbackQuery', { callback_query_id: cb.id });
            } catch (e) {}

            this.emit('message', {
              platform: 'telegram',
              authorId: String(cb.from?.id),
              authorName: cb.from?.first_name || cb.from?.username || 'Unknown',
              channelId: String(cb.message?.chat.id || cb.from?.id),
              content: cb.data || '',
              replyTo: cb.message ? String(cb.message.message_id) : undefined,
            } as IncomingMessage);
            continue;
          }

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
            forwardedFrom =
              msg.forward_from_chat.username || msg.forward_from_chat.title || 'telegram';
          } else if (msg.forward_sender_name) {
            forwardedFrom = msg.forward_sender_name;
          } else if (msg.forward_origin) {
            forwardedFrom =
              msg.forward_origin.chat?.username ||
              msg.forward_origin.sender_user?.first_name ||
              'telegram';
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
              attachments.push({
                type: 'image',
                url: filePath,
                filename: msg.document.file_name || path.basename(filePath),
              });
            }
          }

          this.enqueueMessage(msg, text, forwardedFrom, attachments);
        }
      } catch (e: any) {
        if (e.message?.includes('Conflict')) {
          // Another bot instance is polling - wait and retry
          console.error(`  Telegram poll conflict - another instance polling. Waiting 10s...`);
          await new Promise((r) => setTimeout(r, 10000));
        } else {
          console.error(`  Telegram poll error: ${e.message}`);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
    this._polling = false;
  }

  private emitIncoming(
    msg: any,
    text: string,
    forwardedFrom?: string,
    attachments?: { type: string; url?: string; filename?: string }[]
  ): void {
    this.emit('message', {
      platform: 'telegram',
      authorId: String(msg.from?.id || msg.chat.id),
      authorName: msg.from?.first_name || msg.from?.username || 'Unknown',
      channelId: String(msg.chat.id),
      content: text || (attachments?.length ? 'Check this image' : ''),
      replyTo: String(msg.message_id),
      forwardedFrom,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
    } as IncomingMessage);
  }

  private enqueueMessage(
    msg: any,
    text: string,
    forwardedFrom?: string,
    attachments: { type: string; url?: string; filename?: string }[] = []
  ): void {
    const key = `${msg.chat.id}:${msg.from?.id || msg.chat.id}`;
    if (attachments.length > 0) {
      const existing = this.pendingPhoto.get(key);
      if (existing) {
        clearTimeout(existing.timer);
        existing.attachments.push(...attachments);
        existing.msg = msg;
        existing.timer = setTimeout(() => this.flushPhotoBatch(key), 800);
        return;
      }
      this.pendingPhoto.set(key, {
        msg,
        attachments: [...attachments],
        timer: setTimeout(() => this.flushPhotoBatch(key), 800),
      });
      return;
    }

    const delay = text.length <= 320 ? 180 : text.length <= 1024 ? 240 : 350;
    const existing = this.pendingText.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.text = `${existing.text}\n${text}`.trim();
      existing.msg = msg;
      existing.timer = setTimeout(() => this.flushTextBatch(key), delay);
      return;
    }
    this.pendingText.set(key, {
      msg,
      text,
      timer: setTimeout(() => this.flushTextBatch(key), delay),
    });
  }

  private flushTextBatch(key: string): void {
    const pending = this.pendingText.get(key);
    if (!pending) return;
    this.pendingText.delete(key);
    this.emitIncoming(pending.msg, pending.text);
  }

  private flushPhotoBatch(key: string): void {
    const pending = this.pendingPhoto.get(key);
    if (!pending) return;
    this.pendingPhoto.delete(key);
    this.emitIncoming(
      pending.msg,
      pending.msg.caption || 'Check these images',
      undefined,
      pending.attachments
    );
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

    const data = (await res.json()) as any;
    if (!data.ok) {
      throw new Error(data.description || 'Telegram API error');
    }

    return data.result;
  }
}

function splitTelegramMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';

  for (const line of lines) {
    if (line.length > maxLen) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < line.length; i += maxLen) chunks.push(line.slice(i, i + maxLen));
      continue;
    }
    if (current.length + line.length + 1 > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}

function looksLikeMarkdownTable(text: string): boolean {
  const plain = stripTelegramHtml(text);
  const lines = plain.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i].trim();
    const divider = lines[i + 1].trim();
    if (!header.includes('|') || !divider.includes('|')) continue;
    const dividerCells = divider
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
    if (dividerCells.length < 2) continue;
    if (dividerCells.every((cell) => /^:?-{3,}:?$/.test(cell))) return true;
  }
  return false;
}

function stripTelegramHtml(text: string): string {
  return text
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote)[^>]*>/gi, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
