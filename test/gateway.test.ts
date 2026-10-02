import { describe, expect, it } from 'vitest';

import { BotError, MAX_RESPONSE_BYTES, createHeyGateway } from '../src/hey/gateway.js';
import { HEY_BASE, fakeFetch, fixture, heyRoutes } from './helpers.js';

describe('HEY gateway: which routes it reads', () => {
  it('/scan reads GET /api/v1/scan on chain 4663, never POST /api/scan', async () => {
    const { fetchImpl, calls } = heyRoutes();
    const hey = createHeyGateway({ baseUrl: HEY_BASE, fetchImpl });
    const card = await hey.scan('0x0000000000000000000000000000000000000001');
    expect(card.found).toBe(true);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url.pathname).toBe('/api/v1/scan');
    expect(url.searchParams.get('chain')).toBe('4663');
    expect(url.searchParams.get('token')).toBe('0x0000000000000000000000000000000000000001');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('/project reads GET /api/projects/{slug}', async () => {
    const { fetchImpl, calls } = heyRoutes();
    const hey = createHeyGateway({ baseUrl: HEY_BASE, fetchImpl });
    const project = await hey.project('example-builder');
    expect(project.slug).toBe('example-builder');
    expect(calls[0]!.url.pathname).toBe('/api/projects/example-builder');
  });

  it('/changes reads the ledger for one project with every domain but market', async () => {
    const { fetchImpl, calls } = heyRoutes();
    const hey = createHeyGateway({ baseUrl: HEY_BASE, fetchImpl });
    await hey.changes('example-builder', 5);
    const url = calls[0]!.url;
    expect(url.pathname).toBe('/api/changes');
    expect(url.searchParams.get('project')).toBe('example-builder');
    expect(url.searchParams.get('domain')).toBe('build,contract,token,research,lock');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('/today reads the agent contract’s what_changed for one day, building only', async () => {
    const { fetchImpl, calls } = heyRoutes();
    const hey = createHeyGateway({ baseUrl: HEY_BASE, fetchImpl });
    const answer = await hey.whatChangedToday(5);
    expect(answer.data?.total).toBe(75);
    const url = calls[0]!.url;
    expect(url.pathname).toBe('/api/agent/what_changed');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      days: '1',
      building: 'only',
      limit: '5',
    });
  });

  it('identifies itself in the user-agent and sends no credentials', async () => {
    const { fetchImpl, calls } = heyRoutes();
    await createHeyGateway({ baseUrl: HEY_BASE, fetchImpl }).project('example-builder');
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get('user-agent')).toMatch(/^hey-telegram-bot\/0\.1\.0 /);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('x-api-key')).toBeNull();
  });
});

describe('HEY gateway: errors', () => {
  it('keeps the API’s code, message and request id on a 404', async () => {
    const { fetchImpl } = heyRoutes();
    const hey = createHeyGateway({ baseUrl: HEY_BASE, fetchImpl });
    const error = await hey.project('no-such-project').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BotError);
    expect(error).toMatchObject({
      code: 'not_found',
      retryable: false,
      requestId: '00000000-0000-4000-8000-00000000a404',
      status: 404,
    });
  });

  it('carries retry-after on a 429', async () => {
    const { fetchImpl } = heyRoutes({
      '/api/projects/example-builder': {
        status: 429,
        body: fixture('hey/rate-limited.json'),
        headers: { 'retry-after': '30' },
      },
    });
    const error = await createHeyGateway({ baseUrl: HEY_BASE, fetchImpl })
      .project('example-builder')
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'rate_limited', retryable: true, retryAfterSeconds: 30 });
  });

  it('maps a network failure to a retryable error', async () => {
    const hey = createHeyGateway({
      baseUrl: HEY_BASE,
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const error = await hey.project('example-builder').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'network', retryable: true });
  });

  it('refuses an answer in a shape it does not read', async () => {
    const { fetchImpl } = heyRoutes({ '/api/projects/example-builder': { body: { slug: 1 } } });
    const error = await createHeyGateway({ baseUrl: HEY_BASE, fetchImpl })
      .project('example-builder')
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'unexpected_response' });
  });

  it('maps an agent-contract refusal to its own code', async () => {
    const { fetchImpl } = heyRoutes({
      '/api/agent/what_changed': { status: 400, body: fixture('hey/what-changed-refusal.json') },
    });
    const error = await createHeyGateway({ baseUrl: HEY_BASE, fetchImpl })
      .whatChangedToday(5)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'invalid_parameter',
      message: 'days must be between 1 and 30.',
    });
  });

  it('refuses an answer larger than it reads', async () => {
    const big = 'x'.repeat(MAX_RESPONSE_BYTES + 10);
    const hey = createHeyGateway({
      baseUrl: HEY_BASE,
      fetchImpl: async () => new Response(JSON.stringify({ big }), { status: 200 }),
    });
    const error = await hey.project('example-builder').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BotError);
    expect((error as BotError).code).toBe('network');
  });

  it('does not follow a redirect to another host', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 302,
      headers: { location: 'https://elsewhere.example.org/api/projects/x' },
    }));
    const error = await createHeyGateway({ baseUrl: HEY_BASE, fetchImpl })
      .project('example-builder')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BotError);
    expect(calls).toHaveLength(1);
  });
});
