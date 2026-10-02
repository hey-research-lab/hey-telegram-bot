import { CHAIN_NAME } from '../chain.js';
import type { BotError } from '../hey/gateway.js';
import type { ChangesPage, Project, ScanCard, WhatChanged } from '../hey/schemas.js';
import {
  STILL_BUILDING_WORDS,
  TOKEN_VERIFICATION_WORDS,
  activityWords,
  researchLevelLabel,
} from '../words.js';
import { bold, code, escapeHtml, external, joinWithinBudget, link, quoted } from './html.js';

/**
 * Every reply the bot sends, as Telegram HTML.
 *
 * The rules each renderer keeps:
 * - HEY's state words exactly; an UNKNOWN stays UNKNOWN, an absent count is
 *   "not measured", never 0 or "none".
 * - Every project fact links the project's page on HEY.
 * - A source's words (names, titles, summaries) are folded, escaped and, where
 *   they are quoted, set in «…».
 * - No market figures: the schemas the replies read do not carry them.
 * - HEY's own disclaimer, one line, under any reply that relays its research.
 */

export const SITE = 'https://heyresearch.xyz';
export const REPO_URL = 'https://github.com/hey-research-lab/hey-telegram-bot';
export const NON_AFFILIATION =
  'HEY Research Lab is an independent research project and is not affiliated with, endorsed by or partnered with Robinhood Markets, Inc. or Robinhood Chain.';

/** `2026-10-02`, with how much of the date the source gave. */
export function formatWhen(iso: string | null | undefined, precision?: string): string {
  if (!iso) return 'date unknown';
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 'date unknown';
  const day = new Date(time).toISOString().slice(0, 10);
  switch (precision) {
    case 'WEEK':
      return `week of ${day}`;
    case 'OBSERVED':
      return `observed ${day}`;
    default:
      return day;
  }
}

const footer = (disclaimer: string | undefined): string[] =>
  disclaimer ? ['', `<i>${external(disclaimer, 600)}</i>`] : [];

/** A source's words in bold: folded, bounded and escaped first. */
const boldExternal = (raw: string): string => `<b>${external(raw, 120)}</b>`;

