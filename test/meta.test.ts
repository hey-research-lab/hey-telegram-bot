import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { VERSION } from '../src/version.js';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('repository facts', () => {
  it('keeps VERSION equal to package.json', () => {
    expect(VERSION).toBe((JSON.parse(read('package.json')) as { version: string }).version);
  });

  it('depends at run time only on the SDK and zod', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@hey-research-lab/sdk', 'zod']);
  });

  it('never calls the live scan route or an account route', () => {
    const sources = ['src/hey/gateway.ts', 'src/bot.ts', 'src/main.ts'].map(read).join('\n');
    expect(sources).not.toMatch(/method:\s*['"]POST['"][\s\S]{0,200}\/api\/scan/);
    expect(sources).not.toMatch(/\/api\/(webhooks|alerts|boards|account|auth|telegram)/);
    expect(sources).not.toMatch(/apiKey/);
  });

  it('carries the README blocks the conventions require', () => {
    const readme = read('README.md');
    expect(readme).toContain(
      "The bot relays HEY's public research. It is not financial advice, never says a token is safe, never tells anyone to buy or sell, and treats a missing value as unknown.",
    );
    expect(readme).toContain(
      'HEY Research Lab is an independent research project and is not affiliated with, endorsed by or partnered with Robinhood Markets, Inc. or Robinhood Chain.',
    );
  });
});
