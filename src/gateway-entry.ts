import { loadConfig } from './agent/Config.js';
import { Gateway } from './gateway/Gateway.js';
import type { ToolRegistry } from './tools/Registry.js';

export async function startGateway(registry: ToolRegistry) {
  const config = loadConfig();

  if (!config.apiKey) {
    console.error('Error: No API key configured. Run: aurix setup');
    process.exit(1);
  }

  const gateway = new Gateway(config, registry);

  const gw = config.gateway;

  if (gw?.discord?.enabled && gw.discord.token) {
    const { DiscordPlatform } = await import('./gateway/Discord.js');
    gateway.register(new DiscordPlatform(gw.discord.token));
  }

  if (gw?.telegram?.enabled && gw.telegram.token) {
    const { TelegramPlatform } = await import('./gateway/Telegram.js');
    gateway.register(new TelegramPlatform(gw.telegram.token));
  }

  if (gw?.whatsapp?.enabled) {
    const { WhatsAppPlatform } = await import('./gateway/WhatsApp.js');
    gateway.register(new WhatsAppPlatform());
  }

  if (gateway.getPlatforms().length === 0) {
    console.error(`
  No gateway platforms configured.

  Edit ~/.aurix/config.yaml:

  gateway:
    discord:
      enabled: true
      token: YOUR_DISCORD_BOT_TOKEN
    telegram:
      enabled: true
      token: YOUR_TELEGRAM_BOT_TOKEN
    whatsapp:
      enabled: true
`);
    process.exit(1);
  }

  process.on('SIGINT', async () => {
    console.log('\nShutting down gateway...');
    await gateway.stop();
    process.exit(0);
  });

  await gateway.start();
}
