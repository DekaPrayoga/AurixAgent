import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import {
  drawInputScreen,
  drawSelector,
  drawBox,
  drawSuccess,
  drawInfo,
  drawWarning,
} from '../cli/SetupUI.js';
import type { AurixConfig } from './Config.js';
import { loadConfig, saveConfig, ensureConfigDir, CONFIG_PATH } from './Config.js';
import { banner } from '../utils/ascii-logo.js';
import { normalizeBaseUrl } from '../utils/base-url.js';

const teal = chalk.hex('#fab283');
const dim = chalk.hex('#808080');
const orange = chalk.hex('#9d7cd8');
const bright = chalk.hex('#eeeeee');

const CONFIG_FILE = path.join(CONFIG_PATH, 'config.yaml');
const SETUP_STATE = path.join(CONFIG_PATH, '.setup-state.json');

function setupProviderFromConfig(config: AurixConfig): string | undefined {
  if (config.provider === 'custom-anthropic') return 'custom-anthropic';
  if (config.provider === 'custom') {
    if (config.apiStyle === 'openai') return 'custom-openai';
    if (config.apiStyle === 'anthropic') return 'custom-anthropic';
    return 'custom-auto';
  }
  return config.provider;
}

export async function runSetup(continueFrom?: boolean): Promise<AurixConfig> {
  console.clear();
  console.log(banner('setup', 'wizard'));

  const existingConfig = loadConfig();
  const existingSetupProvider = setupProviderFromConfig(existingConfig);
  const state = continueFrom ? loadSetupState() : {};

  drawInfo('Configure your AI agent step by step.');
  drawInfo('You can skip any step and run ' + teal('aurix setup --continue') + ' later.\n');

  // Step 0: Terminal theme
  const themeChoice = state.themeChoice?.name
    ? state.themeChoice
    : await stepTheme(existingConfig.themeName, existingConfig.accentColor);

  // Step 1: Provider
  const provider = state.provider || (await stepProvider(existingSetupProvider));
  if (provider === '__skip__' || provider === '__back__') {
    saveSetupState({ step: 'provider' });
    return await loadConfigOrDefault();
  }
  const providerChanged = Boolean(existingSetupProvider && provider !== existingSetupProvider);

  // Step 2: Base URL (custom providers)
  let baseUrl: string | undefined =
    state.baseUrl || (providerChanged ? undefined : existingConfig.baseUrl);
  const isCustom =
    provider === 'custom-openai' || provider === 'custom-anthropic' || provider === 'custom-auto';
  if (isCustom && !baseUrl) {
    baseUrl = await stepBaseUrl(provider);
    if (baseUrl === '__skip__' || baseUrl === '__back__') {
      saveSetupState({ step: 'baseUrl', provider });
      return await loadConfigOrDefault();
    }
  }

  // Step 3: API Key — always offer for custom providers and provider changes
  let apiKey = state.apiKey || (providerChanged ? '' : existingConfig.apiKey);
  if (!apiKey || isCustom || providerChanged) {
    const existingHint = apiKey
      ? `\nCurrent key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}\nLeave blank to keep existing key.`
      : '';
    const key = await stepApiKey(provider, existingHint);
    if (key === '__skip__' || key === '__back__') {
      if (apiKey) {
        drawInfo('Keeping existing API key.\n');
      } else {
        saveSetupState({ step: 'apiKey', provider, baseUrl });
        return await loadConfigOrDefault();
      }
    } else if (key) {
      apiKey = key;
    }
  }

  // Step 4: Model
  const model = state.model || (await stepModel(provider, existingConfig.model));
  if (model === '__skip__' || model === '__back__') {
    saveSetupState({ step: 'model', provider, baseUrl, apiKey });
    return await loadConfigOrDefault();
  }

  // Step 5: Gateway — always offer to set/update tokens
  const gateway = await stepGateway(state.gateway || existingConfig.gateway);

  // Step 7: Features
  const features = await stepFeatures(existingConfig.features);

  // Step 8: Account integrations
  const integrations = await stepIntegrations(existingConfig.integrations);

  // Step 9: Plugin/skill loading
  const plugins = await stepPlugins(existingConfig.plugins);

  // Step 10: Captcha solving method
  const captchaAudio = await stepCaptcha(existingConfig.captchaAudio, existingConfig.groqApiKey);

  // Step 11: Web search engine
  const searchEngine = await stepSearchEngine(
    existingConfig.searchEngine,
    existingConfig.searchApiKey,
    existingConfig.searchBaseUrl
  );

  const resolvedProvider =
    provider === 'custom-openai' || provider === 'custom-anthropic' || provider === 'custom-auto'
      ? 'custom'
      : provider;

  const resolvedApiStyle: AurixConfig['apiStyle'] =
    provider === 'custom-openai'
      ? 'openai'
      : provider === 'custom-anthropic'
        ? 'anthropic'
        : provider === 'custom-auto'
          ? 'auto'
          : undefined;

  const finalBaseUrl = isCustom ? baseUrl : providerChanged ? undefined : baseUrl;

  const config: AurixConfig = {
    ...existingConfig,
    provider: resolvedProvider as AurixConfig['provider'],
    apiKey,
    baseUrl: finalBaseUrl,
    model,
    maxTokens: existingConfig.maxTokens || 4096,
    temperature: existingConfig.temperature ?? 0.7,
    apiStyle: resolvedApiStyle,
    researchMode: existingConfig.researchMode || 'low',
    themeName: themeChoice.name,
    accentColor: themeChoice.accent,
    gateway: gateway as AurixConfig['gateway'],
    integrations,
    plugins,
    features: (Array.isArray(features) ? features : existingConfig.features || []) as string[],
    captchaAudio: captchaAudio.mode,
    useGroqAudio: captchaAudio.useGroqAudio,
    groqApiKey: captchaAudio.groqApiKey,
    searchEngine: searchEngine.engine,
    searchApiKey: searchEngine.apiKey || '',
    searchBaseUrl: searchEngine.baseUrl,
  };

  ensureConfigDir();
  saveConfig(config);
  clearSetupState();

  console.log();
  drawSuccess('Configuration saved to ~/.aurix/config.yaml');

  drawInfo('Starting AURIX Agent...\n');

  return config;
}

