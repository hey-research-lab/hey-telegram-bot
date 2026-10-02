# Security policy

## Reporting a vulnerability

Please report privately through GitHub's "Report a vulnerability" (Security → Advisories) on this
repository, or email hi@heyresearch.xyz with "security" in the subject. Do not open a public issue.
We aim to acknowledge within 3 working days. There is no bug bounty for this repository.

## Scope

The bot takes untrusted input from two places and treats both as data:

- **Telegram webhook requests.** Anyone on the internet can reach the webhook URL. The bot checks
  the `X-Telegram-Bot-Api-Secret-Token` header in constant time (SHA-256 digests compared with
  `timingSafeEqual`) before reading the body, refuses bodies over 64 KB (declared or streamed),
  refuses JSON containing `__proto__`, `constructor` or `prototype` keys, and validates every
  update with a schema that drops unknown fields. A retried update is answered once. At most 32
  updates are handled at once.
- **Text from HEY's API.** Project names, release titles, descriptions and summaries are a
  source's words. They are folded onto one line, stripped of control, invisible and
  bidirectional-override characters, tags and chat-template tokens, bounded and HTML-escaped
  before they reach Telegram. Links are printed only for plain `https:` URLs, with the URL escaped.
  Every HEY answer is validated, read up to 1 MB with a 10 s timeout, and fetched only from the
  configured HEY origin; a redirect to another host is refused.

Command arguments are validated before anything is sent to HEY: an address must be a 0x address
(or a CAIP-10 id on chain 4663), a slug must match HEY's slug pattern. The bot never fetches a URL
found in a message or in an answer, starts no child process and writes nothing to disk.

Abuse limits are in memory: 8 commands a minute per chat, 6 per person, 60 HEY calls a minute
across all chats.

## Handling secrets

This project never needs HEY credentials and sends none. The Telegram bot token and webhook
secret are read from the environment, never logged, never written to disk, and redacted from
errors and log lines (by value, and any bot-token shape by pattern). Telegram request URLs, which
contain the token, are never logged or put in an error message. The Docker image contains no
secret; pass them at run time. Never commit a `.env` with values.

## Supported versions

The latest 0.x minor receives fixes.
