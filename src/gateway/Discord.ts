import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Platform, IncomingMessage } from './Gateway.js';

const DISCORD_COMMANDS = [
  { name: 'start', description: 'Show all commands' },
  { name: 'help', description: 'Quick help' },
  { name: 'reset', description: 'Clear conversation context' },
  { name: 'cancel', description: 'Stop current task and clear queue' },
  { name: 'title', description: 'Name & save session (auto-random if no name)' },
  { name: 'resume', description: 'Load a saved session' },
  { name: 'proxy', description: 'Add proxy IPs to browser pool' },
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

const DISCORD_IMAGE_COMMAND = {
  name: 'image',
  description: 'Image generation',
  options: [
    {
      type: 1,
      name: 'gen',
      description: 'Generate an image',
      options: [
        {
          type: 3,
          name: 'description',
          description: 'What image to generate',
          required: true,
        },
      ],
    },
    {
      type: 1,
      name: 'setup',
      description: 'Configure image generation',
    },
  ],
};

export class DiscordPlatform extends EventEmitter implements Platform {
  name = 'discord';
  private token: string;
  private client: any;
  private discord: any;
  private pendingImageInteractions = new Map<string, any>();
  private pendingModalDescriptions = new Map<string, string | undefined>();

  constructor(token: string) {
    super();
    this.token = token;
  }

  async connect(): Promise<void> {
    this.discord = await (Function('return import("discord.js")')() as Promise<any>);
    const { Client, GatewayIntentBits, Events, REST, Routes } = this.discord;

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

      const attachments = await this.downloadAttachments(message.attachments);
      if (!content && attachments.length === 0) return;

      this.emit('message', {
        platform: 'discord',
        authorId: message.author.id,
        authorName: message.author.username,
        channelId: message.channel.id,
        content: content || (attachments.length ? 'Check this file' : ''),
        replyTo: message.id,
        chatType: message.guild ? 'group' : 'dm',
        attachments: attachments.length > 0 ? attachments : undefined,
      } as IncomingMessage);
    });

    this.client.on(Events.InteractionCreate, async (interaction: any) => {
      try {
        if (interaction.isChatInputCommand?.()) {
          await this.handleChatInput(interaction);
          return;
        }
        if (
          interaction.isModalSubmit?.() &&
          String(interaction.customId || '').startsWith('aurix_image_config:')
        ) {
          await this.handleImageConfigSubmit(interaction);
        }
      } catch (e: any) {
        console.error(`  Discord interaction error: ${e.message}`);
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: `Error: ${e.message}`, ephemeral: true });
          }
        } catch {}
      }
    });

    this.client.on(Events.ClientReady, async () => {
      console.log(`  Discord: logged in as ${this.client.user.tag}`);
      try {
        const rest = new REST({ version: '10' }).setToken(this.token);
        await rest.put(Routes.applicationCommands(this.client.user.id), {
          body: [
            ...DISCORD_COMMANDS.map((c) => ({ name: c.name, description: c.description })),
            DISCORD_IMAGE_COMMAND,
          ],
        });
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

  async send(content: string, channelId: string, replyTo?: string, options?: any): Promise<void> {
    if (!this.client) return;

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) return;

      const sendOptions: any = { ...(options || {}), content };
      if (replyTo && !sendOptions.messageReference) {
        sendOptions.messageReference = { messageId: replyTo };
      }

      await channel.send(sendOptions);
    } catch (e: any) {
      console.error(`  Discord send error: ${e.message}`);
    }
  }

  async sendFile(
    filePath: string,
    channelId: string,
    caption?: string,
    replyTo?: string
  ): Promise<void> {
    if (!this.client) throw new Error('Discord client not connected');

    const fs = await import('fs');
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    const { AttachmentBuilder } =
      this.discord || (await (Function('return import("discord.js")')() as Promise<any>));

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error('Channel not found or not text-based');

    const attachment = new AttachmentBuilder(filePath);
    const options: any = { files: [attachment] };
    if (caption) options.content = caption;
    if (replyTo) options.messageReference = { messageId: replyTo };

    await channel.send(options);
  }

  async requestImageConfigModal(
    channelId: string,
    userId: string,
    description?: string
  ): Promise<void> {
    const key = `${channelId}:${userId}`;
    const interaction = this.pendingImageInteractions.get(key);
    if (!interaction) {
      await this.send(
        'Run /image setup to configure image generation, then retry /image gen.',
        channelId
      );
      return;
    }
    this.pendingImageInteractions.delete(key);
    await this.showImageConfigModal(interaction, description);
  }

  async ackImageGenerationRequest(channelId: string, userId: string): Promise<void> {
    const key = `${channelId}:${userId}`;
    const interaction = this.pendingImageInteractions.get(key);
    if (!interaction) return;
    this.pendingImageInteractions.delete(key);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '🎨 Image request received.', ephemeral: true });
    }
  }

  private async handleChatInput(interaction: any): Promise<void> {
    const command = String(interaction.commandName || '');
    if (command === 'image') {
      const subcommand = interaction.options?.getSubcommand?.();
      if (subcommand === 'setup') {
        await this.showImageConfigModal(interaction);
        return;
      }
      if (subcommand === 'gen') {
        const description = String(interaction.options?.getString?.('description') || '').trim();
        const key = `${interaction.channelId}:${interaction.user.id}`;
        this.pendingImageInteractions.set(key, interaction);
        setTimeout(() => this.pendingImageInteractions.delete(key), 10_000);
        this.emit('message', this.interactionMessage(interaction, `/image:gen ${description}`));
        return;
      }
    }

    if (DISCORD_COMMANDS.some((c) => c.name === command)) {
      this.emit('message', this.interactionMessage(interaction, `/${command}`));
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Command received.', ephemeral: true });
      }
    }
  }

  private async showImageConfigModal(interaction: any, description?: string): Promise<void> {
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = this.discord;
    const id = `aurix_image_config:${randomUUID().slice(0, 12)}`;
    this.pendingModalDescriptions.set(id, description);
    setTimeout(() => this.pendingModalDescriptions.delete(id), 10 * 60_000);

    const modal = new ModalBuilder().setCustomId(id).setTitle('Image Generator Setup');
    const baseUrl = new TextInputBuilder()
      .setCustomId('baseUrl')
      .setLabel('Base URL')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('https://api.example.com/v1');
    const apiKey = new TextInputBuilder()
      .setCustomId('apiKey')
      .setLabel('API Key')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const format = new TextInputBuilder()
      .setCustomId('format')
      .setLabel('Format: openai/anthropic or 1/2')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('openai');

    modal.addComponents(
      new ActionRowBuilder().addComponents(baseUrl),
      new ActionRowBuilder().addComponents(apiKey),
      new ActionRowBuilder().addComponents(format)
    );
    await interaction.showModal(modal);
  }

  private async handleImageConfigSubmit(interaction: any): Promise<void> {
    const baseUrl = String(interaction.fields.getTextInputValue('baseUrl') || '').trim();
    const apiKey = String(interaction.fields.getTextInputValue('apiKey') || '').trim();
    const formatRaw = String(interaction.fields.getTextInputValue('format') || '')
      .trim()
      .toLowerCase();
    const format =
      formatRaw === '1' || formatRaw === 'openai'
        ? 'openai'
        : formatRaw === '2' || formatRaw === 'anthropic'
          ? 'anthropic'
          : null;

    if (!format) {
      await interaction.reply({
        content: 'Format invalid. Use openai/1 or anthropic/2.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: '✅ Image config received. Saving securely...',
      ephemeral: true,
    });
    const description = this.pendingModalDescriptions.get(interaction.customId);
    this.pendingModalDescriptions.delete(interaction.customId);
    this.emit('message', {
      ...this.interactionMessage(interaction, '/image_configured'),
      imageConfig: { baseUrl, apiKey, format, description },
    } as IncomingMessage);
  }

  private interactionMessage(interaction: any, content: string): IncomingMessage {
    return {
      platform: 'discord',
      authorId: interaction.user.id,
      authorName: interaction.user.username,
      channelId: interaction.channelId,
      content,
      replyTo: undefined,
      chatType: interaction.guildId ? 'group' : 'dm',
    } as IncomingMessage;
  }

  private async downloadAttachments(
    attachmentsRaw: any
  ): Promise<{ type: string; url?: string; filename?: string }[]> {
    const attachments: { type: string; url?: string; filename?: string }[] = [];
    if (!attachmentsRaw || attachmentsRaw.size <= 0) return attachments;

    for (const [, att] of attachmentsRaw) {
      try {
        const res = await fetch(att.url);
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          const originalName = att.name || 'attachment.bin';
          const ext = path.extname(originalName) || '.bin';
          const localPath = `/tmp/aurix-discord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
          fs.writeFileSync(localPath, buffer);
          const isImage =
            att.contentType?.startsWith('image/') ||
            originalName.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i);
          attachments.push({
            type: isImage ? 'image' : 'file',
            url: localPath,
            filename: originalName,
          });
        }
      } catch (e: any) {
        console.error(`  Discord attachment download error: ${e.message}`);
      }
    }
    return attachments;
  }
}
