import { HeyApiError, HeyClient } from '@hey-research-lab/sdk';
import { ZodError, type ZodType } from 'zod';

import { CHAIN_ID } from '../chain.js';
import { VERSION } from '../version.js';
import {
  changesPageSchema,
  projectSchema,
  scanCardSchema,
  whatChangedSchema,
  type ChangesPage,
  type Project,
  type ScanCard,
  type WhatChanged,
} from './schemas.js';

/**
 * The bot's only door to HEY: four read-only calls over the public API,
 * through the published `@hey-research-lab/sdk`.
 *
 *   /scan     GET /api/v1/scan?chain=4663&token=        (sdk.scanCard)
 *   /project  GET /api/projects/{slug}                  (sdk.projects.get)
 *   /changes  GET /api/changes?project=&domain=         (sdk.changes.list)
 *   /today    GET /api/agent/what_changed?days=1        (sdk.get — not in SDK 0.1.1)
 *
 * Never `POST /api/scan` (a live provider read reserved for HEY's own site),
 * never an account, alert or write route. No API key is sent.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The most bytes of one HEY answer the bot reads. */
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const HEY_TIMEOUT_MS = 10_000;

/** Change-ledger domains the bot shows: everything except `market`. */
export const CHANGE_DOMAINS = ['build', 'contract', 'token', 'research', 'lock'] as const;

/** A failure, with the API's own code when it gave one. */
export class BotError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly status: number | undefined;
  constructor(
    code: string,
    message: string,
    options: {
      retryable?: boolean;
      requestId?: string | undefined;
      retryAfterSeconds?: number | undefined;
      status?: number | undefined;
    } = {},
  ) {
    super(message);
    this.name = 'BotError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.status = options.status;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const REQUEST_ID_RE = /^[A-Za-z0-9-]{1,100}$/;
const CODE_RE = /^[a-z][a-z0-9_]{0,60}$/;

/** Maps an SDK error (and the API's error body inside it) to a BotError. */
export function toBotError(error: unknown): BotError {
  if (error instanceof BotError) return error;
  if (error instanceof ZodError) {
    return new BotError('unexpected_response', 'HEY answered in a shape this bot does not read.');
  }
  if (error instanceof HeyApiError) {
    const body = isRecord(error.body) ? error.body : undefined;
    let code: string = error.code;
    let message = error.message;
    if (body && typeof body.error === 'string' && CODE_RE.test(body.error)) {
      code = body.error;
      if (typeof body.message === 'string') message = body.message;
    } else if (body && isRecord(body.error) && typeof body.error.code === 'string') {
      // The agent contract's refusal envelope: `error: { code, message: { text } }`.
      if (CODE_RE.test(body.error.code)) code = body.error.code;
      const text = isRecord(body.error.message) ? body.error.message.text : undefined;
      if (typeof text === 'string') message = text;
    }
    const requestId =
      body && typeof body.requestId === 'string' && REQUEST_ID_RE.test(body.requestId)
        ? body.requestId
        : undefined;
    const retryable =
      body && typeof body.retryable === 'boolean'
        ? body.retryable
        : ['rate_limited', 'unavailable', 'network', 'timeout'].includes(error.code) ||
          (error.status !== undefined && error.status >= 500);
    return new BotError(code, message, {
      retryable,
      requestId,
      retryAfterSeconds: error.retryAfterSeconds,
      status: error.status,
    });
  }
  return new BotError('internal_error', 'Something went wrong in the bot.');
}

/**
 * A fetch that only talks to the configured HEY origin and reads at most
 * `MAX_RESPONSE_BYTES` of an answer. The SDK already refuses redirects to
 * other hosts; this keeps a misbehaving answer from exhausting memory.
 */
export function boundedFetch(base: string, fetchImpl: FetchLike): FetchLike {
  const origin = new URL(base).origin;
  return async (input, init) => {
    if (new URL(input).origin !== origin) {
      throw new Error('refused a request outside the configured HEY origin');
    }
    const response = await fetchImpl(input, init);
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('HEY answer larger than the bot reads');
    }
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('HEY answer larger than the bot reads');
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks);
    // A 3xx keeps its status and Location so the SDK can apply its own redirect rule.
    return new Response(response.status === 204 || response.status === 304 ? null : body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export interface HeyGateway {
  scan(address: string): Promise<ScanCard>;
  project(slug: string): Promise<Project>;
  changes(slug: string, limit: number): Promise<ChangesPage>;
  whatChangedToday(limit: number): Promise<WhatChanged>;
}

export function createHeyGateway(options: {
  baseUrl: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): HeyGateway {
  const client = new HeyClient({
    baseUrl: options.baseUrl,
    fetchImpl: boundedFetch(
      options.baseUrl,
      options.fetchImpl ?? ((input, init) => fetch(input, init)),
    ),
    timeoutMs: options.timeoutMs ?? HEY_TIMEOUT_MS,
    userAgent: `hey-telegram-bot/${VERSION}`,
  });

  const call = async <T>(schema: ZodType<T>, run: () => Promise<unknown>): Promise<T> => {
    try {
      return schema.parse(await run());
    } catch (error) {
      throw toBotError(error);
    }
  };

  return {
    scan: (address) => call(scanCardSchema, () => client.scanCard(CHAIN_ID, address)),
    project: (slug) => call(projectSchema, () => client.projects.get(slug)),
    changes: (slug, limit) =>
      call(changesPageSchema, () =>
        client.changes.list({ project: slug, domain: [...CHANGE_DOMAINS], limit }),
      ),
    whatChangedToday: async (limit) => {
      const answer = await call(whatChangedSchema, () =>
        client.get('/api/agent/what_changed', { days: 1, building: 'only', limit }),
      );
      if (answer.status !== 'ok' || !answer.data) {
        throw new BotError(
          answer.error?.code ?? answer.status,
          answer.error?.message.text ?? 'HEY did not answer this question.',
        );
      }
      return answer;
    },
  };
}