async function stepTheme(
  existingName?: AurixConfig['themeName'],
  existingAccent?: string
): Promise<{
  name: NonNullable<AurixConfig['themeName']>;
  accent: string;
}> {
  const choice = await drawSelector({
    title: 'Terminal UI Theme',
    items: [
      { id: 'aurix', label: 'AURIX Teal + Orange', desc: 'Matches the logo' },
      { id: 'opencode', label: 'OpenCode Blue', desc: 'Cool blue terminal accent' },
      { id: 'amber', label: 'Amber Ops', desc: 'Warm command-center style' },
      { id: 'violet', label: 'Violet AI', desc: 'Purple accent, still dark' },
      { id: 'mono', label: 'Mono', desc: 'Minimal grayscale' },
      { id: 'pink', label: 'Pink Dream', desc: 'Hot pink with rose accents' },
      { id: 'ocean', label: 'Ocean Blue', desc: 'Deep sea cyan + blue' },
      { id: 'dark', label: 'Dark Mode', desc: 'Ultra minimal dark gray' },
      { id: 'green', label: 'Matrix Green', desc: 'Hacker terminal green' },
      { id: 'sunset', label: 'Sunset Gradient', desc: 'Orange to pink warm gradient' },
      { id: 'nebula', label: 'Nebula', desc: 'Purple + pink cosmic gradient' },
    ],
    allowSkip: true,
    extra: existingName
      ? [`Current theme: ${existingName}`, 'Skip keeps current theme.']
      : undefined,
  });

  if ((choice === '__skip__' || choice === '__back__') && existingName) {
    return { name: existingName, accent: existingAccent || '#fab283' };
  }

  const palette: Record<string, { name: NonNullable<AurixConfig['themeName']>; accent: string }> = {
    aurix: { name: 'aurix', accent: '#fab283' },
    opencode: { name: 'opencode', accent: '#fab283' },
    amber: { name: 'amber', accent: '#FFB020' },
    violet: { name: 'violet', accent: '#9d7cd8' },
    mono: { name: 'mono', accent: '#eeeeee' },
    pink: { name: 'pink', accent: '#ff6b9d' },
    ocean: { name: 'ocean', accent: '#64ffda' },
    dark: { name: 'dark', accent: '#c0c0c0' },
    green: { name: 'green', accent: '#00ff41' },
    sunset: { name: 'sunset', accent: '#ff6b35' },
    nebula: { name: 'nebula', accent: '#bd93f9' },
  };

  return palette[choice] || palette.aurix;
}

