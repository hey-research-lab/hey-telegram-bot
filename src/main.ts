import { request } from 'node:http';

import { handleUpdate, type BotDeps } from './bot.js';
import { ConfigError, loadConfig, parsePort, type Mode } from './config.js';
import { createHeyGateway } from './hey/gateway.js';
import { createLogger, makeRedactor, type Logger } from './log.js';
import { runPolling } from './polling.js';
import { createLimiters } from './ratelimit.js';
import { HEALTH_PATH, WEBHOOK_PATH, createWebhookServer } from './server.js';
import { createTelegramClient } from './telegram/client.js';
import { VERSION } from './version.js';

const USAGE = `hey-telegram-bot ${VERSION} — read-only HEY Research lookups in Telegram

Usage: hey-telegram-bot <command>

  webhook                 Serve Telegram's webhook on PORT (default command)
  polling                 Long-poll Telegram instead (local development)
  set-webhook <https-url> Register <https-url> as the webhook, with the secret token
                          and the command menu (the URL should end in ${WEBHOOK_PATH})
  delete-webhook          Remove the webhook (needed before polling)
  healthcheck             Exit 0 when the local server answers ${HEALTH_PATH}

Environment: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, HEY_BASE_URL, PORT, LOG_LEVEL.
See .env.example and docs/SETUP.md.
`;

const out = (text: string) => process.stdout.write(text);

function healthcheck(env: NodeJS.ProcessEnv): Promise<number> {
  let port: number;
  try {
    port = parsePort(env.PORT?.trim() || undefined);
  } catch {
    return Promise.resolve(1);
  }
  return new Promise((resolve) => {
    const req = request(
      { host: '127.0.0.1', port, path: HEALTH_PATH, method: 'GET', timeout: 3000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200 ? 0 : 1);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(1));
    req.end();
  });
}

function validateWebhookUrl(raw: string | undefined): string {
  if (!raw) throw new ConfigError('set-webhook needs the public https URL of the webhook.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError('The webhook URL is not a URL.');
  }
  if (url.protocol !== 'https:') throw new ConfigError('Telegram requires an https webhook URL.');
  if (url.username || url.password || url.hash || raw.length > 500) {
    throw new ConfigError('The webhook URL must not carry credentials or a fragment.');
  }
  return url.toString();
}

async function run(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const command = argv[0] ?? 'webhook';
  if (command === '--help' || command === '-h' || command === 'help') {
    out(USAGE);
    return 0;
  }
  if (command === '--version' || command === '-v') {
    out(`${VERSION}\n`);
    return 0;
  }
  if (command === 'healthcheck') return healthcheck(env);
  if (!['webhook', 'polling', 'set-webhook', 'delete-webhook'].includes(command)) {
    process.stderr.write(`Unknown command: ${command.slice(0, 40)}\n\n${USAGE}`);
    return 2;
  }
  const mode = command as Mode;

  // Until the configuration is read, redact by pattern only.
  let log: Logger = createLogger({ level: 'info', redact: makeRedactor([]) });
  try {
    const config = loadConfig(env, mode);
    log = createLogger({
      level: config.logLevel,
      redact: makeRedactor([config.botToken, config.webhookSecret]),
    });
    const telegram = createTelegramClient({ token: config.botToken });

    if (mode === 'set-webhook') {
      const url = validateWebhookUrl(argv[1]);
      if (!new URL(url).pathname.endsWith(WEBHOOK_PATH)) {
        log.warn('webhook_path_differs', { expected: WEBHOOK_PATH });
      }
      await telegram.setWebhook(url, config.webhookSecret ?? '');
      await telegram.setMyCommands();
      log.info('webhook_set', { host: new URL(url).host });
      return 0;
    }
    if (mode === 'delete-webhook') {
      await telegram.deleteWebhook();
      log.info('webhook_deleted');
      return 0;
    }

    const me = await telegram.getMe();
    const deps: BotDeps = {
      hey: createHeyGateway({ baseUrl: config.heyApiBase }),
      limiters: createLimiters(),
      botUsername: me.username,
      siteBase: config.heyApiBase,
      log,
    };
    const handle = (update: Parameters<typeof handleUpdate>[0]) => handleUpdate(update, deps);
    const controller = new AbortController();

    if (mode === 'polling') {
      const stop = () => controller.abort();
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      log.info('polling_started', { version: VERSION, heyApiBase: config.heyApiBase });
      const result = await runPolling({ telegram, handle, log, signal: controller.signal });
      log.info('polling_ended', { result });
      return result === 'stopped' ? 0 : 1;
    }

    const server = createWebhookServer({ secret: config.webhookSecret ?? '', handle, log });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, '0.0.0.0', () => resolve());
    });
    log.info('webhook_listening', {
      version: VERSION,
      port: config.port,
      path: WEBHOOK_PATH,
      heyApiBase: config.heyApiBase,
    });
    await new Promise<void>((resolve) => {
      const stop = () => {
        log.info('shutting_down');
        server.close(() => resolve());
        server.closeIdleConnections();
        setTimeout(() => resolve(), 10_000).unref();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    return 0;
  } catch (error) {
    if (error instanceof ConfigError) {
      log.error('invalid_config', { message: error.message });
      return 2;
    }
    log.error('fatal', { error });
    return 1;
  }
}

run(process.argv.slice(2), process.env).then(
  (code) => process.exit(code),
  () => process.exit(1),
);
