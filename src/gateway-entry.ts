import { loadConfig } from './agent/Config.js';
import { Gateway } from './gateway/Gateway.js';
import { ToolRegistry } from './tools/Registry.js';

const GATEWAY_TOOL_ALLOWLIST = new Set([
  'ask_user',
  'terminal',
  'read_file',
  'write_file',
  'search_files',
  'file_edit',
  'delete_file',
  'delete_folder',
  'recovery_file',
  'recovery_folder',
  'browser',
  'web_search',
  'research',
  'research_forums',
  'china_ai_research',
  'pdf',
  'generate_excel',
  'generate_pptx',
  'read_archive',
  'audio_captcha',
  'audio_captcha_local',
  'captcha_api_solving',
  'temp_mailing',
  'todo',
  'memory',
  'brain',
  'send_file',
  'image_generator',
]);

function createGatewayRegistry(parent: ToolRegistry): ToolRegistry {
  const gatewayRegistry = new ToolRegistry();
  for (const tool of parent.list()) {
    if (GATEWAY_TOOL_ALLOWLIST.has(tool.name)) gatewayRegistry.register(tool);
  }
  gatewayRegistry.setPermissionMode(parent.getPermissionMode());
  const handler = parent.getPermissionHandler?.();
  if (handler) gatewayRegistry.setPermissionHandler(handler);
  return gatewayRegistry;
}

export async function startGateway(registry: ToolRegistry) {
  const config = loadConfig();

  if (!config.apiKey) {
    console.error('Error: No API key configured. Run: aurix setup');
    process.exit(1);
  }

  const gatewayRegistry = createGatewayRegistry(registry);
  const gateway = new Gateway(config, gatewayRegistry);

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

  const { createSendFileTool } = await import('./tools/SendFile.js');
  gatewayRegistry.register(createSendFileTool(gateway));
  const { createImageGeneratorTool } = await import('./tools/ImageGenerator.js');
  gatewayRegistry.register(createImageGeneratorTool(config, gateway));

  process.on('SIGINT', async () => {
    console.log('\nShutting down gateway...');
    await gateway.stop();
    process.exit(0);
  });

  await gateway.start();
}