async function stepProvider(existing?: string): Promise<string> {
  const choice = await drawSelector({
    title: 'LLM Provider',
    items: [
      {
        id: 'openai',
        label: 'OpenAI',
        desc: existing === 'openai' ? 'Current provider' : 'GPT-4o, GPT-4, o1, etc.',
      },
      {
        id: 'anthropic',
        label: 'Anthropic',
        desc: existing === 'anthropic' ? 'Current provider' : 'Claude 4, Claude 3.5, etc.',
      },
      {
        id: 'custom-openai',
        label: 'Custom (OpenAI-compatible)',
        desc: existing === 'custom-openai' ? 'Current provider' : 'Ollama, LM Studio, vLLM',
      },
      {
        id: 'custom-anthropic',
        label: 'Custom (Anthropic-compatible)',
        desc: existing === 'custom-anthropic' ? 'Current provider' : 'Any /v1/messages API',
      },
      {
        id: 'custom-auto',
        label: 'Custom (auto-detect)',
        desc: existing === 'custom-auto' ? 'Current provider' : 'Auto-detect endpoint style',
      },
    ],
    allowSkip: true,
    extra: existing
      ? [`Current provider: ${existing}`, 'Skip keeps the current provider and key.']
      : undefined,
  });
  if ((choice === '__skip__' || choice === '__back__') && existing) return existing;
  return choice;
}

async function stepApiKey(provider: string, existingHint?: string): Promise<string> {
  const providerNames: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    'custom-openai': 'Custom (OpenAI)',
    'custom-anthropic': 'Custom (Anthropic)',
    'custom-auto': 'Custom (auto-detect)',
  };
  const providerName = providerNames[provider] || provider;

  const hintLines = [
    `You can get an API key at:`,
    provider === 'openai'
      ? '  https://platform.openai.com/api-keys'
      : provider === 'anthropic'
        ? '  https://console.anthropic.com/settings/keys'
        : "  Your provider's dashboard",
    '',
    'Your key is stored locally in ~/.aurix/config.yaml',
  ];
  if (existingHint) hintLines.push(existingHint);

  const key = await drawInputScreen({
    title: `API Key — ${providerName}`,
    hint: `Paste your ${providerName} API key below`,
    label: 'API Key:',
    masked: true,
    extra: hintLines,
  });

  if (!key || key === '__back__') return '__skip__';
  return key;
}

