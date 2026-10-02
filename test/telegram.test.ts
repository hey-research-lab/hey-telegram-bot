import { describe, expect, it } from 'vitest';

import { handleUpdate } from '../src/bot.js';
import { createLogger, makeRedactor, silentLogger } from '../src/log.js';
import { runPolling } from '../src/polling.js';
import {
  TelegramApiError,
  createTelegramClient,
  type TelegramClient,
} from '../src/telegram/client.js';
import {
  parseUpdate,
  UpdateParseError,
  type OutgoingMessage,
  type TelegramUpdate,
} from '../src/telegram/update.js';
import {
  TEST_TOKEN,
  fakeFetch,
  fixture,
  fixtureText,
  heyRoutes,
  makeDeps,
  privateText,
} from './helpers.js';

describe('parseUpdate', () => {
  it('keeps only the fields the bot reads', () => {
    const parsed = parseUpdate(fixtureText('telegram/private-project.json'));
    expect(parsed.message?.text).toBe('/project example-builder');
    expect(parsed.message?.from).toEqual({ id: 1001, is_bot: false });
    expect(parsed.message?.chat).toEqual({ id: 1001, type: 'private' });
  });

  it('refuses prototype keys anywhere in the body', () => {
    for (const body of [
      fixtureText('telegram/proto-pollution.txt'),
      '{"update_id":1,"constructor":{"prototype":{"x":1}}}',
    ]) {
      expect(() => parseUpdate(body)).toThrow(UpdateParseError);
    }
  });

  it('refuses text longer than Telegram allows', () => {
    const body = JSON.stringify({
      update_id: 1,
      message: { message_id: 1, date: 1, chat: { id: 1, type: 'private' }, text: 'x'.repeat(5000) },
    });
    expect(() => parseUpdate(body)).toThrow(UpdateParseError);
  });
});

describe('Telegram client', () => {
  it('posts JSON to the method and never puts the token in an error', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 400,
      body: { ok: false, error_code: 400, description: 'Bad Request: chat not found' },
    }));
    const client = createTelegramClient({ token: TEST_TOKEN, fetchImpl });
    const error = await client
      .sendMessage({
        chat_id: 1,
        text: 'x',
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TelegramApiError);
    expect((error as Error).message).toBe(
      'Telegram sendMessage failed (400): Bad Request: chat not found',
    );
    expect((error as Error).message).not.toContain(TEST_TOKEN);
    expect(calls[0]!.url.pathname).toBe(`/bot${TEST_TOKEN}/sendMessage`);
    expect(calls[0]!.init?.method).toBe('POST');
  });

  it('hides the URL when the network fails', async () => {
    const client = createTelegramClient({
      token: TEST_TOKEN,
      fetchImpl: async (input) => {
        throw new TypeError(`fetch failed for ${input}`);
      },
    });
    const error = await client.getMe().catch((e: unknown) => e);
    expect((error as Error).message).toBe('Telegram getMe failed: network error');
  });

  it('reads getMe and getUpdates, keeping the offset moving past unreadable updates', async () => {
    const { fetchImpl } = fakeFetch((url) => {
      if (url.pathname.endsWith('/getMe')) {
        return {
          body: {
            ok: true,
            result: { id: 42, is_bot: true, first_name: 'HEY', username: 'HeyExampleBot' },
          },
        };
      }
      return {
        body: {
          ok: true,
          result: [
            fixture('telegram/private-help.json'),
            { update_id: 500000099, message: { weird: true } },
          ],
        },
      };
    });
    const client = createTelegramClient({ token: TEST_TOKEN, fetchImpl });
    expect(await client.getMe()).toEqual({ id: 42, username: 'HeyExampleBot' });
    const updates = await client.getUpdates(0, 25);
    expect(updates.map((u) => u.update_id)).toEqual([500000002, 500000099]);
    expect(updates[1]?.message).toBeUndefined();
  });

  it('registers the webhook with the secret token and only message updates', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { ok: true, result: true } }));
    const client = createTelegramClient({ token: TEST_TOKEN, fetchImpl });
    await client.setWebhook(
      'https://bot.example.org/telegram/webhook',
      'secret-value-0123456789abcdef012345',
    );
    const sent = JSON.parse(String(calls[0]!.init?.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({
      url: 'https://bot.example.org/telegram/webhook',
      secret_token: 'secret-value-0123456789abcdef012345',
      allowed_updates: ['message'],
    });
  });
});

function scriptedTelegram(script: (() => Promise<TelegramUpdate[]>)[]) {
  const sent: OutgoingMessage[] = [];
  const offsets: number[] = [];
  let i = 0;
  const telegram: TelegramClient = {
    getMe: async () => ({ id: 1, username: 'HeyExampleBot' }),
    sendMessage: async (m) => void sent.push(m),
    getUpdates: async (offset) => {
      offsets.push(offset);
      const step = script[i++];
      if (!step) throw new TelegramApiError('getUpdates', 401, 'Unauthorized');
      return step();
    },
    setWebhook: async () => undefined,
    deleteWebhook: async () => undefined,
    setMyCommands: async () => undefined,
  };
  return { telegram, sent, offsets };
}

describe('polling', () => {
  it('handles updates, sends replies, advances the offset and stops on a rejected token', async () => {
    const { fetchImpl } = heyRoutes();
    const { deps } = makeDeps(fetchImpl);
    const { telegram, sent, offsets } = scriptedTelegram([
      async () => [privateText('/help', 7), privateText('hello', 8)],
      async () => [],
    ]);
    const result = await runPolling({
      telegram,
      handle: (u) => handleUpdate(u, deps),
      log: silentLogger,
      signal: new AbortController().signal,
      sleep: async () => undefined,
    });
    expect(result).toBe('fatal');
    expect(offsets).toEqual([0, 9, 9]);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.text).toContain('/project &lt;slug&gt;');
  });

  it('backs off on failures and gives up after a bounded number', async () => {
    const waits: number[] = [];
    const failing = Array.from({ length: 10 }, () => async (): Promise<TelegramUpdate[]> => {
      throw new TelegramApiError('getUpdates', 502, 'Bad Gateway');
    });
    const { telegram } = scriptedTelegram(failing);
    const lines: string[] = [];
    const result = await runPolling({
      telegram,
      handle: async () => null,
      log: createLogger({
        level: 'debug',
        redact: makeRedactor([TEST_TOKEN]),
        sink: (l) => lines.push(l),
      }),
      signal: new AbortController().signal,
      sleep: async (ms) => void waits.push(ms),
      maxConsecutiveFailures: 4,
    });
    expect(result).toBe('too_many_failures');
    expect(waits).toEqual([1000, 2000, 4000]);
    expect(lines.join('\n')).not.toContain(TEST_TOKEN);
  });

  it('stops with a hint when a webhook is still set', async () => {
    const { telegram } = scriptedTelegram([
      async () => {
        throw new TelegramApiError(
          'getUpdates',
          409,
          "Conflict: can't use getUpdates method while webhook is active",
        );
      },
    ]);
    const result = await runPolling({
      telegram,
      handle: async () => null,
      log: silentLogger,
      signal: new AbortController().signal,
    });
    expect(result).toBe('fatal');
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    const { telegram } = scriptedTelegram([
      async () => {
        controller.abort();
        return [];
      },
    ]);
    const result = await runPolling({
      telegram,
      handle: async () => null,
      log: silentLogger,
      signal: controller.signal,
    });
    expect(result).toBe('stopped');
  });
});
