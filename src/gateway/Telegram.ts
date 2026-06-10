import { EventEmitter } from 'events';
import type { Platform, IncomingMessage } from './Gateway.js';

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

  private async registerCommands(): Promise<void> {
    try {
      await this.api('setMyCommands', {
        commands: [
          { command: 'start', description: '📋 Show all commands' },
          { command: 'help', description: '❓ Quick help' },
          { command: 'reset', description: '🔄 Clear conversation' },
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
          { command: 'save', description: '💾 Save session' },
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

          if (update.message?.text) {
            const msg = update.message;
            this.emit('message', {
              platform: 'telegram',
              authorId: String(msg.from?.id || msg.chat.id),
              authorName: msg.from?.first_name || msg.from?.username || 'Unknown',
              channelId: String(msg.chat.id),
              content: msg.text,
              replyTo: String(msg.message_id),
            } as IncomingMessage);
          }
        }
      } catch (e: any) {
        console.error(`  Telegram poll error: ${e.message}`);
        await new Promise(r => setTimeout(r, 5000));
      }
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
