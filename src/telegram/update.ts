import { z } from 'zod';

/**
 * The part of a Telegram `Update` the bot reads, validated.
 *
 * Only `message` updates with text are handled; every other update kind is
 * acknowledged and ignored. Unknown fields are dropped by the schema, so
 * nothing the bot passes on is the raw object Telegram (or anyone holding the
 * webhook secret) sent.
 */

/** The largest webhook body the bot reads. Telegram's own updates are far smaller. */
export const MAX_UPDATE_BYTES = 64 * 1024;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class UpdateParseError extends Error {
  readonly code: 'invalid_json' | 'forbidden_key' | 'invalid_update';
  constructor(code: UpdateParseError['code'], message: string) {
    super(message);
    this.name = 'UpdateParseError';
    this.code = code;
  }
}

/** `JSON.parse` that refuses `__proto__`, `constructor` and `prototype` keys anywhere. */
export function parseJsonStrict(text: string): unknown {
  try {
    return JSON.parse(text, (key, value: unknown) => {
      if (FORBIDDEN_KEYS.has(key)) throw new UpdateParseError('forbidden_key', 'forbidden key');
      return value;
    });
  } catch (error) {
    if (error instanceof UpdateParseError) throw error;
    throw new UpdateParseError('invalid_json', 'body is not JSON');
  }
}

const chatSchema = z.object({
  id: z.number().int(),
  type: z.enum(['private', 'group', 'supergroup', 'channel']),
});

const userSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean(),
});

const messageSchema = z.object({
  message_id: z.number().int(),
  message_thread_id: z.number().int().optional(),
  date: z.number().int(),
  chat: chatSchema,
  from: userSchema.optional(),
  text: z.string().max(4096).optional(),
});

export const updateSchema = z.object({
  update_id: z.number().int().min(0),
  message: messageSchema.optional(),
});

export type TelegramUpdate = z.infer<typeof updateSchema>;
export type TelegramMessage = z.infer<typeof messageSchema>;
export type ChatType = z.infer<typeof chatSchema>['type'];

/** Parses and validates one update from its raw JSON text. */
export function parseUpdate(text: string): TelegramUpdate {
  const raw = parseJsonStrict(text);
  const result = updateSchema.safeParse(raw);
  if (!result.success) throw new UpdateParseError('invalid_update', 'not a Telegram update');
  return result.data;
}

/** What the bot sends back: one `sendMessage`. */
export type OutgoingMessage = {
  chat_id: number;
  text: string;
  parse_mode: 'HTML';
  link_preview_options: { is_disabled: true };
  message_thread_id?: number;
  reply_parameters?: { message_id: number; allow_sending_without_reply: true };
};