async function stepBaseUrl(provider: string): Promise<string | undefined> {
  const apiStyle: AurixConfig['apiStyle'] =
    provider === 'custom-openai'
      ? 'openai'
      : provider === 'custom-anthropic'
        ? 'anthropic'
        : 'auto';

  const choice = await drawSelector({
    title: 'Base URL',
    items: [
      {
        id: 'https://api.openai.com/v1',
        label: 'OpenAI /v1',
        desc: 'Official OpenAI-compatible endpoint',
      },
      { id: 'http://localhost:11434/v1', label: 'Ollama', desc: 'localhost:11434' },
      { id: 'http://localhost:1234/v1', label: 'LM Studio', desc: 'localhost:1234' },
      { id: 'http://localhost:8080/v1', label: 'vLLM', desc: 'localhost:8080' },
      { id: 'custom', label: 'Custom URL', desc: 'Enter your own endpoint' },
    ],
    allowSkip: true,
  });

  if (choice === '__skip__' || choice === '__back__') return '__skip__';

  if (choice === 'custom') {
    while (true) {
      const url = await drawInputScreen({
        title: 'Custom Base URL',
        hint: 'Examples: https://api.openai.com/v1, localhost:1234/v1, https://your-gateway/openai/v1',
        label: 'Base URL:',
        masked: false,
      });

      if (!url || url === '__back__') return '__skip__';

      try {
        return normalizeBaseUrl(url, apiStyle);
      } catch (e: any) {
        drawWarning(e.message);
        drawInfo('URL boleh pakai /v1. Kalau lupa http/https, AURIX akan tambahkan otomatis.\n');
      }
    }
  }

  return normalizeBaseUrl(choice, apiStyle);
}

async function stepModel(provider: string, existingModel?: string): Promise<string> {
  const models: Record<string, { id: string; label: string; desc?: string }[]> = {
    openai: [
      { id: 'gpt-4o', label: 'GPT-4o', desc: 'Best balance of speed and capability' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini', desc: 'Fast and cheap' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', desc: 'Most capable, slower' },
      { id: 'o1-preview', label: 'o1 Preview', desc: 'Advanced reasoning' },
      { id: 'custom', label: 'Custom model', desc: 'Type your own model ID' },
    ],
    anthropic: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', desc: 'Best balance' },
      { id: 'claude-opus-4-20250514', label: 'Claude Opus 4', desc: 'Most capable' },
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', desc: 'Fast and efficient' },
      { id: 'custom', label: 'Custom model', desc: 'Type your own model ID' },
    ],
    'custom-openai': [
      { id: 'llama3', label: 'Llama 3', desc: 'Meta open-source' },
      { id: 'mistral', label: 'Mistral', desc: 'Mistral AI' },
      { id: 'custom', label: 'Custom model', desc: 'Type your own model ID' },
    ],
    'custom-anthropic': [{ id: 'custom', label: 'Custom model', desc: 'Type your own model ID' }],
    'custom-auto': [{ id: 'custom', label: 'Custom model', desc: 'Type your own model ID' }],
  };

  const items = models[provider] || models['custom-auto']!;
  const choice = await drawSelector({
    title: 'Model',
    items,
    allowSkip: true,
    extra: existingModel
      ? [`Current model: ${existingModel}`, 'Skip keeps the current model.']
      : undefined,
  });

  if (choice === '__skip__' || choice === '__back__') {
    return existingModel || (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o');
  }

  if (choice === 'custom') {
    const model = await drawInputScreen({
      title: 'Custom Model',
      hint: existingModel
        ? `Enter the exact model ID your provider supports\nCurrent: ${existingModel}`
        : 'Enter the exact model ID your provider supports',
      label: 'Model ID:',
      masked: false,
    });
    return !model || model === '__back__' ? existingModel || 'gpt-4o' : model;
  }

  return choice;
}

