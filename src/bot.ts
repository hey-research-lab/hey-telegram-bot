import { parseAddressArg, parseCommandText, parseSlugArg } from './commands/parse.js';
import { toBotError, type HeyGateway } from './hey/gateway.js';
import type { Logger } from './log.js';
import type { Limiters } from './ratelimit.js';
import {
  renderAbout,
  renderArgError,
  renderBusy,
  renderChanges,
  renderError,
  renderHelp,
  renderNotACommand,
  renderProject,
  renderRateLimited,
  renderScan,
  renderToday,
  renderUnknownCommand,
} from './render/replies.js';
import type { OutgoingMessage, TelegramMessage, TelegramUpdate } from './telegram/update.js';

/**
 * One update in, at most one message out. Shared by webhook and polling mode.
 *
 * Stateless apart from the in-memory rate limits: no accounts, no watchlist,
 * nothing written anywhere. In a group the bot answers its own commands and
 * stays silent otherwise; in a private chat it also answers plain text with a
 * hint.
 */

export type BotDeps = {
  hey: HeyGateway;
  limiters: Limiters;
  botUsername: string;
  /** Where project pages live when HEY's answer does not carry a URL. */
  siteBase: string;
  log: Logger;
  now?: () => number;
};

/** How many changes `/changes` and `/today` show. */
export const LIST_LIMIT = 5;

function reply(message: TelegramMessage, text: string): OutgoingMessage {
  return {
    chat_id: message.chat.id,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(message.message_thread_id !== undefined
      ? { message_thread_id: message.message_thread_id }
      : {}),
    ...(message.chat.type === 'private'
      ? {}
      : {
          reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
        }),
  };
}

export async function handleUpdate(
  update: TelegramUpdate,
  deps: BotDeps,
): Promise<OutgoingMessage | null> {
  const message = update.message;
  if (!message || message.text === undefined) return null;
  if (message.from?.is_bot) return null;
  if (message.chat.type === 'channel') return null;
  const isPrivate = message.chat.type === 'private';

  const parsed = parseCommandText(message.text, deps.botUsername);
  if (parsed.kind === 'not_for_us') return null;
  if (parsed.kind === 'not_a_command')
    return isPrivate ? reply(message, renderNotACommand()) : null;
  if (!parsed.known && !isPrivate && !parsed.addressed) return null;

  const started = (deps.now ?? Date.now)();
  const chatDecision = deps.limiters.chat.take(`c:${message.chat.id}`);
  const userDecision = message.from
    ? deps.limiters.user.take(`u:${message.from.id}`)
    : ({ allowed: true } as const);
  for (const decision of [chatDecision, userDecision]) {
    if (!decision.allowed) {
      deps.log.info('rate_limited', { scope: 'chat_or_user', chatType: message.chat.type });
      return decision.firstDenial
        ? reply(message, renderRateLimited(decision.retryAfterSeconds))
        : null;
    }
  }

  const finish = (command: string, outcome: string, text: string, errorCode?: string) => {
    deps.log.info('command', {
      command,
      chatType: message.chat.type,
      outcome,
      ...(errorCode ? { errorCode } : {}),
      ms: (deps.now ?? Date.now)() - started,
    });
    return reply(message, text);
  };

  if (!parsed.known) return finish('unknown', 'unknown_command', renderUnknownCommand());

  const name = parsed.name;
  if (name === 'help' || name === 'start') return finish(name, 'ok', renderHelp());
  if (name === 'hey') return finish(name, 'ok', renderAbout());

  // Everything below asks HEY: validate first, then spend from the global bucket.
  let run: () => Promise<string>;
  let subject: string | undefined;
  if (name === 'scan') {
    const arg = parseAddressArg(parsed.args);
    if (!arg.ok)
      return finish(
        name,
        'invalid_argument',
        renderArgError('scan', arg.code, arg.chainId),
        arg.code,
      );
    subject = arg.value;
    const address = arg.value;
    run = async () => renderScan(await deps.hey.scan(address), address);
  } else if (name === 'project' || name === 'changes') {
    const arg = parseSlugArg(parsed.args);
    if (!arg.ok) return finish(name, 'invalid_argument', renderArgError(name, arg.code), arg.code);
    const slug = arg.value;
    subject = slug;
    run =
      name === 'project'
        ? async () => renderProject(await deps.hey.project(slug))
        : async () => renderChanges(slug, await deps.hey.changes(slug, LIST_LIMIT), deps.siteBase);
  } else {
    run = async () => renderToday(await deps.hey.whatChangedToday(LIST_LIMIT));
  }

  const global = deps.limiters.global.take('global');
  if (!global.allowed) {
    deps.log.warn('rate_limited', { scope: 'global', chatType: message.chat.type });
    return finish(name, 'busy', renderBusy(global.retryAfterSeconds), 'busy');
  }

  try {
    return finish(name, 'ok', await run());
  } catch (error) {
    const botError = toBotError(error);
    if (botError.code === 'internal_error') deps.log.error('handler_failed', { error });
    return finish(
      name,
      'error',
      renderError(botError, { command: name, ...(subject && name !== 'scan' ? { subject } : {}) }),
      botError.code,
    );
  }
}

/** Remembers recent update ids so a webhook retry is answered once. Bounded. */
export class RecentUpdates {
  private readonly seen = new Set<number>();
  constructor(private readonly max = 1000) {}

  /** True the first time an id is seen. */
  firstTime(id: number): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > this.max) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }
}
