import { readFileSync } from 'node:fs';

import type { BotDeps } from '../src/bot.js';
import { createHeyGateway, type FetchLike } from '../src/hey/gateway.js';
import { silentLogger } from '../src/log.js';
import { createLimiters } from '../src/ratelimit.js';
import { updateSchema, type TelegramUpdate } from '../src/telegram/update.js';

export const BOT_USERNAME = 'HeyExampleBot';
export const HEY_BASE = 'https://heyresearch.xyz';

export function fixtureText(path: string): string {
  return readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8');
}

export function fixture<T = unknown>(path: string): T {
  return JSON.parse(fixtureText(path)) as T;
}

export function update(path: string): TelegramUpdate {
  return updateSchema.parse(fixture(path));
}

/** A private-chat update with the given text. */
export function privateText(
  text: string,
  updateId = 1,
  chatId = 1001,
  userId = 1001,
): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1790000000,
      chat: { id: chatId, type: 'private' },
      from: { id: userId, is_bot: false },
      text,
    },
  };
}

/** A group update with the given text. */
export function groupText(
  text: string,
  updateId = 1,
  chatId = -1001,
  userId = 1001,
): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1790000000,
      chat: { id: chatId, type: 'supergroup' },
      from: { id: userId, is_bot: false },
      text,
    },
  };
}

export type Route = { status?: number; body?: unknown; headers?: Record<string, string> };

/** A fetch over fixtures. Records every call; an unrouted URL answers 599 so a test sees it. */
export function fakeFetch(route: (url: URL, init?: RequestInit) => Route | undefined): {
  fetchImpl: FetchLike;
  calls: { url: URL; init: RequestInit | undefined }[];
} {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    const r = route(url, init) ?? { status: 599, body: { error: 'unrouted' } };
    const body = r.body === undefined ? null : JSON.stringify(r.body);
    return new Response(body, {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    });
  };
  return { fetchImpl, calls };
}

/** HEY's routes answered from fixtures. */
export function heyRoutes(overrides: Record<string, Route> = {}) {
  return fakeFetch((url) => {
    const key = url.pathname;
    if (overrides[key]) return overrides[key];
    if (key === '/api/projects/example-builder')
      return { body: fixture('hey/project-shipping.json') };
    if (key === '/api/projects/example-unread')
      return { body: fixture('hey/project-unknown.json') };
    if (key === '/api/projects/example-hostile')
      return { body: fixture('hey/project-hostile.json') };
    if (key === '/api/projects/no-such-project') {
      return { status: 404, body: fixture('hey/project-not-found.json') };
    }
    if (key === '/api/v1/scan') {
      const token = url.searchParams.get('token');
      if (token === '0x0000000000000000000000000000000000000001')
        return { body: fixture('hey/scan-found.json') };
      if (token === '0x0000000000000000000000000000000000000002')
        return { body: fixture('hey/scan-mismatch.json') };
      if (token === '0x0000000000000000000000000000000000000003')
        return { body: fixture('hey/scan-unmeasured.json') };
      if (token === '0x0000000000000000000000000000000000000000')
        return { body: fixture('hey/scan-zero-address.json') };
      if (token === '0x00000000000000000000000000000000000000fe')
        return { body: fixture('hey/scan-not-researched.json') };
      return { body: fixture('hey/scan-not-found.json') };
    }
    if (key === '/api/changes') return { body: fixture('hey/changes.json') };
    if (key === '/api/agent/what_changed') return { body: fixture('hey/what-changed-day.json') };
    return undefined;
  });
}

export function makeDeps(
  fetchImpl: FetchLike,
  overrides: Partial<BotDeps> = {},
): { deps: BotDeps; advance: (ms: number) => void } {
  let clock = 1_790_000_000_000;
  const now = () => clock;
  const deps: BotDeps = {
    hey: createHeyGateway({ baseUrl: HEY_BASE, fetchImpl }),
    limiters: createLimiters(now),
    botUsername: BOT_USERNAME,
    siteBase: HEY_BASE,
    log: silentLogger,
    now,
    ...overrides,
  };
  return { deps, advance: (ms) => void (clock += ms) };
}

/** A bot token of the real shape, built at run time so no file holds one. */
export function realShapedToken(): string {
  return ['1234567', '890:', 'AA', 'x'.repeat(33)].join('');
}

/** A token of the shape the config accepts, without the real-token prefix. */
export const TEST_TOKEN = '123456:test-token-not-real-aaaaaaaaaaaaaaaaaaaaaaaa';
export const TEST_SECRET = 'test-secret-0123456789abcdef0123456789';