async function stepGateway(existing?: AurixConfig['gateway']): Promise<AurixConfig['gateway']> {
  const existingList: string[] = [];
  if (existing?.discord?.token)
    existingList.push(
      `Discord (${existing.discord.token.slice(0, 8)}...${existing.discord.token.slice(-4)})`
    );
  if (existing?.telegram?.token)
    existingList.push(
      `Telegram (${existing.telegram.token.slice(0, 8)}...${existing.telegram.token.slice(-4)})`
    );
  if (existing?.whatsapp?.enabled) existingList.push('WhatsApp (QR paired)');

  const extra =
    existingList.length > 0
      ? [
          '',
          'Current tokens:',
          ...existingList.map((t) => `  • ${t}`),
          '',
          'Select to update or add new tokens.',
        ]
      : undefined;

  const selected = await drawSelector({
    title: 'Messaging Gateway (Optional)',
    items: [
      {
        id: 'discord',
        label: 'Discord Bot',
        desc: existing?.discord?.token ? 'Update token' : 'Connect to Discord servers',
      },
      {
        id: 'telegram',
        label: 'Telegram Bot',
        desc: existing?.telegram?.token ? 'Update token' : 'Connect via Bot API',
      },
      {
        id: 'whatsapp',
        label: 'WhatsApp',
        desc: existing?.whatsapp?.enabled ? 'Update settings' : 'Connect via Baileys (QR code)',
      },
    ],
    allowSkip: true,
    extra,
  });

  if (!selected || selected === '__skip__' || selected === '__back__') {
    drawInfo(existing ? 'Keeping existing gateway tokens.\n' : 'No platforms selected.\n');
    return existing || undefined;
  }

  const platforms = Array.isArray(selected) ? selected : [selected];
  const gateway: AurixConfig['gateway'] = existing ? { ...existing } : {};

  for (const platform of platforms) {
    if (platform === 'discord') {
      const token = await drawInputScreen({
        title: 'Discord Bot Token',
        hint: 'Get from discord.com/developers/applications',
        label: 'Token:',
        masked: true,
      });
      if (token && token !== '__back__') {
        gateway.discord = { enabled: true, token };
        const userIds = await drawInputScreen({
          title: 'Discord — Allowed User IDs (Optional)',
          hint: 'Comma-separated Discord user IDs. Only these users can control the bot.\nLeave blank to allow everyone (not recommended for VPS bots).\nFind your ID: right-click your name → Copy User ID (enable Developer Mode in settings).',
          label: 'User IDs:',
          masked: false,
        });
        if (userIds && userIds !== '__back__') {
          gateway.discord!.allowedUsers = userIds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        }
      }
    }
    if (platform === 'telegram') {
      const token = await drawInputScreen({
        title: 'Telegram Bot Token',
        hint: 'Get from @BotFather on Telegram',
        label: 'Token:',
        masked: true,
      });
      if (token && token !== '__back__') {
        gateway.telegram = { enabled: true, token };
        const userIds = await drawInputScreen({
          title: 'Telegram — Allowed User IDs (Optional)',
          hint: 'Comma-separated Telegram user IDs. Only these users can control the bot.\nLeave blank to allow everyone.\nFind your ID: message @userinfobot or @getmyid_bot.',
          label: 'User IDs:',
          masked: false,
        });
        if (userIds && userIds !== '__back__') {
          gateway.telegram!.allowedUsers = userIds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        }
      }
    }
    if (platform === 'whatsapp') {
      gateway.whatsapp = { enabled: true };
      drawInfo('WhatsApp will pair via QR code on first run');
      const phoneIds = await drawInputScreen({
        title: 'WhatsApp — Allowed Phone Numbers (Optional)',
        hint: 'Comma-separated phone numbers with country code (e.g. +6281234567890).\nOnly these numbers can control the bot. Leave blank to allow everyone.',
        label: 'Phone numbers:',
        masked: false,
      });
      if (phoneIds && phoneIds !== '__back__') {
        gateway.whatsapp.allowedUsers = phoneIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
  }

  return gateway;
}

async function stepFeatures(existing?: string[]): Promise<string[]> {
  const selected = await drawSelector({
    title: 'Extra Features',
    items: [
      { id: 'trading', label: 'Trading Agents', desc: 'Stock/crypto analysis' },
      { id: 'cybersec', label: 'Cybersecurity', desc: 'Red/blue/purple team' },
      { id: 'vps', label: 'VPS Management', desc: 'Server monitoring' },
      { id: 'research', label: 'Deep Research', desc: 'Multi-source + citations' },
      { id: 'office', label: 'Office Tools', desc: 'PDF, email, presentations' },
      { id: 'planning', label: 'Project Planning', desc: 'Sprint planning' },
      { id: 'frontend', label: 'Frontend Dev', desc: 'React, Next.js, Vue, Svelte' },
      { id: 'backend', label: 'Backend Dev', desc: 'Express, Fastify, Hono' },
      { id: 'deploy', label: 'Deployment', desc: 'Vercel, GitHub Pages, CI/CD' },
      { id: 'cloud', label: 'Cloud (GCloud/AWS)', desc: 'Deploy & manage cloud' },
      { id: 'github', label: 'GitHub', desc: 'PRs, issues, actions' },
      { id: 'creative', label: 'Creative', desc: 'GIF search, humanizer' },
    ],
    allowSkip: true,
    multi: true,
    extra: existing?.length
      ? [`Current features: ${existing.join(', ')}`, 'Skip keeps current features.']
      : undefined,
  });

  if (!Array.isArray(selected) || selected.length === 0) return existing || [];
  return selected;
}

async function stepIntegrations(
  existing?: AurixConfig['integrations']
): Promise<AurixConfig['integrations']> {
  const selected = await drawSelector({
    title: 'Connect Accounts (Optional)',
    items: [
      { id: 'github', label: 'GitHub', desc: 'Use gh CLI for PRs, issues, repo inspection' },
      { id: 'gmail', label: 'Gmail / Email', desc: 'Use himalaya or msmtp for mail tools' },
    ],
    allowSkip: true,
    multi: true,
    extra: existing
      ? [
          `Current integrations: ${Object.keys(existing).join(', ') || 'none'}`,
          'Skip keeps current integrations.',
        ]
      : undefined,
  });

  if (!Array.isArray(selected) || selected.length === 0) {
    drawInfo(
      existing ? 'Keeping existing account integrations.\n' : 'No account integrations selected.\n'
    );
    return existing;
  }

  const integrations: AurixConfig['integrations'] = existing ? { ...existing } : {};

  if (selected.includes('github')) {
    const method = await drawSelector({
      title: 'GitHub Auth',
      items: [
        { id: 'gh-cli', label: 'Use gh CLI', desc: 'Recommended: run gh auth login once' },
        { id: 'token', label: 'Store token', desc: 'Save a GitHub token in ~/.aurix/config.yaml' },
      ],
      allowSkip: true,
    });

    if (method === 'token') {
      const token = await drawInputScreen({
        title: 'GitHub Token',
        hint: 'Paste a token with repo scope if you want AURIX to use GitHub tools directly',
        label: 'Token:',
        masked: true,
      });
      if (token && token !== '__back__')
        integrations.github = { enabled: true, auth: 'token', token };
    } else if (method === 'gh-cli') {
      integrations.github = { enabled: true, auth: 'gh-cli' };
      drawInfo('GitHub will use gh CLI. Run gh auth login if not logged in yet.\n');
    }
  }

  if (selected.includes('gmail')) {
    const address = await drawInputScreen({
      title: 'Gmail Address',
      hint: 'Optional. AURIX email tool uses himalaya or msmtp under the hood.',
      label: 'Email:',
      masked: false,
    });
    const appPassword = await drawInputScreen({
      title: 'Gmail App Password (Optional)',
      hint: 'Leave blank if you already configured himalaya/msmtp.',
      label: 'App Password:',
      masked: true,
    });
    integrations.gmail = {
      enabled: true,
      address: address && address !== '__back__' ? address : undefined,
      appPassword: appPassword && appPassword !== '__back__' ? appPassword : undefined,
    };
  }

  return integrations;
}

async function stepPlugins(existing?: AurixConfig['plugins']): Promise<AurixConfig['plugins']> {
  const selected = await drawSelector({
    title: 'Plugins and Skills',
    items: [
      { id: 'local', label: 'Enable local plugins', desc: '~/.aurix/plugins and in-repo skills' },
      {
        id: 'claude-store',
        label: 'Allow Claude-style store sources',
        desc: 'Register git/path sources for later sync',
      },
      { id: 'create', label: 'Create plugin scaffold later', desc: 'Use /plugin create <name>' },
    ],
    allowSkip: true,
    multi: true,
    extra: existing
      ? ['Current plugin settings detected.', 'Skip keeps current plugin settings.']
      : undefined,
  });

  if (!Array.isArray(selected) || selected.length === 0) {
    return existing || { enabled: true, sources: [], allowClaudeStore: false };
  }

  const sources: string[] = existing?.sources ? [...existing.sources] : [];
  if (selected.includes('claude-store')) {
    const source = await drawInputScreen({
      title: 'Plugin Store Source (Optional)',
      hint: 'Enter a git URL/path now, or leave blank and use /plugin install later.',
      label: 'Source:',
      masked: false,
    });
    if (source && source !== '__back__') sources.push(source);
  }

  return {
    enabled:
      selected.includes('local') ||
      selected.includes('claude-store') ||
      selected.includes('create'),
    sources,
    allowClaudeStore: selected.includes('claude-store'),
  };
}

async function stepCaptcha(
  existingMode?: AurixConfig['captchaAudio'],
  existingGroqApiKey?: string
): Promise<{ mode: AurixConfig['captchaAudio']; groqApiKey?: string; useGroqAudio?: boolean }> {
  const selected = await drawSelector({
    title: 'CAPTCHA Solving Method',
    items: [
      {
        id: 'hybrid',
        label: 'Hybrid (Recommended)',
        desc: 'Image first, audio fallback (best success rate)',
      },
      { id: 'image', label: 'Image Clicking', desc: 'AI vision analyzes grid tiles' },
      { id: 'audio', label: 'Audio Captcha', desc: 'Whisper STT transcribes audio challenge' },
    ],
    allowSkip: true,
    extra: existingMode
      ? [`Current CAPTCHA mode: ${existingMode}`, 'Skip keeps current CAPTCHA settings.']
      : undefined,
  });

  if (!selected || selected === '__skip__' || selected === '__back__') {
    if (existingMode) {
      drawInfo('Keeping existing CAPTCHA settings.\n');
      return { mode: existingMode, groqApiKey: existingGroqApiKey };
    }
    drawInfo('Defaulting to hybrid captcha mode.\n');
    return { mode: 'hybrid' };
  }

  const mode = selected as AurixConfig['captchaAudio'];

  // If audio or hybrid, ask for Groq API key or local whisper
  if (mode === 'audio' || mode === 'hybrid') {
    const audioMethod = await drawSelector({
      title: 'Audio Transcription Method',
      items: [
        { id: 'groq', label: 'Groq API (Recommended)', desc: 'Free 2000 req/day, fast & accurate' },
        {
          id: 'local',
          label: 'Local Whisper',
          desc: 'Use existing local whisper CLI, no API key needed',
        },
      ],
      allowSkip: true,
    });

    if (audioMethod === 'groq') {
      drawInfo('Get your free API key at: https://console.groq.com/docs/speech-to-text');
      const groqKey = await drawInputScreen({
        title: 'Groq API Key',
        hint: 'Paste your Groq API key (gsk_...). Get free at console.groq.com\nYou Can Change This At ~/.aurix/config.yaml',
        label: 'API Key:',
        masked: true,
      });
      if (groqKey && groqKey !== '__back__') {
        return { mode, useGroqAudio: true, groqApiKey: groqKey };
      }
    }

    if (audioMethod === 'local') {
      drawInfo(
        'Local Whisper mode will use the existing `whisper` CLI only. It will not install packages automatically.'
      );
      return { mode, useGroqAudio: false, groqApiKey: existingGroqApiKey };
    }
  }

  return { mode, groqApiKey: existingGroqApiKey };
}

// ─── Search Engine Step ─────────────────────────────────────────────────────

async function stepSearchEngine(
  existingEngine?: AurixConfig['searchEngine'],
  existingApiKey?: string,
  existingBaseUrl?: string
): Promise<{
  engine: AurixConfig['searchEngine'];
  apiKey?: string;
  baseUrl?: string;
}> {
  const selected = await drawSelector({
    title: 'Web Search Engine',
    items: [
      {
        id: 'ddg',
        label: 'DuckDuckGo (Default)',
        desc: 'Free, no API key — instant answers + web results',
      },
      {
        id: 'searxng',
        label: 'SearXNG',
        desc: 'Free metasearch; use public fallback or your own instance',
      },
      {
        id: 'serper',
        label: 'Serper.dev (Google)',
        desc: 'Real Google results, 2500 free/month\nGet key: https://serper.dev',
      },
      {
        id: 'tavily',
        label: 'Tavily (AI-Optimized)',
        desc: 'Built for AI agents, clean results, 1000 free/month\nGet key: https://tavily.com',
      },
    ],
    allowSkip: true,
    extra: existingEngine
      ? [`Current search engine: ${existingEngine}`, 'Skip keeps current search settings.']
      : undefined,
  });

  if (!selected || selected === '__skip__' || selected === '__back__') {
    if (existingEngine) {
      drawInfo('Keeping existing search settings.\n');
      return { engine: existingEngine, apiKey: existingApiKey, baseUrl: existingBaseUrl };
    }
    drawInfo('Defaulting to DuckDuckGo (free, no API key).\n');
    return { engine: 'ddg' };
  }

  if (selected === 'ddg') {
    drawInfo('DuckDuckGo is free and needs no API key.\n');
    return { engine: 'ddg' };
  }

  if (selected === 'searxng') {
    const instance = await drawInputScreen({
      title: 'SearXNG Instance (Optional)',
      hint: 'Leave blank to use built-in public fallbacks.\nExample: https://search.example.com or http://localhost:8080',
      label: 'Base URL:',
      masked: false,
    });
    if (instance && instance !== '__back__') {
      return { engine: 'searxng', baseUrl: instance.replace(/\/+$/, '') };
    }
    return {
      engine: 'searxng',
      baseUrl: existingEngine === 'searxng' ? existingBaseUrl : undefined,
    };
  }

  const name = selected === 'serper' ? 'Serper.dev' : 'Tavily';
  const url = selected === 'serper' ? 'https://serper.dev' : 'https://tavily.com';
  drawInfo('Get your free API key at: ' + url);
  const apiKey = await drawInputScreen({
    title: name + ' API Key',
    hint:
      'Paste your ' +
      name +
      ' API key.\nGet it free at: ' +
      url +
      '\nLeave blank to use DDG instead.',
    label: 'API Key:',
    masked: true,
  });

  if (apiKey && apiKey !== '__back__') {
    return { engine: selected as AurixConfig['searchEngine'], apiKey };
  }

  if (existingEngine === selected && existingApiKey) {
    drawInfo('No new key provided. Keeping existing search API key.\n');
    return { engine: existingEngine, apiKey: existingApiKey, baseUrl: existingBaseUrl };
  }

  drawInfo('No key provided. Defaulting to DDG.\n');
  return { engine: 'ddg' };
}

function loadSetupState(): Record<string, any> {
  try {
    if (fs.existsSync(SETUP_STATE)) {
      return JSON.parse(fs.readFileSync(SETUP_STATE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveSetupState(state: Record<string, any>): void {
  ensureConfigDir();
  fs.writeFileSync(SETUP_STATE, JSON.stringify(state, null, 2));
  drawInfo(`Setup paused at: ${state.step}. Run \`aurix setup --continue\` to resume.`);
}

function clearSetupState(): void {
  try {
    fs.unlinkSync(SETUP_STATE);
  } catch {}
}

async function loadConfigOrDefault(): Promise<AurixConfig> {
  if (fs.existsSync(CONFIG_FILE)) {
    const yaml = (await import('js-yaml')).default;
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return yaml.load(raw) as AurixConfig;
  }
  return {
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o',
  };
}
