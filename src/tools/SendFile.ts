import * as fs from 'fs';
import * as path from 'path';
import type { Tool } from './Registry.js';
import type { Gateway } from '../gateway/Gateway.js';

export function createSendFileTool(gateway: Gateway): Tool {
  return {
    name: 'send_file',
    description: 'Send a file to the user via their connected platform (WhatsApp, Telegram, Discord). Use this when the user asks to download, generate, or send files, images, audio, documents, videos, etc. Automatically detects the user\'s platform from the conversation context.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Local path to the file to send',
        },
        caption: {
          type: 'string',
          description: 'Optional text caption to include with the file',
        },
        platform: {
          type: 'string',
          description: 'Target platform (telegram, discord, whatsapp). Auto-detects from last message if omitted.',
        },
      },
      required: ['file_path'],
    },
    async execute(args) {
      const filePath = args.file_path as string;
      const caption = args.caption as string | undefined;
      const targetPlatform = args.platform as string | undefined;

      if (!filePath) return 'Error: file_path is required';
      if (!fs.existsSync(filePath)) return `Error: File not found: ${filePath}`;

      const filename = path.basename(filePath);
      const sizeMB = (fs.statSync(filePath).size / 1048576).toFixed(2);

      if (targetPlatform) {
        const platform = gateway.getPlatform(targetPlatform);
        if (!platform) return `Error: Platform "${targetPlatform}" not connected.`;
        if (!platform.sendFile) return `Error: Platform "${targetPlatform}" does not support file sending.`;

        const allCtx = gateway.getAllContexts();
        const match = allCtx.find(c => c.platform === targetPlatform);
        if (!match) return `Error: No active conversation on ${targetPlatform}.`;

        try {
          await platform.sendFile(filePath, match.channelId, caption, match.replyTo);
          return `Sent ${filename} (${sizeMB}MB) via ${targetPlatform}`;
        } catch (e: any) {
          return `Error sending file via ${targetPlatform}: ${e.message}`;
        }
      }

      const lastCtx = gateway.getMostRecentContext();
      if (!lastCtx) {
        return 'Error: No active conversation context. The user needs to send a message first.';
      }

      const platform = gateway.getPlatform(lastCtx.platform);
      if (!platform?.sendFile) {
        return `Error: Platform "${lastCtx.platform}" does not support file sending.`;
      }

      try {
        await platform.sendFile(filePath, lastCtx.channelId, caption, lastCtx.replyTo);
        return `Sent ${filename} (${sizeMB}MB) via ${lastCtx.platform}`;
      } catch (e: any) {
        return `Error sending file: ${e.message}`;
      }
    },
  };
}