const pageLabel = (url: string): string => url.replace(/^https:\/\//, '');

export function renderHelp(): string {
  return [
    bold('HEY Research bot'),
    'Read-only lookups of HEY Research Lab’s public builder records on Robinhood Chain.',
    '',
    '/project &lt;slug&gt; — a project: activity status, last ship, research level',
    '/scan &lt;address&gt; — which project HEY records for a Robinhood Chain contract',
    '/changes &lt;slug&gt; — a project’s recent building, contract and research changes',
    '/today — what changed in the last day (changes that count as building)',
    '/hey — about HEY Research and this bot',
    '/help — this list',
    '',
    `Example: ${code('/project hey-research')}`,
  ].join('\n');
}

export function renderAbout(): string {
  return [
    bold('HEY Research'),
    'HEY finds which projects on Robinhood Chain are still building, what they have shipped, and the public evidence behind each record.',
    '',
    'This bot relays HEY’s public API and nothing else. It keeps no accounts, no watchlists and no message history.',
    'Activity status is a record of development, not a view on a token. An unknown value means HEY does not know — not zero. Nothing the bot sends is financial advice or a safety verdict.',
    '',
    `${link(SITE, 'heyresearch.xyz')} · ${link(`${SITE}/docs/public-api`, 'Public API')} · ${link(REPO_URL, 'Source')}`,
    '',
    `<i>${escapeHtml(NON_AFFILIATION)}</i>`,
  ].join('\n');
}

export function renderProject(p: Project): string {
  const title = `${boldExternal(p.name)}${p.symbol ? ` (${external(p.symbol, 40)})` : ''}`;
  const narrative = p.primaryNarrative ? ` · ${external(p.primaryNarrative.name, 80)}` : '';
  const lines: string[] = [`${title}${narrative}`];
  if (p.shortDescription) lines.push(external(p.shortDescription));
  lines.push('');

  const words = activityWords(p);
  lines.push(`Activity: ${bold(words.label)}${words.help ? ` — ${escapeHtml(words.help)}` : ''}`);
  lines.push(
    p.lastShippedAt
      ? `Last meaningful ship: ${formatWhen(p.lastShippedAt)}`
      : 'Last meaningful ship: not on HEY’s record',
  );
  const newest = p.ships?.[0];
  if (newest) {
    const source = newest.sourceUrl ? ` · ${link(newest.sourceUrl, 'source')}` : '';
    lines.push(
      `Newest ship: ${quoted(newest.title, 160)} · ${formatWhen(newest.publishedAt, newest.precision)}${
        newest.verification ? ` · ${code(newest.verification)}` : ''
      }${source}`,
    );
  }
  if (p.researchLevel)
    lines.push(`Research level: ${escapeHtml(researchLevelLabel(p.researchLevel))}`);
  if (p.stillBuildingState) {
    const state = STILL_BUILDING_WORDS[p.stillBuildingState] ?? p.stillBuildingState;
    lines.push(`Still Building: ${escapeHtml(state)}`);
  }
  if (p.token) {
    const tv = p.tokenVerification?.status;
    lines.push(
      `Token: ${code(p.token.contractAddress)}${
        tv
          ? ` · ${code(tv)}${TOKEN_VERIFICATION_WORDS[tv] ? ` — ${escapeHtml(TOKEN_VERIFICATION_WORDS[tv])}` : ''}`
          : ''
      }`,
    );
  }
  lines.push('', `Open on HEY: ${link(p.url, pageLabel(p.url))}`);
  return joinWithinBudget(lines, footer(p.disclaimer));
}

export function renderScan(card: ScanCard, address: string): string {
  if (!card.found) {
    if (card.reason === 'not_a_token') {
      return `${code(address)} is the zero address, not a token.`;
    }
    if (card.reason === 'chain') {
      return 'HEY supports Robinhood Chain (4663) only.';
    }
    const lines = [
      `HEY’s published index has no project for ${code(address)} on ${escapeHtml(CHAIN_NAME)}.`,
      'That is a reading of HEY’s index, not a finding about the contract.',
    ];
    if (card.scan_url)
      lines.push(`Look it up on HEY: ${link(card.scan_url, 'heyresearch.xyz/scan')}`);
    return joinWithinBudget(lines, footer(card.disclaimer));
  }

  const lines: string[] = [
    `${boldExternal(card.project.name)}${card.project.symbol ? ` (${external(card.project.symbol, 40)})` : ''}`,
    `Contract ${code(card.contractAddress)} on ${escapeHtml(CHAIN_NAME)}`,
  ];
  if (card.token_verification) {
    const gloss = TOKEN_VERIFICATION_WORDS[card.token_verification];
    lines.push(
      `Token verification: ${code(card.token_verification)}${gloss ? ` — ${escapeHtml(gloss)}` : ''}`,
    );
  }
  if (card.activity_applies_to_token === false) {
    lines.push('The activity below is the project’s, not this token’s.');
  }
  lines.push('');
  lines.push(
    `Activity: ${boldExternal(card.status_label)}${card.status_help ? ` — ${external(card.status_help)}` : ''}`,
  );
  if (card.research_level) {
    lines.push(`Research level: ${escapeHtml(researchLevelLabel(card.research_level))}`);
  }
  lines.push(scanActivityLine(card));
  const a = card.activity;
  if (a?.last_ship) {
    const title = a.last_ship_title ? ` ${quoted(a.last_ship_title, 160)}` : '';
    const source = a.last_ship_url ? ` · ${link(a.last_ship_url, 'source')}` : '';
    lines.push(`Last ship: ${formatWhen(a.last_ship)}${title}${source}`);
  }
  const page = card.cta?.url ?? card.project_url;
  lines.push('', `Open on HEY: ${link(page, pageLabel(page))}`);
  return joinWithinBudget(lines, footer(card.disclaimer));
}

function scanActivityLine(card: Extract<ScanCard, { found: true }>): string {
  if (card.activity_measured === false) {
    const why =
      card.coverage === 'no_source'
        ? 'no builder source linked'
        : card.coverage === 'not_researched'
          ? 'not researched yet'
          : 'HEY has not measured it';
    return `Last 30 days: not measured — ${escapeHtml(why)}`;
  }
  const a = card.activity;
  const count = (n: number | undefined, noun: string): string =>
    n === undefined ? `${noun}: not measured` : `${noun}: ${n}`;
  const commits =
    a?.commits_30d === undefined
      ? 'commits: not measured'
      : `commits: ${a.commits_30d_partial ? 'at least ' : ''}${a.commits_30d}`;
  return `Last 30 days — ${count(a?.ships_30d, 'ships')}, ${count(a?.releases_30d, 'releases')}, ${commits}`;
}

export function renderChanges(slug: string, page: ChangesPage, siteBase: string): string {
  const items = page.items.filter(
    (i): i is Extract<ChangesPage['items'][number], { op: 'upsert' }> =>
      i.op === 'upsert' && i.domain !== 'market' && !i.type.startsWith('market'),
  );
  const first = items[0];
  const name = first ? external(first.project.name, 120) : escapeHtml(slug);
  const projectUrl = first?.project.url ?? `${siteBase}/project/${slug}`;
  const lines: string[] = [`<b>Recent changes · ${name}</b>`];
  if (items.length === 0) {
    lines.push(
      'HEY’s change ledger holds no building, contract, token, research or lock change for this project yet.',
    );
    if (page.ledger?.collectionStart) {
      lines.push(`The ledger records changes from ${formatWhen(page.ledger.collectionStart)}.`);
    }
  } else {
    for (const item of items) {
      const when = item.occurredAt
        ? formatWhen(item.occurredAt, item.precision)
        : `detected ${formatWhen(item.detectedAt)}`;
      const building = item.countsAsBuilding ? ' · counts as building' : '';
      lines.push(`• ${when} · ${code(item.type)}${building}`);
      lines.push(`  ${quoted(item.summary, 200)}`);
    }
    if (page.hasMore) lines.push('Older changes are on the project page.');
  }
  lines.push('Market events are not shown here.');
  lines.push('', `Open on HEY: ${link(projectUrl, pageLabel(projectUrl))}`);
  return joinWithinBudget(lines, footer(page.disclaimer));
}

export function renderToday(answer: WhatChanged): string {
  const data = answer.data;
  const lines: string[] = [bold('What changed in the last day')];
  lines.push(external(answer.answer.text, 600));
  if (data) {
    if (data.byType.length > 0) {
      lines.push(`By type: ${data.byType.map((t) => `${code(t.type)} ${t.count}`).join(' · ')}`);
    }
    lines.push('');
    for (const item of data.items) {
      const when = item.occurredAt
        ? formatWhen(item.occurredAt, item.precision)
        : `detected ${formatWhen(item.detectedAt)}`;
      lines.push(`• ${when} · ${link(item.project.url, item.project.slug)} · ${code(item.type)}`);
      lines.push(`  ${quoted(item.summary.text, 200)}`);
    }
    lines.push('');
    lines.push(
      `Showing ${data.shown} of ${data.total} changes that count as building (window ${formatWhen(data.window.from)} to ${formatWhen(data.window.to)}, UTC).`,
    );
  }
  lines.push(`More on HEY: ${link(SITE, 'heyresearch.xyz')}`);
  return joinWithinBudget(lines, footer(answer.boundaries?.disclaimer.text));
}

export function renderArgError(
  command: 'scan' | 'project' | 'changes',
  code_: 'missing_argument' | 'invalid_address' | 'unsupported_chain' | 'invalid_slug',
  chainId?: string,
): string {
  const usage = command === 'scan' ? '/scan &lt;address&gt;' : `/${command} &lt;slug&gt;`;
  switch (code_) {
    case 'missing_argument':
      return `Usage: ${usage}`;
    case 'invalid_address':
      return `That is not a 0x contract address. Usage: ${usage}`;
    case 'unsupported_chain':
      return `HEY supports Robinhood Chain (4663) only; chain ${escapeHtml(chainId ?? 'unknown')} is not supported.`;
    case 'invalid_slug':
      return `That is not a HEY project slug (lowercase letters, digits and dashes). Usage: ${usage}`;
  }
}

export function renderError(
  error: BotError,
  context: { command: string; subject?: string },
): string {
  const lines: string[] = [];
  if (error.code === 'not_found' && context.command !== 'today') {
    lines.push(
      context.subject
        ? `HEY has no published project with the slug ${code(context.subject)}.`
        : 'HEY has no published record for that.',
    );
  } else if (error.code === 'rate_limited' || error.code === 'quota') {
    lines.push(
      `HEY’s API asked the bot to slow down.${error.retryAfterSeconds ? ` Try again in ${error.retryAfterSeconds} s.` : ' Try again shortly.'}`,
    );
  } else if (
    error.code === 'network' ||
    error.code === 'timeout' ||
    error.code === 'unavailable' ||
    error.code === 'service_unavailable' ||
    (error.status !== undefined && error.status >= 500)
  ) {
    lines.push('Could not reach HEY right now. Try again later.');
  } else if (error.code === 'unexpected_response') {
    lines.push('HEY answered in a shape this bot does not read. The bot may need an update.');
  } else if (error.code === 'internal_error') {
    lines.push('Something went wrong in the bot.');
  } else {
    lines.push(`HEY refused the request (${code(error.code)}): ${external(error.message, 300)}`);
  }
  if (error.requestId) lines.push(`Request id: ${code(error.requestId)}`);
  return lines.join('\n');
}

export function renderRateLimited(retryAfterSeconds: number): string {
  return `Too many requests from this chat. Try again in ${retryAfterSeconds} s.`;
}

export function renderBusy(retryAfterSeconds: number): string {
  return `The bot is busy. Try again in ${retryAfterSeconds} s.`;
}

export function renderUnknownCommand(): string {
  return 'Unknown command. Send /help for the list.';
}

export function renderNotACommand(): string {
  return 'Send a command, such as /project &lt;slug&gt; or /scan &lt;address&gt;. /help lists them.';
}
