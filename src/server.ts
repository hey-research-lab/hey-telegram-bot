import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { RecentUpdates } from './bot.js';
import type { Logger } from './log.js';
import {
  MAX_UPDATE_BYTES,
  parseUpdate,
  UpdateParseError,
  type OutgoingMessage,
  type TelegramUpdate,
} from './telegram/update.js';

/**
 * The webhook server: `node:http`, no framework.
 *
 *   POST /telegram/webhook  Telegram's updates. Checked in this order: method,
 *                           secret token header (constant time), content type,
 *                           declared size, then the body is read up to 64 KB,
 *                           parsed without prototype keys and validated.
 *   GET  /healthz           liveness: 200 while the process serves requests.
 *
 * The reply goes back in the webhook response itself (`{"method":"sendMessage",
 * ...}`), so answering a command makes no outbound call to Telegram.
 */

export const WEBHOOK_PATH = '/telegram/webhook';
export const HEALTH_PATH = '/healthz';
export const SECRET_HEADER = 'x-telegram-bot-api-secret-token';
/** Updates handled at once; more answer 503 and Telegram retries them. */
export const MAX_IN_FLIGHT = 32;

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** Constant-time comparison of the header against the configured secret. */
export function secretMatches(header: string | string[] | undefined, secret: string): boolean {
  if (typeof header !== 'string' || header.length === 0 || header.length > 256) return false;
  return timingSafeEqual(digest(header), digest(secret));
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > maxBytes) {
        done = true;
        reject(new BodyTooLarge());
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (done) return;
      done = true;
      reject(error);
    });
  });
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  if (res.headersSent) return;
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': String(Buffer.byteLength(payload)),
    ...headers,
  });
  res.end(payload);
}

const fail = (
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
) => send(res, status, { error: code, message }, headers);

export type WebhookOptions = {
  secret: string;
  handle: (update: TelegramUpdate) => Promise<OutgoingMessage | null>;
  log: Logger;
  maxBytes?: number;
};

export function createWebhookServer(options: WebhookOptions): Server {
  const maxBytes = options.maxBytes ?? MAX_UPDATE_BYTES;
  const recent = new RecentUpdates();
  let inFlight = 0;

  const server = createServer((req, res) => {
    void route(req, res).catch((error: unknown) => {
      options.log.error('request_failed', { error });
      fail(res, 500, 'internal_error', 'The request could not be handled.');
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '/').split('?')[0];

    if (path === HEALTH_PATH) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return fail(res, 405, 'method_not_allowed', 'Use GET.', { allow: 'GET, HEAD' });
      }
      return send(res, 200, { status: 'ok' });
    }

    if (path !== WEBHOOK_PATH) return fail(res, 404, 'not_found', 'Not found.');
    if (req.method !== 'POST') {
      return fail(res, 405, 'method_not_allowed', 'Use POST.', { allow: 'POST' });
    }
    if (!secretMatches(req.headers[SECRET_HEADER], options.secret)) {
      options.log.warn('webhook_rejected', { reason: 'secret_token' });
      return fail(res, 401, 'unauthorized', 'Missing or wrong secret token.', {
        connection: 'close',
      });
    }
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      return fail(res, 415, 'unsupported_media_type', 'Send application/json.');
    }
    const declared = req.headers['content-length'];
    if (declared !== undefined && (!/^\d{1,12}$/.test(declared) || Number(declared) > maxBytes)) {
      options.log.warn('webhook_rejected', { reason: 'body_too_large' });
      return fail(res, 413, 'payload_too_large', `Bodies over ${maxBytes} bytes are refused.`, {
        connection: 'close',
      });
    }
    if (inFlight >= MAX_IN_FLIGHT) {
      return fail(res, 503, 'busy', 'Too many updates in flight.', { 'retry-after': '5' });
    }

    inFlight += 1;
    try {
      let text: string;
      try {
        text = await readBody(req, maxBytes);
      } catch (error) {
        if (error instanceof BodyTooLarge) {
          options.log.warn('webhook_rejected', { reason: 'body_too_large' });
          return fail(res, 413, 'payload_too_large', `Bodies over ${maxBytes} bytes are refused.`, {
            connection: 'close',
          });
        }
        throw error;
      }

      let update: TelegramUpdate;
      try {
        update = parseUpdate(text);
      } catch (error) {
        const code = error instanceof UpdateParseError ? error.code : 'invalid_update';
        options.log.warn('webhook_rejected', { reason: code });
        return fail(res, 400, code, 'The body is not a Telegram update this bot reads.');
      }

      if (!recent.firstTime(update.update_id)) return send(res, 200, undefined);
      const message = await options.handle(update);
      if (!message) return send(res, 200, undefined);
      return send(res, 200, { method: 'sendMessage', ...message });
    } finally {
      inFlight -= 1;
    }
  }

  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  return server;
}
