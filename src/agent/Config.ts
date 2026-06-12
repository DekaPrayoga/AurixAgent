import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { normalizeBaseUrl } from '../utils/base-url.js';

export interface AurixConfig {
  provider: 'anthropic' | 'openai' | 'custom';
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  apiStyle?: 'anthropic' | 'openai' | 'auto';
  researchMode?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
  themeName?: 'aurix' | 'opencode' | 'amber' | 'violet' | 'mono' | 'pink' | 'ocean' | 'dark' | 'green' | 'sunset' | 'nebula';
  accentColor?: string;
  langsmith?: {
    apiKey: string;
    project: string;
  };
  integrations?: {
    github?: { enabled: boolean; auth?: 'gh-cli' | 'token'; token?: string };
    gmail?: { enabled: boolean; address?: string; appPassword?: string };
  };
  plugins?: {
    enabled?: boolean;
    sources?: string[];
    allowClaudeStore?: boolean;
  };
  gateway?: {
    discord?: { enabled: boolean; token: string; allowedUsers?: string[] };
    telegram?: { enabled: boolean; token: string; allowedUsers?: string[] };
    whatsapp?: { enabled: boolean; allowedUsers?: string[] };
  };
  browser?: {
    proxies?: string[];
  };
  tools?: {
    enabled?: string[];
    disabled?: string[];
  };
  features?: string[];
}

const CONFIG_DIR = path.join(os.homedir(), '.aurix');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): AurixConfig {
  ensureConfigDir();

  // Try config file first
  if (fs.existsSync(CONFIG_FILE)) {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = yaml.load(raw) as Partial<AurixConfig>;
    return mergeWithEnv(parsed);
  }

  // Fallback to env
  return mergeWithEnv({});
}

function mergeWithEnv(file: Partial<AurixConfig>): AurixConfig {
  const apiStyle = (process.env.AURIX_API_STYLE as AurixConfig['apiStyle']) || file.apiStyle || 'auto';
  const rawBaseUrl = process.env.AURIX_BASE_URL || file.baseUrl;
  const baseUrl = normalizeBaseUrl(rawBaseUrl, apiStyle);

  return {
    provider: (process.env.AURIX_PROVIDER as AurixConfig['provider']) || file.provider || 'openai',
    apiKey: process.env.AURIX_API_KEY || file.apiKey || '',
    baseUrl,
    model: process.env.AURIX_MODEL || file.model || 'gpt-4o',
    maxTokens: file.maxTokens || 4096,
    temperature: file.temperature ?? 0.7,
    systemPrompt: file.systemPrompt,
    apiStyle,
    researchMode: file.researchMode || 'low',
    themeName: file.themeName || 'aurix',
    accentColor: file.accentColor,
    langsmith: file.langsmith,
    integrations: file.integrations,
    plugins: file.plugins,
    gateway: file.gateway,
    browser: file.browser,
    tools: file.tools,
    features: file.features,
  };
}

export function saveConfig(config: AurixConfig): void {
  ensureConfigDir();
  const yamlStr = yaml.dump(config, { indent: 2 });
  fs.writeFileSync(CONFIG_FILE, yamlStr, 'utf-8');
}

export const CONFIG_PATH = CONFIG_DIR;
