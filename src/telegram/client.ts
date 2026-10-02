import { z } from 'zod';

import {
  parseJsonStrict,
  updateSchema,
  type OutgoingMessage,
  type TelegramUpdate,
} from './update.js';

/**
 * A minimal Telegram Bot API client: the six methods the bot uses.
 *
 * The token lives in the request path (`/bot<token>/<method>`), so a request
 * URL is never put into an error or a log line. Errors carry the method name,
 * Telegram's numeric code and description, and `retry_after` when Telegram
 * sends one.
 */

export const TELEGRAM_API = 'https://api.telegram.org';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class TelegramApiError extends Error {
  readonly code = 'telegram_api_error';
  constructor(
    readonly method: string,
    readonly errorCode: number | undefined,
    description: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Telegram ${method} failed${errorCode ? ` (${errorCode})` : ''}: ${description}`);
    this.name = 'TelegramApiError';
  }
}

const envelopeSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error_code: z.number().int().optional(),
  description: z.string().max(500).optional(),
  parameters: z.object({ retry_after: z.number().int().optional() }).optional(),
});

const meSchema = z.object({
  id: z.number().int(),
  is_bot: z.literal(true),
  username: z.string().regex(/^[A-Za-z0-9_]{3,64}$/),
});

/** Commands shown in Telegram's command menu (`setMyCommands`). */
export const BOT_COMMANDS: readonly { command: string; description: string }[] = [
  { command: 'project', description: 'A project on HEY: /project <slug>' },
  { command: 'scan', description: 'Look up a contract: /scan <address>' },
  { command: 'changes', description: "A project's recent changes: /changes <slug>" },
  { command: 'today', description: 'What changed in the last day' },
  { command: 'hey', description: 'About HEY Research and this bot' },
  { command: 'help', description: 'Commands' },
];

export interface TelegramClient {
  getMe(): Promise<{ id: number; username: string }>;
  sendMessage(message: OutgoingMessage): Promise<void>;
  getUpdates(
    offset: number,
    timeoutSeconds: number,
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]>;
  setWebhook(url: string, secretToken: string): Promise<void>;
  deleteWebhook(): Promise<void>;
  setMyCommands(): Promise<void>;
}

async function readCapped(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error('Telegram answer too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createTelegramClient(options: {
  token: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): TelegramClient {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const call = async (
    method: string,
    params: Record<string, unknown>,
    extra: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), extra.timeoutMs ?? timeoutMs);
    const onAbort = () => controller.abort();
    extra.signal?.addEventListener('abort', onAbort, { once: true });
    let response: Response;
    try {
      response = await fetchImpl(`${TELEGRAM_API}/bot${options.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
        redirect: 'error',
      });
    } catch {
      // The underlying error may quote the URL, which holds the token: say only what failed.
      throw new TelegramApiError(
        method,
        undefined,
        controller.signal.aborted ? 'timed out or aborted' : 'network error',
      );
    } finally {
      clearTimeout(timer);
      extra.signal?.removeEventListener('abort', onAbort);
    }
    let body: unknown;
    try {
      body = parseJsonStrict(await readCapped(response));
    } catch {
      throw new TelegramApiError(method, response.status, 'unreadable answer');
    }
    const envelope = envelopeSchema.safeParse(body);
    if (!envelope.success) throw new TelegramApiError(method, response.status, 'unexpected answer');
    if (!envelope.data.ok) {
      throw new TelegramApiError(
        method,
        envelope.data.error_code ?? response.status,
        envelope.data.description ?? 'request refused',
        envelope.data.parameters?.retry_after,
      );
    }
    return envelope.data.result;
  };

  return {
    async getMe() {
      const me = meSchema.safeParse(await call('getMe', {}));
      if (!me.success) throw new TelegramApiError('getMe', undefined, 'unexpected answer');
      return { id: me.data.id, username: me.data.username };
    },
    async sendMessage(message) {
      await call('sendMessage', message);
    },
    async getUpdates(offset, timeoutSeconds, signal) {
      const result = await call(
        'getUpdates',
        { offset, timeout: timeoutSeconds, limit: 50, allowed_updates: ['message'] },
        { timeoutMs: (timeoutSeconds + 10) * 1000, ...(signal ? { signal } : {}) },
      );
      const list = z.array(z.unknown()).max(100).safeParse(result);
      if (!list.success) throw new TelegramApiError('getUpdates', undefined, 'unexpected answer');
      const updates: TelegramUpdate[] = [];
      for (const raw of list.data) {
        const parsed = updateSchema.safeParse(raw);
        if (parsed.success) updates.push(parsed.data);
        else {
          // Keep the offset moving past an update the bot cannot read.
          const id = z.object({ update_id: z.number().int().min(0) }).safeParse(raw);
          if (id.success) updates.push({ update_id: id.data.update_id });
        }
      }
      return updates;
    },
    async setWebhook(url, secretToken) {
      await call('setWebhook', {
        url,
        secret_token: secretToken,
        allowed_updates: ['message'],
        drop_pending_updates: true,
        max_connections: 10,
      });
    },
    async deleteWebhook() {
      await call('deleteWebhook', { drop_pending_updates: false });
    },
    async setMyCommands() {
      await call('setMyCommands', { commands: BOT_COMMANDS });
    },
  };
}
