import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../src/config.js';
import { TEST_SECRET, TEST_TOKEN } from './helpers.js';

const base = { TELEGRAM_BOT_TOKEN: TEST_TOKEN, TELEGRAM_WEBHOOK_SECRET: TEST_SECRET };

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(base, 'webhook')).toEqual({
      botToken: TEST_TOKEN,
      webhookSecret: TEST_SECRET,
      heyApiBase: 'https://heyresearch.xyz',
      port: 8080,
      logLevel: 'info',
    });
  });

  it('treats empty values as unset', () => {
    expect(
      loadConfig({ ...base, HEY_API_BASE: '', PORT: ' ', LOG_LEVEL: '' }, 'webhook'),
    ).toMatchObject({
      heyApiBase: 'https://heyresearch.xyz',
      port: 8080,
      logLevel: 'info',
    });
  });

  it('requires a token of the right shape and never echoes it', () => {
    expect(() => loadConfig({}, 'polling')).toThrow(ConfigError);
    try {
      loadConfig({ TELEGRAM_BOT_TOKEN: 'not-a-token-value-1234' }, 'polling');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('not-a-token-value-1234');
    }
  });

  it('requires the webhook secret in webhook and set-webhook modes, not in polling', () => {
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: TEST_TOKEN }, 'webhook')).toThrow(
      /WEBHOOK_SECRET/,
    );
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: TEST_TOKEN }, 'set-webhook')).toThrow(
      /WEBHOOK_SECRET/,
    );
    expect(loadConfig({ TELEGRAM_BOT_TOKEN: TEST_TOKEN }, 'polling').webhookSecret).toBeUndefined();
  });

  it('refuses a short or ill-formed webhook secret', () => {
    expect(() => loadConfig({ ...base, TELEGRAM_WEBHOOK_SECRET: 'short' }, 'webhook')).toThrow(
      ConfigError,
    );
    expect(() =>
      loadConfig({ ...base, TELEGRAM_WEBHOOK_SECRET: `${'a'.repeat(40)} space` }, 'webhook'),
    ).toThrow(ConfigError);
  });

  it('accepts only an https origin for HEY_API_BASE', () => {
    expect(
      loadConfig({ ...base, HEY_API_BASE: 'https://heyresearch.xyz/' }, 'webhook').heyApiBase,
    ).toBe('https://heyresearch.xyz');
    for (const bad of [
      'http://heyresearch.xyz',
      'ftp://heyresearch.xyz',
      'https://user:pass@heyresearch.xyz',
      'https://heyresearch.xyz/api',
      'https://heyresearch.xyz/?x=1',
      'not a url',
    ]) {
      expect(() => loadConfig({ ...base, HEY_API_BASE: bad }, 'webhook')).toThrow(ConfigError);
    }
  });

  it('validates PORT and LOG_LEVEL', () => {
    expect(loadConfig({ ...base, PORT: '3000', LOG_LEVEL: 'DEBUG' }, 'webhook')).toMatchObject({
      port: 3000,
      logLevel: 'debug',
    });
    expect(() => loadConfig({ ...base, PORT: '0' }, 'webhook')).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, PORT: '70000' }, 'webhook')).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, PORT: '80a' }, 'webhook')).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, LOG_LEVEL: 'verbose' }, 'webhook')).toThrow(ConfigError);
  });
});

describe('.env.example', () => {
  it('lists every variable with an empty value', () => {
    const text = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    const assignments = text.split('\n').filter((l) => /^[A-Z_]+=/.test(l));
    expect(assignments.map((l) => l.split('=')[0])).toEqual([
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_WEBHOOK_SECRET',
      'HEY_API_BASE',
      'PORT',
      'LOG_LEVEL',
    ]);
    for (const line of assignments) expect(line.endsWith('=')).toBe(true);
  });
});
