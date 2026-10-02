import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { handleUpdate } from '../src/bot.js';
import { createLogger, makeRedactor } from '../src/log.js';
import {
  HEALTH_PATH,
  SECRET_HEADER,
  WEBHOOK_PATH,
  createWebhookServer,
  secretMatches,
} from '../src/server.js';
import { MAX_UPDATE_BYTES } from '../src/telegram/update.js';
import { TEST_SECRET, TEST_TOKEN, fixtureText, heyRoutes, makeDeps } from './helpers.js';

type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: string };

let server: Server | undefined;
const logLines: string[] = [];

async function start(): Promise<number> {
  const { fetchImpl } = heyRoutes();
  logLines.length = 0;
  const log = createLogger({
    level: 'debug',
    redact: makeRedactor([TEST_TOKEN, TEST_SECRET]),
    sink: (line) => logLines.push(line),
  });
  const { deps } = makeDeps(fetchImpl, { log });
  server = createWebhookServer({ secret: TEST_SECRET, handle: (u) => handleUpdate(u, deps), log });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  return (server!.address() as AddressInfo).port;
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

function call(
  port: number,
  options: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
    chunks?: Buffer[];
  },
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'POST',
        path: options.path ?? WEBHOOK_PATH,
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', (error: NodeJS.ErrnoException) => {
      // The server may close the socket after answering an oversized body.
      if (error.code === 'ECONNRESET' || error.code === 'EPIPE')
        resolve({ status: -1, headers: {}, body: '' });
      else reject(error);
    });
    if (options.chunks) {
      for (const chunk of options.chunks) req.write(chunk);
      req.end();
    } else req.end(options.body);
  });
}

const json = { 'content-type': 'application/json' };
const authed = { ...json, [SECRET_HEADER]: TEST_SECRET };

describe('secretMatches', () => {
  it('matches only the exact secret', () => {
    expect(secretMatches(TEST_SECRET, TEST_SECRET)).toBe(true);
    expect(secretMatches(`${TEST_SECRET}x`, TEST_SECRET)).toBe(false);
    expect(secretMatches(TEST_SECRET.slice(0, -1), TEST_SECRET)).toBe(false);
    expect(secretMatches(undefined, TEST_SECRET)).toBe(false);
    expect(secretMatches('', TEST_SECRET)).toBe(false);
    expect(secretMatches([TEST_SECRET], TEST_SECRET)).toBe(false);
    expect(secretMatches('x'.repeat(300), TEST_SECRET)).toBe(false);
  });
});

describe('webhook server', () => {
  it('answers a command with sendMessage in the webhook response', async () => {
    const port = await start();
    const res = await call(port, {
      headers: authed,
      body: fixtureText('telegram/private-project.json'),
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toMatchObject({ method: 'sendMessage', chat_id: 1001, parse_mode: 'HTML' });
    expect(String(body.text)).toContain('<b>Example Builder</b>');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('refuses a missing or wrong secret token before reading the body', async () => {
    const port = await start();
    const body = fixtureText('telegram/private-help.json');
    const missing = await call(port, { headers: json, body });
    expect(missing.status).toBe(401);
    expect(JSON.parse(missing.body)).toEqual({
      error: 'unauthorized',
      message: 'Missing or wrong secret token.',
    });
    const wrong = await call(port, {
      headers: { ...json, [SECRET_HEADER]: 'wrong-secret-0123456789abcdef0123456789' },
      body,
    });
    expect(wrong.status).toBe(401);
    expect(logLines.join('\n')).not.toContain(TEST_SECRET);
  });

  it('refuses a body over the size limit, declared or streamed', async () => {
    const port = await start();
    const big = Buffer.alloc(MAX_UPDATE_BYTES + 1, 0x20);
    const declared = await call(port, {
      headers: { ...authed, 'content-length': String(big.length) },
      body: big,
    });
    expect([413, -1]).toContain(declared.status);
    if (declared.status === 413) expect(JSON.parse(declared.body).error).toBe('payload_too_large');

    // Chunked: no content-length, so the cap applies while reading.
    const streamed = await call(port, {
      headers: { ...authed, 'transfer-encoding': 'chunked' },
      chunks: [Buffer.alloc(40 * 1024, 0x20), Buffer.alloc(40 * 1024, 0x20)],
    });
    expect([413, -1]).toContain(streamed.status);
  });

  it('refuses non-JSON, malformed updates and prototype keys', async () => {
    const port = await start();
    expect(
      (await call(port, { headers: { ...authed, 'content-type': 'text/plain' }, body: '{}' }))
        .status,
    ).toBe(415);
    const bad = await call(port, { headers: authed, body: '{not json' });
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body).error).toBe('invalid_json');
    const notUpdate = await call(port, { headers: authed, body: '{"hello":1}' });
    expect(JSON.parse(notUpdate.body).error).toBe('invalid_update');
    const proto = await call(port, {
      headers: authed,
      body: fixtureText('telegram/proto-pollution.txt'),
    });
    expect(proto.status).toBe(400);
    expect(JSON.parse(proto.body).error).toBe('forbidden_key');
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  it('acknowledges update kinds it does not handle with an empty 200', async () => {
    const port = await start();
    const res = await call(port, {
      headers: authed,
      body: fixtureText('telegram/callback-query.json'),
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe('');
  });

  it('answers a retried update once', async () => {
    const port = await start();
    const body = fixtureText('telegram/private-help.json');
    expect((await call(port, { headers: authed, body })).body).toContain('sendMessage');
    expect((await call(port, { headers: authed, body })).body).toBe('');
  });

  it('serves health, 404 elsewhere and 405 for the wrong method', async () => {
    const port = await start();
    const health = await call(port, { method: 'GET', path: HEALTH_PATH });
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toEqual({ status: 'ok' });
    expect((await call(port, { method: 'GET', path: '/' })).status).toBe(404);
    expect((await call(port, { method: 'GET', path: '/telegram/webhook/../admin' })).status).toBe(
      404,
    );
    const get = await call(port, { method: 'GET', path: WEBHOOK_PATH });
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe('POST');
    expect((await call(port, { method: 'POST', path: HEALTH_PATH })).status).toBe(405);
  });

  it('logs no message text and no secret', async () => {
    const port = await start();
    await call(port, { headers: authed, body: fixtureText('telegram/private-project.json') });
    const out = logLines.join('\n');
    expect(out).toContain('"command":"project"');
    expect(out).not.toContain('example-builder');
    expect(out).not.toContain('example_person');
    expect(out).not.toContain(TEST_SECRET);
  });
});
