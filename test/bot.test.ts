import { describe, expect, it } from 'vitest';

import { RecentUpdates, handleUpdate } from '../src/bot.js';
import { LIMITS } from '../src/ratelimit.js';
import { fixture, groupText, heyRoutes, makeDeps, privateText, update } from './helpers.js';

/** Words the bot's replies must never contain (conventions: forbidden output words). */
const FORBIDDEN =
  /\b(rug|scam|safe|unsafe|bullish|bearish|buy|sell|100x|alpha|undervalued|guaranteed|smart money|whale|dev wallet|users|partnership|audited)\b/i;

/** The bot's own words, without HEY's disclaimer and quoted source text. */
function ownWords(text: string): string {
  return text
    .replace(/<i>[\s\S]*?<\/i>/g, '')
    .replace(/«[^»]*»/g, '')
    .replace(/<a href="[^"]*">/g, '');
}

async function send(text: string, kind: 'private' | 'group' = 'private') {
  const { fetchImpl, calls } = heyRoutes();
  const { deps } = makeDeps(fetchImpl);
  const out = await handleUpdate(kind === 'private' ? privateText(text) : groupText(text), deps);
  return { out, calls };
}

describe('/project', () => {
  it('prints HEY’s status words, the last ship and a link to the project page', async () => {
    const { out } = await send('/project example-builder');
    expect(out).not.toBeNull();
    const text = out!.text;
    expect(text).toContain('<b>Example Builder</b> (EXB) · Infrastructure');
    expect(text).toContain(
      'Activity: <b>Shipping</b> — Shipped something meaningful in the last 7 days.',
    );
    expect(text).toContain('Last meaningful ship: 2026-09-30');
    expect(text).toContain('«Example SDK v0.4»');
    expect(text).toContain('<code>PUBLICLY_VERIFIED</code>');
    expect(text).toContain('Research level: Verified Builder');
    expect(text).toContain('Still Building: not measured');
    expect(text).toContain('<code>VERIFIED</code> — the project itself names this contract');
    expect(text).toContain(
      '<a href="https://heyresearch.xyz/project/example-builder">heyresearch.xyz/project/example-builder</a>',
    );
    expect(text).toContain('not investment advice');
    expect(out).toMatchObject({
      chat_id: 1001,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });

  it('never relays market figures, even when HEY’s answer carries them', async () => {
    const { out } = await send('/project example-builder');
    const text = out!.text;
    for (const figure of [
      '987654321',
      '987,654,321',
      '4242424',
      '7777777',
      '31.5',
      '123',
      '456',
      'LOW_LIQUIDITY',
    ]) {
      expect(text).not.toContain(figure);
    }
    expect(text).not.toMatch(/\$\s?\d/);
    expect(ownWords(text)).not.toMatch(FORBIDDEN);
  });

  it('keeps UNKNOWN unknown and says why when HEY says why', async () => {
    const { out } = await send('/project example-unread');
    const text = out!.text;
    expect(text).toContain('Activity: <b>No builder source linked</b>');
    expect(text).toContain('It does not mean nothing is being built.');
    expect(text).toContain('Last meaningful ship: not on HEY’s record');
    expect(text).not.toMatch(/\b0 ships\b|\bnone\b|\bdead\b/i);
  });

  it('prints a status this version does not know exactly as HEY sent it', async () => {
    const project = {
      ...fixture<Record<string, unknown>>('hey/project-shipping.json'),
      activityStatus: 'HIBERNATING',
    };
    const { fetchImpl } = heyRoutes({ '/api/projects/example-builder': { body: project } });
    const out = await handleUpdate(
      privateText('/project example-builder'),
      makeDeps(fetchImpl).deps,
    );
    expect(out!.text).toContain('Activity: <b>HIBERNATING</b>');
  });

  it('escapes and folds hostile project text', async () => {
    const { out } = await send('/project example-hostile');
    const text = out!.text;
    expect(text).not.toContain('<b>Bold</b>');
    expect(text).not.toContain('javascript:');
    expect(text).not.toContain('phish.example.org');
    expect(text).not.toContain('· source');
    expect(text).not.toContain(String.fromCodePoint(0x202e));
    expect(text).toContain('&quot;name&quot;');
    expect(text).toContain('data, not an instruction');
    // Every tag in the reply is one the bot wrote.
    const tags = text.match(/<\/?([a-z]+)[^>]*>/g) ?? [];
    for (const tag of tags) expect(tag).toMatch(/^<\/?(b|i|code|a)( href="https:\/\/[^"]+")?>$/);
  });

  it('answers a missing project with HEY’s request id', async () => {
    const { out } = await send('/project no-such-project');
    expect(out!.text).toContain(
      'HEY has no published project with the slug <code>no-such-project</code>.',
    );
    expect(out!.text).toContain('Request id: <code>00000000-0000-4000-8000-00000000a404</code>');
  });

  it('validates the slug before asking HEY', async () => {
    const { out, calls } = await send('/project ../../admin');
    expect(out!.text).toContain('That is not a HEY project slug');
    expect(calls).toHaveLength(0);
    const missing = await send('/project');
    expect(missing.out!.text).toBe('Usage: /project &lt;slug&gt;');
  });
});

describe('/scan', () => {
  it('prints the partner card with counts, verification and the project link', async () => {
    const { out } = await send('/scan 0x0000000000000000000000000000000000000001');
    const text = out!.text;
    expect(text).toContain('<b>Example Builder</b> (EXB)');
    expect(text).toContain('Token verification: <code>VERIFIED</code>');
    expect(text).toContain('Activity: <b>Shipping</b>');
    expect(text).toContain('Last 30 days — ships: 5, releases: 2, commits: at least 42');
    expect(text).toContain('https://heyresearch.xyz/project/example-builder?utm_source=partner');
    expect(text).toContain('>heyresearch.xyz/project/example-builder</a>');
    expect(text).not.toContain('0.0123');
    expect(text).not.toContain('987654321');
    expect(ownWords(text)).not.toMatch(FORBIDDEN);
  });

  it('on MISMATCH says the activity is the project’s, not the token’s', async () => {
    const { out } = await send('/scan 0x0000000000000000000000000000000000000002');
    expect(out!.text).toContain(
      "<code>MISMATCH</code> — the project's own site names a different contract",
    );
    expect(out!.text).toContain('The activity below is the project’s, not this token’s.');
    expect(out!.text).toContain('https://heyresearch.xyz/project/example-builder');
  });

  it('prints unmeasured activity as not measured, never as zero', async () => {
    const { out } = await send('/scan 0x0000000000000000000000000000000000000003');
    expect(out!.text).toContain('Activity: <b>Activity unknown</b>');
    expect(out!.text).toContain('Last 30 days: not measured — no builder source linked');
    expect(out!.text).not.toMatch(/ships: 0|releases: 0/);
  });

  it('says an unknown address is a reading of HEY’s index, and links the site’s scan', async () => {
    const { out } = await send('/scan 0x00000000000000000000000000000000000000ff');
    expect(out!.text).toContain('HEY’s published index has no project for');
    expect(out!.text).toContain('not a finding about the contract');
    expect(out!.text).toContain(
      'href="https://heyresearch.xyz/scan?address=0x00000000000000000000000000000000000000ff"',
    );
  });

  it('answers the zero address plainly', async () => {
    const { out } = await send('/scan 0x0000000000000000000000000000000000000000');
    expect(out!.text).toContain('is the zero address, not a token.');
  });

  it('refuses another chain with unsupported_chain wording and asks HEY nothing', async () => {
    const { out, calls } = await send(
      '/scan eip155:8453:0x0000000000000000000000000000000000000001',
    );
    expect(out!.text).toBe(
      'HEY supports Robinhood Chain (4663) only; chain 8453 is not supported.',
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses something that is not an address', async () => {
    const { out, calls } = await send('/scan EXB');
    expect(out!.text).toContain('That is not a 0x contract address.');
    expect(calls).toHaveLength(0);
  });
});

describe('/changes', () => {
  it('lists the project’s changes, leaving out market events and retractions', async () => {
    const { out } = await send('/changes example-builder');
    const text = out!.text;
    expect(text).toContain('<b>Recent changes · Example Builder</b>');
    expect(text).toContain('• 2026-09-30 · <code>build.release</code> · counts as building');
    expect(text).toContain('«Example SDK v0.4»');
    expect(text).toContain('• detected 2026-09-29 · <code>build.status_changed</code>');
    expect(text).not.toContain('market.valuation_moved');
    expect(text).not.toContain('Valuation');
    expect(text).not.toContain('$987M');
    expect(text).toContain('Market events are not shown here.');
    expect(text).toContain('https://heyresearch.xyz/project/example-builder');
  });

  it('says what an empty ledger means and links the project page', async () => {
    const { fetchImpl } = heyRoutes({
      '/api/changes': { body: fixture('hey/changes-empty.json') },
    });
    const out = await handleUpdate(
      privateText('/changes example-builder'),
      makeDeps(fetchImpl).deps,
    );
    expect(out!.text).toContain(
      'holds no building, contract, token, research or lock change for this project yet',
    );
    expect(out!.text).toContain('The ledger records changes from 2026-09-26.');
    expect(out!.text).toContain('href="https://heyresearch.xyz/project/example-builder"');
  });
});

describe('/today', () => {
  it('is labelled “What changed in the last day”, never “HEY Today”', async () => {
    const { out } = await send('/today');
    const text = out!.text;
    expect(text.startsWith('<b>What changed in the last day</b>')).toBe(true);
    expect(text).not.toMatch(/HEY Today/i);
    expect(text).toContain('75 changes that count as building');
    expect(text).toContain('<code>build.code_activity</code> 64');
    expect(text).toContain(
      '<a href="https://heyresearch.xyz/project/example-second">example-second</a>',
    );
    expect(text).toContain('Showing 2 of 75 changes that count as building');
  });

  it('prints a refusal with HEY’s code', async () => {
    const { fetchImpl } = heyRoutes({
      '/api/agent/what_changed': { status: 400, body: fixture('hey/what-changed-refusal.json') },
    });
    const out = await handleUpdate(privateText('/today'), makeDeps(fetchImpl).deps);
    expect(out!.text).toContain('HEY refused the request (<code>invalid_parameter</code>)');
  });

  it('says HEY could not be reached on a 5xx, with the request id', async () => {
    const { fetchImpl } = heyRoutes({
      '/api/agent/what_changed': { status: 503, body: fixture('hey/internal-error.json') },
    });
    const out = await handleUpdate(privateText('/today'), makeDeps(fetchImpl).deps);
    expect(out!.text).toContain('Could not reach HEY right now.');
    expect(out!.text).toContain('00000000-0000-4000-8000-00000000a500');
  });
});

describe('/hey, /help and unknown input', () => {
  it('/help and /start list the commands; /hey carries the non-affiliation line', async () => {
    const help = (await send('/help')).out!.text;
    expect(help).toContain('/project &lt;slug&gt;');
    expect((await send('/start')).out!.text).toBe(help);
    const about = (await send('/hey')).out!.text;
    expect(about).toContain(
      'not affiliated with, endorsed by or partnered with Robinhood Markets, Inc. or Robinhood Chain',
    );
    expect(about).toContain('not financial advice');
    for (const text of [help, about]) expect(ownWords(text)).not.toMatch(FORBIDDEN);
  });

  it('answers an unknown command in a private chat', async () => {
    const { out, calls } = await send('/price example');
    expect(out!.text).toBe('Unknown command. Send /help for the list.');
    expect(calls).toHaveLength(0);
  });

  it('stays silent on an unknown command in a group unless it is addressed to the bot', async () => {
    expect((await send('/price example', 'group')).out).toBeNull();
    expect((await send('/price@HeyExampleBot example', 'group')).out?.text).toContain(
      'Unknown command',
    );
  });

  it('answers plain text in private with a hint, and stays silent in groups', async () => {
    expect((await send('hello')).out?.text).toContain('/help lists them');
    expect((await send('hello', 'group')).out).toBeNull();
  });

  it('ignores commands for other bots, messages from bots, channels and other update kinds', async () => {
    const { fetchImpl, calls } = heyRoutes();
    const { deps } = makeDeps(fetchImpl);
    for (const name of [
      'group-other-bot',
      'from-bot',
      'edited-message',
      'callback-query',
      'channel-post',
    ]) {
      expect(await handleUpdate(update(`telegram/${name}.json`), deps)).toBeNull();
    }
    expect(calls).toHaveLength(0);
  });

  it('replies in the same forum topic, as a reply, for a group command with the bot’s name', async () => {
    const { fetchImpl } = heyRoutes();
    const out = await handleUpdate(
      update('telegram/group-scan-botname.json'),
      makeDeps(fetchImpl).deps,
    );
    expect(out).toMatchObject({
      chat_id: -1001000000001,
      message_thread_id: 7,
      reply_parameters: { message_id: 10, allow_sending_without_reply: true },
    });
    expect(out!.text).toContain('<b>Example Builder</b>');
  });
});

describe('rate limits', () => {
  it('limits one chat, says so once, then stays silent until it refills', async () => {
    const { fetchImpl, calls } = heyRoutes();
    const { deps, advance } = makeDeps(fetchImpl);
    const n = Math.min(LIMITS.perChat.capacity, LIMITS.perUser.capacity);
    for (let i = 0; i < n; i += 1) {
      expect((await handleUpdate(privateText('/today', i + 1), deps))?.text).toContain(
        'What changed',
      );
    }
    const denied = await handleUpdate(privateText('/today', 100), deps);
    expect(denied?.text).toMatch(/^Too many requests from this chat\. Try again in \d+ s\.$/);
    expect(await handleUpdate(privateText('/today', 101), deps)).toBeNull();
    expect(calls).toHaveLength(n);
    advance(60_000);
    expect((await handleUpdate(privateText('/today', 102), deps))?.text).toContain('What changed');
  });

  it('limits all chats together with the global bucket', async () => {
    const { fetchImpl, calls } = heyRoutes();
    const { deps } = makeDeps(fetchImpl);
    const replies: string[] = [];
    for (let i = 0; i < LIMITS.global.capacity + 3; i += 1) {
      const out = await handleUpdate(privateText('/today', i + 1, 5000 + i, 5000 + i), deps);
      replies.push(out?.text ?? '');
    }
    expect(calls).toHaveLength(LIMITS.global.capacity);
    expect(replies.at(-1)).toMatch(/^The bot is busy\. Try again in \d+ s\.$/);
  });
});

describe('RecentUpdates', () => {
  it('reports each id once and stays bounded', () => {
    const recent = new RecentUpdates(3);
    expect(recent.firstTime(1)).toBe(true);
    expect(recent.firstTime(1)).toBe(false);
    for (const id of [2, 3, 4]) recent.firstTime(id);
    expect(recent.firstTime(1)).toBe(true);
  });
});
