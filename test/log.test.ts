import { describe, expect, it } from 'vitest';

import { createLogger, makeRedactor, type LogLevel } from '../src/log.js';
import { TEST_SECRET, TEST_TOKEN, realShapedToken } from './helpers.js';

function capture(level: LogLevel = 'debug', secrets: string[] = [TEST_TOKEN, TEST_SECRET]) {
  const lines: { line: string; level: LogLevel }[] = [];
  const log = createLogger({
    level,
    redact: makeRedactor(secrets),
    sink: (line, lvl) => lines.push({ line, level: lvl }),
    now: () => new Date('2026-10-02T00:00:00.000Z'),
  });
  return { log, lines };
}

describe('redaction', () => {
  it('removes the configured token and secret by value, in the message and every field', () => {
    const { log, lines } = capture();
    log.error(`failed with ${TEST_TOKEN}`, {
      url: `https://api.telegram.org/bot${TEST_TOKEN}/sendMessage`,
      nested: { header: TEST_SECRET, list: [TEST_SECRET] },
    });
    const out = lines.map((l) => l.line).join('\n');
    expect(out).not.toContain(TEST_TOKEN);
    expect(out).not.toContain(TEST_SECRET);
    expect(out).not.toContain('test-token-not-real');
    expect(out).toContain('<redacted>');
  });

  it('removes any bot-token shape even when it is not the configured one', () => {
    const token = realShapedToken();
    const { log, lines } = capture('debug', []);
    log.warn('boom', { url: `https://api.telegram.org/bot${token}/getMe`, bare: token });
    const out = lines[0]?.line ?? '';
    expect(out).not.toContain(token);
    expect(out).not.toContain(token.split(':')[1]);
    expect(out).toContain('bot<redacted>');
  });

  it('redacts error messages and stacks', () => {
    const { log, lines } = capture();
    const error = new Error(`request to /bot${TEST_TOKEN}/getMe failed`);
    log.error('fatal', { error });
    const record = JSON.parse(lines[0]?.line ?? '{}') as {
      error: { message: string; stack?: string };
    };
    expect(record.error.message).not.toContain(TEST_TOKEN);
    expect(record.error.stack ?? '').not.toContain(TEST_TOKEN);
  });

  it('writes one JSON object per line, with level filtering', () => {
    const { log, lines } = capture('warn');
    log.info('hidden');
    log.warn('shown', { count: 2 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]?.line ?? '')).toEqual({
      time: '2026-10-02T00:00:00.000Z',
      level: 'warn',
      msg: 'shown',
      count: 2,
    });
    expect(lines[0]?.level).toBe('warn');
  });

  it('does not let a field overwrite time, level or msg', () => {
    const { log, lines } = capture();
    log.info('real', { msg: 'forged', level: 'error' });
    expect(JSON.parse(lines[0]?.line ?? '')).toMatchObject({ msg: 'real', level: 'info' });
  });
});
