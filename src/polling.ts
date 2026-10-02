import type { Logger } from './log.js';
import { TelegramApiError, type TelegramClient } from './telegram/client.js';
import type { OutgoingMessage, TelegramUpdate } from './telegram/update.js';

/**
 * Long-polling mode, for local development: no public URL, no TLS, no
 * webhook. The loop asks Telegram for updates (`getUpdates`, 25 s long poll),
 * handles them one by one and sends each reply with `sendMessage`.
 *
 * It stops on its abort signal, on an error that retrying cannot fix (a wrong
 * token, or a webhook still set for this bot) and after a bounded run of
 * consecutive failures, so it never spins forever against a dead endpoint.
 */

export const LONG_POLL_SECONDS = 25;
export const MAX_CONSECUTIVE_FAILURES = 20;
const MAX_BACKOFF_MS = 30_000;

export type PollingResult = 'stopped' | 'fatal' | 'too_many_failures';

export type PollingOptions = {
  telegram: TelegramClient;
  handle: (update: TelegramUpdate) => Promise<OutgoingMessage | null>;
  log: Logger;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  maxConsecutiveFailures?: number;
};

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

export async function runPolling(options: PollingOptions): Promise<PollingResult> {
  const sleep = options.sleep ?? defaultSleep;
  const maxFailures = options.maxConsecutiveFailures ?? MAX_CONSECUTIVE_FAILURES;
  let offset = 0;
  let failures = 0;

  while (!options.signal.aborted) {
    let updates: TelegramUpdate[];
    try {
      updates = await options.telegram.getUpdates(offset, LONG_POLL_SECONDS, options.signal);
      failures = 0;
    } catch (error) {
      if (options.signal.aborted) break;
      if (error instanceof TelegramApiError) {
        if (error.errorCode === 401 || error.errorCode === 404) {
          options.log.error('polling_stopped', { reason: 'token_rejected', error });
          return 'fatal';
        }
        if (error.errorCode === 409) {
          options.log.error('polling_stopped', {
            reason: 'webhook_set',
            hint: 'Run `hey-telegram-bot delete-webhook` before polling.',
          });
          return 'fatal';
        }
      }
      failures += 1;
      if (failures >= maxFailures) {
        options.log.error('polling_stopped', { reason: 'too_many_failures', failures, error });
        return 'too_many_failures';
      }
      const retryAfter = error instanceof TelegramApiError ? error.retryAfterSeconds : undefined;
      const wait = retryAfter
        ? Math.min(retryAfter * 1000, MAX_BACKOFF_MS)
        : Math.min(1000 * 2 ** (failures - 1), MAX_BACKOFF_MS);
      options.log.warn('polling_failed', { failures, waitMs: wait, error });
      await sleep(wait, options.signal);
      continue;
    }

    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      const message = await options.handle(update);
      if (!message) continue;
      try {
        await options.telegram.sendMessage(message);
      } catch (error) {
        options.log.warn('send_failed', { error });
      }
    }
  }
  return 'stopped';
}
