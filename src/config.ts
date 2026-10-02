import { LOG_LEVELS, type LogLevel } from './log.js';

/**
 * Configuration from the environment, validated once at start-up.
 *
 * Every variable is read here and nowhere else. A value that is set but
 * malformed stops the process with a message that names the variable and
 * never echoes its value.
 */

export const DEFAULT_HEY_BASE_URL = 'https://heyresearch.xyz';
export const DEFAULT_PORT = 8080;

/** Telegram's bot token shape: a numeric bot id, a colon, then the secret part. */
const BOT_TOKEN_RE = /^\d{5,16}:[A-Za-z0-9_-]{30,80}$/;
/** Telegram accepts 1-256 of these for `secret_token`; this bot asks for at least 32. */
const WEBHOOK_SECRET_RE = /^[A-Za-z0-9_-]{32,256}$/;

export type Mode = 'webhook' | 'polling' | 'set-webhook' | 'delete-webhook';

export type Config = {
  botToken: string;
  webhookSecret: string | undefined;
  heyApiBase: string;
  port: number;
  logLevel: LogLevel;
};

export class ConfigError extends Error {
  readonly code = 'invalid_config';
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

const read = (env: Env, name: string): string | undefined => {
  const value = env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** The HEY API origin: https only, no credentials, no path, query or fragment. */
export function parseHeyApiBase(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_HEY_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError('HEY_BASE_URL is not a URL.');
  }
  if (url.protocol !== 'https:') throw new ConfigError('HEY_BASE_URL must use https.');
  if (url.username || url.password) {
    throw new ConfigError('HEY_BASE_URL must not carry credentials.');
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new ConfigError('HEY_BASE_URL must be an origin only, such as https://heyresearch.xyz.');
  }
  return url.origin;
}

export function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  if (!/^\d{1,5}$/.test(raw)) throw new ConfigError('PORT must be a whole number.');
  const port = Number(raw);
  if (port < 1 || port > 65535) throw new ConfigError('PORT must be between 1 and 65535.');
  return port;
}

export function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined) return 'info';
  const level = raw.toLowerCase();
  if ((LOG_LEVELS as readonly string[]).includes(level)) return level as LogLevel;
  throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}.`);
}

/** Reads and validates the configuration a mode needs. */
export function loadConfig(env: Env, mode: Mode): Config {
  const botToken = read(env, 'TELEGRAM_BOT_TOKEN');
  if (!botToken) throw new ConfigError('TELEGRAM_BOT_TOKEN is required.');
  if (!BOT_TOKEN_RE.test(botToken)) {
    throw new ConfigError('TELEGRAM_BOT_TOKEN does not look like a token from @BotFather.');
  }
  const webhookSecret = read(env, 'TELEGRAM_WEBHOOK_SECRET');
  if (mode === 'webhook' || mode === 'set-webhook') {
    if (!webhookSecret) {
      throw new ConfigError(`TELEGRAM_WEBHOOK_SECRET is required in ${mode} mode.`);
    }
  }
  if (webhookSecret !== undefined && !WEBHOOK_SECRET_RE.test(webhookSecret)) {
    throw new ConfigError(
      'TELEGRAM_WEBHOOK_SECRET must be 32-256 characters of A-Z, a-z, 0-9, "_" and "-".',
    );
  }
  return {
    botToken,
    webhookSecret,
    heyApiBase: parseHeyApiBase(read(env, 'HEY_BASE_URL')),
    port: parsePort(read(env, 'PORT')),
    logLevel: parseLogLevel(read(env, 'LOG_LEVEL')),
  };
}
