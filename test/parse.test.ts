import { describe, expect, it } from 'vitest';

import { parseAddressArg, parseCommandText, parseSlugArg } from '../src/commands/parse.js';
import { BOT_USERNAME } from './helpers.js';

describe('parseCommandText', () => {
  it('reads a bare command and its arguments', () => {
    expect(parseCommandText('/project example-builder', BOT_USERNAME)).toEqual({
      kind: 'command',
      name: 'project',
      known: true,
      args: 'example-builder',
      addressed: false,
    });
  });

  it('accepts the bot’s own @username suffix, in any case', () => {
    const parsed = parseCommandText('/scan@heyexamplebot 0xabc', BOT_USERNAME);
    expect(parsed).toMatchObject({ kind: 'command', name: 'scan', args: '0xabc', addressed: true });
  });

  it('ignores a command addressed to another bot', () => {
    expect(parseCommandText('/scan@SomeOtherBot 0xabc', BOT_USERNAME)).toEqual({
      kind: 'not_for_us',
    });
  });

  it('lower-cases the command name and trims arguments', () => {
    expect(parseCommandText('  /TODAY   ', BOT_USERNAME)).toMatchObject({
      name: 'today',
      known: true,
      args: '',
    });
  });

  it('marks an unknown command as unknown', () => {
    expect(parseCommandText('/price example', BOT_USERNAME)).toMatchObject({
      kind: 'command',
      name: 'price',
      known: false,
    });
  });

  it('does not read plain text, a slash inside text, or a command glued to text', () => {
    expect(parseCommandText('hello /help', BOT_USERNAME)).toEqual({ kind: 'not_a_command' });
    expect(parseCommandText('/help!', BOT_USERNAME)).toEqual({ kind: 'not_a_command' });
    expect(parseCommandText('/', BOT_USERNAME)).toEqual({ kind: 'not_a_command' });
  });

  it('keeps multi-line arguments as one string', () => {
    expect(parseCommandText('/project\nexample-builder', BOT_USERNAME)).toMatchObject({
      args: 'example-builder',
    });
  });
});

describe('parseAddressArg', () => {
  it('lower-cases an address and accepts a 0X prefix', () => {
    expect(parseAddressArg('0XABCDEF0000000000000000000000000000000001')).toEqual({
      ok: true,
      value: '0xabcdef0000000000000000000000000000000001',
    });
  });

  it('accepts a CAIP-10 id on Robinhood Chain only', () => {
    expect(parseAddressArg('eip155:4663:0x0000000000000000000000000000000000000001')).toEqual({
      ok: true,
      value: '0x0000000000000000000000000000000000000001',
    });
    expect(parseAddressArg('eip155:1:0x0000000000000000000000000000000000000001')).toEqual({
      ok: false,
      code: 'unsupported_chain',
      chainId: '1',
    });
  });

  it('refuses what is not an address', () => {
    expect(parseAddressArg('')).toMatchObject({ ok: false, code: 'missing_argument' });
    expect(parseAddressArg('0x123')).toMatchObject({ ok: false, code: 'invalid_address' });
    expect(parseAddressArg('EXB')).toMatchObject({ ok: false, code: 'invalid_address' });
    expect(parseAddressArg(`0x${'g'.repeat(40)}`)).toMatchObject({ ok: false });
    expect(parseAddressArg('x'.repeat(500))).toMatchObject({ ok: false, code: 'invalid_address' });
  });

  it('reads only the first word', () => {
    expect(parseAddressArg('0x0000000000000000000000000000000000000001 please')).toMatchObject({
      ok: true,
    });
  });
});

describe('parseSlugArg', () => {
  it('accepts a slug, lower-cased', () => {
    expect(parseSlugArg('Example-Builder')).toEqual({ ok: true, value: 'example-builder' });
  });

  it('accepts a HEY project page URL', () => {
    expect(parseSlugArg('https://heyresearch.xyz/project/example-builder')).toEqual({
      ok: true,
      value: 'example-builder',
    });
  });

  it('refuses another site’s URL, path tricks and bad characters', () => {
    expect(parseSlugArg('https://example.com/project/example-builder')).toMatchObject({
      ok: false,
    });
    expect(parseSlugArg('../admin')).toMatchObject({ ok: false, code: 'invalid_slug' });
    // HEY's request rule: 80 characters at most (OpenAPI).
    expect(parseSlugArg(`a${'b'.repeat(79)}`)).toMatchObject({ ok: true });
    expect(parseSlugArg(`a${'b'.repeat(80)}`)).toMatchObject({ ok: false, code: 'invalid_slug' });
    expect(parseSlugArg('a/b')).toMatchObject({ ok: false });
    expect(parseSlugArg('-leading')).toMatchObject({ ok: false });
    expect(parseSlugArg('a'.repeat(121))).toMatchObject({ ok: false });
    expect(parseSlugArg('')).toMatchObject({ ok: false, code: 'missing_argument' });
  });
});
