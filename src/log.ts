/**
 * Structured logs: one JSON object per line, secrets redacted from every
 * string before it is written.
 *
 * The bot token is the one secret that can leak by accident: the Telegram Bot
 * API puts it in the request path (`/bot<token>/sendMessage`), so any error
 * that quotes a URL quotes the token. Every string that reaches a log line —
 * the message, each field, an error's message and stack — goes through
 * `redact`, which removes the configured secrets by value and anything shaped
 * like a bot token by pattern.
 *
 * What is never logged: message text, user ids, usernames, chat titles. A
 * log line says which command ran, in what kind of chat, how it ended and how
 * long it took.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** `bot<digits>:<secret>` as it appears in a Bot API URL, and a bare token. */
const BOT_URL_TOKEN = /bot\d+:[\w-]+/gi;
const BARE_TOKEN = /\b\d{5,16}:[A-Za-z0-9_-]{20,}/g;

export type Redactor = (value: string) => string;

/** A redactor that removes the given secrets by value and any bot-token shape by pattern. */
export function makeRedactor(secrets: readonly (string | undefined)[]): Redactor {
  const literals = secrets
    .filter((s): s is string => typeof s === 'string' && s.length >= 6)
    .sort((a, b) => b.length - a.length);
  return (value: string): string => {
    let out = value;
    for (const literal of literals) out = out.split(literal).join('<redacted>');
    return out.replace(BOT_URL_TOKEN, 'bot<redacted>').replace(BARE_TOKEN, '<redacted>');
  };
}

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export type LogSink = (line: string, level: LogLevel) => void;

const defaultSink: LogSink = (line, level) => {
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
};

const MAX_DEPTH = 4;
const MAX_STRING = 2000;

/** A JSON-safe, redacted copy of a field value. Errors keep name, code, message and a short stack. */
export function sanitizeField(value: unknown, redact: Redactor, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return redact(value).slice(0, MAX_STRING);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    return {
      name: value.name,
      ...(typeof code === 'string' ? { code } : {}),
      message: redact(value.message).slice(0, MAX_STRING),
      ...(value.stack ? { stack: redact(value.stack).split('\n').slice(0, 6).join('\n') } : {}),
    };
  }
  if (depth >= MAX_DEPTH) return '[depth]';
  if (Array.isArray(value))
    return value.slice(0, 20).map((v) => sanitizeField(v, redact, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[redact(k)] = sanitizeField(v, redact, depth + 1);
    }
    return out;
  }
  return redact(String(value));
}

export function createLogger(options: {
  level: LogLevel;
  redact: Redactor;
  sink?: LogSink;
  now?: () => Date;
}): Logger {
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());
  const threshold = ORDER[options.level];
  const write = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (ORDER[level] < threshold) return;
    const record: Record<string, unknown> = {
      time: now().toISOString(),
      level,
      msg: options.redact(msg),
    };
    if (fields) {
      for (const [k, v] of Object.entries(fields)) {
        if (k === 'time' || k === 'level' || k === 'msg') continue;
        record[k] = sanitizeField(v, options.redact);
      }
    }
    sink(JSON.stringify(record), level);
  };
  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}

/** A logger that writes nothing (tests). */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
