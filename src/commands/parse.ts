import { CHAIN_ID } from '../chain.js';
import { ADDRESS_RE } from '../evm.js';

/**
 * Command parsing and argument validation.
 *
 * Telegram sends `/command`, `/command args` or, in groups, `/command@BotName
 * args`. A command addressed to another bot is not for this one and is
 * ignored. Arguments are validated before anything reaches HEY: an address
 * must be a 0x address (the prefix may be `0X`; it is lower-cased) or a CAIP-10
 * id on Robinhood Chain, and a slug must match HEY's slug pattern.
 */

export const COMMANDS = ['hey', 'start', 'help', 'scan', 'project', 'changes', 'today'] as const;
export type CommandName = (typeof COMMANDS)[number];

export type ParsedText =
  | { kind: 'command'; name: string; known: boolean; args: string; addressed: boolean }
  | { kind: 'not_for_us' }
  | { kind: 'not_a_command' };

const COMMAND_RE = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?=\s|$)([\s\S]*)$/;
/** Arguments longer than this are refused, not read. */
export const MAX_ARGS_LENGTH = 200;

export function parseCommandText(text: string, botUsername: string): ParsedText {
  const match = COMMAND_RE.exec(text.trimStart());
  if (!match) return { kind: 'not_a_command' };
  const [, rawName = '', suffix, rest = ''] = match;
  if (suffix !== undefined && suffix.toLowerCase() !== botUsername.toLowerCase()) {
    return { kind: 'not_for_us' };
  }
  const name = rawName.toLowerCase();
  return {
    kind: 'command',
    name,
    known: (COMMANDS as readonly string[]).includes(name),
    args: rest.trim(),
    addressed: suffix !== undefined,
  };
}

export type ArgResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: 'missing_argument' | 'invalid_address' | 'unsupported_chain' | 'invalid_slug';
      chainId?: string;
    };

const CAIP10_RE = /^eip155:(\d{1,12}):(0[xX][0-9a-fA-F]{40})$/;

/** A Robinhood Chain address from `/scan` arguments, lower-cased. */
export function parseAddressArg(args: string): ArgResult<string> {
  const first = args.split(/\s+/)[0] ?? '';
  if (!first) return { ok: false, code: 'missing_argument' };
  if (first.length > MAX_ARGS_LENGTH) return { ok: false, code: 'invalid_address' };
  const caip = CAIP10_RE.exec(first);
  if (caip) {
    const [, chain = '', address = ''] = caip;
    if (chain !== String(CHAIN_ID)) return { ok: false, code: 'unsupported_chain', chainId: chain };
    return normalize(address);
  }
  return normalize(first);
}

function normalize(candidate: string): ArgResult<string> {
  const value = candidate.startsWith('0X') ? `0x${candidate.slice(2)}` : candidate;
  if (!ADDRESS_RE.test(value)) return { ok: false, code: 'invalid_address' };
  return { ok: true, value: value.toLowerCase() };
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;
const PROJECT_URL_RE = /^https:\/\/(?:www\.)?heyresearch\.xyz\/project\/([A-Za-z0-9-]{1,120})\/?$/;

/** A project slug from arguments: the slug itself, or a HEY project page URL. */
export function parseSlugArg(args: string): ArgResult<string> {
  const first = args.split(/\s+/)[0] ?? '';
  if (!first) return { ok: false, code: 'missing_argument' };
  if (first.length > MAX_ARGS_LENGTH) return { ok: false, code: 'invalid_slug' };
  const fromUrl = PROJECT_URL_RE.exec(first)?.[1];
  const slug = (fromUrl ?? first).toLowerCase();
  if (!SLUG_RE.test(slug)) return { ok: false, code: 'invalid_slug' };
  return { ok: true, value: slug };
}
