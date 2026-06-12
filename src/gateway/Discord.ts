import { EventEmitter } from 'events';
import type { Platform, IncomingMessage } from './Gateway.js';

const DISCORD_COMMANDS = [
  { name: 'start', description: 'Show all commands' },
  { name: 'help', description: 'Quick help' },
  { name: 'reset', description: 'Clear conversation context' },
  { name: 'cancel', description: 'Stop current task and clear queue' },
  { name: 'title', description: 'Name & save session (auto-random if no name)' },
  { name: 'resume', description: 'Load a saved session' },
  { name: 'save', description: 'Save session for later resume' },
  { name: 'model', description: 'Switch AI model' },
  { name: 'baseurl', description: 'Change API base URL' },
  { name: 'apikey', description: 'Set API key' },
  { name: 'depth', description: 'Set research depth (low/medium/high/xhigh/max/ultra)' },
  { name: 'fast', description: 'Toggle fast mode' },
  { name: 'review', description: 'AI code review' },
  { name: 'plan', description: 'Planning mode' },
  { name: 'research', description: 'Deep research with sources' },
  { name: 'tools', description: 'List available tools' },
  { name: 'skills', description: 'List available skills' },
  { name: 'status', description: 'Show current status' },
  { name: 'history', description: 'Show message count' },
  { name: 'compress', description: 'Compress context' },
  { name: 'agents', description: 'Show active agents' },
];

export class DiscordPlatform extends EventEmitter implements Platform {
  name = 'discord';
  private token: string;
  private client: any;

  constructor(token: string) {
    super();
    this.token = token;
  }

  async connect(): Promise<void> {
    const discord = await (Function('return import("discord.js")')() as Promise<any>);
    const { Client, GatewayIntentBits, Events, REST, Routes } = discord;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.client.on(Events.MessageCreate, async (message: any) => {
      if (message.author.bot) return;
      if (!message.mentions.has(this.client.user)) {
        if (message.guild) return;
      }

      const content = message.content
        .replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '')
        .trim();

      const attachments: { type: string; url?: string; filename?: string }[] = [];

      if (message.attachments?.size > 0) {
        for (const [, att] of message.attachments) {
          if (att.contentType?.startsWith('image/') || att.name?.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i)) {
            try {
              const fs = await import('fs');
              const res = await fetch(att.url);
              if (res.ok) {
                const buffer = Buffer.from(await res.arrayBuffer());
                const ext = att.name?.match(/\.\w+$/)?.[0] || '.jpg';
                const localPath = `/tmp/aurix-discord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
                fs.writeFileSync(localPath, buffer);
                attachments.push({ type: 'image', url: localPath, filename: att.name || localPath });
              }
            } catch {}
          }
        }
      }

      if (!content && attachments.length === 0) return;

      this.emit('message', {
        platform: 'discord',
        authorId: message.author.id,
        authorName: message.author.username,
        channelId: message.channel.id,
        content: content || (attachments.length ? 'Check this image' : ''),
        replyTo: message.id,
        attachments: attachments.length > 0 ? attachments : undefined,
      } as IncomingMessage);
    });

    this.client.on(Events.ClientReady, async () => {
      console.log(`  Discord: logged in as ${this.client.user.tag}`);
      try {
        const rest = new REST({ version: '10' }).setToken(this.token);
        await rest.put(
          Routes.applicationCommands(this.client.user.id),
          { body: DISCORD_COMMANDS.map(c => ({
            name: c.name,
            description: c.description,
          })) }
        );
        console.log('  Discord: slash commands registered');
      } catch (e: any) {
        console.error(`  Discord: failed to register slash commands (${e.message})`);
      }
    });

    await this.client.login(this.token);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
    }
  }

  async send(content: string, channelId: string, replyTo?: string): Promise<void> {
    if (!this.client) return;

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) return;

      const options: any = { content };
      if (replyTo) {
        options.messageReference = { messageId: replyTo };
      }

      await channel.send(options);
    } catch (e: any) {
      console.error(`  Discord send error: ${e.message}`);
    }
  }

  async sendFile(filePath: string, channelId: string, caption?: string, replyTo?: string): Promise<void> {
    if (!this.client) throw new Error('Discord client not connected');

    const fs = await import('fs');
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    const discord = await (Function('return import("discord.js")')() as Promise<any>);
    const { AttachmentBuilder } = discord;

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error('Channel not found or not text-based');

    const attachment = new AttachmentBuilder(filePath);
    const options: any = { files: [attachment] };
    if (caption) options.content = caption;
    if (replyTo) options.messageReference = { messageId: replyTo };

    await channel.send(options);
  }
}
