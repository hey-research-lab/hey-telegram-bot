# hey-telegram-bot

A self-hostable, read-only Telegram bot that answers HEY Research Lab lookups about Robinhood
Chain projects, using nothing but HEY's public API.

[![CI](https://github.com/hey-research-lab/hey-telegram-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/hey-research-lab/hey-telegram-bot/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](package.json)
[![Robinhood Chain 4663](https://img.shields.io/badge/Robinhood%20Chain-4663-black.svg)](#why-robinhood-chain-only)

## Why it exists

Robinhood Chain communities talk in Telegram, and the question that comes up there is the one HEY
answers: is anyone still building this, and what did they ship? This bot lets a community run that
lookup in its own group, on its own server, without an account with HEY and without access to
HEY's database. It is stateless: it keeps no accounts, no watchlists and no message history.

## Why Robinhood Chain only

HEY researches Robinhood Chain (chain id `4663`, CAIP-2 `eip155:4663`) and nothing else. The bot
asks HEY about chain 4663 only; a CAIP-10 address on another chain (`eip155:8453:0x…`) is refused
with HEY's `unsupported_chain` wording, before anything is sent to HEY.

## Install

You need Docker (or Node 22+), a bot token from [@BotFather](https://t.me/BotFather) and, for
webhook mode, a public HTTPS URL. The full walkthrough is [docs/SETUP.md](docs/SETUP.md).

```sh
git clone https://github.com/hey-research-lab/hey-telegram-bot.git
cd hey-telegram-bot
cp .env.example .env                                  # fill in the token and a webhook secret
cp docker-compose.example.yml docker-compose.yml
docker compose up -d --build
docker compose run --rm hey-telegram-bot set-webhook https://bot.example.org/telegram/webhook
```

The bot is not published to npm; build the image yourself from this repository.

## Smallest working example

Long polling needs no public URL, so it is the quickest way to try the bot on your own machine:

```sh
corepack enable
pnpm install
cp .env.example .env        # set TELEGRAM_BOT_TOKEN; the webhook secret can stay empty
pnpm dev:polling
```

Then message your bot:

```
/project hey-research-lab
```

## Commands

| Command           | What it answers                                                                                                                                                                                                                                                  | HEY endpoint                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `/project <slug>` | A project's activity status in HEY's words, last meaningful ship, newest ship with its verification state, research level, Still Building state, tracked token and its verification, and the link to its HEY page. A HEY project URL works in place of the slug. | `GET /api/projects/{slug}`                                            |
| `/scan <address>` | Which project HEY records for a Robinhood Chain contract: status, token verification, 30-day activity counts, last ship, project link. `0X` prefixes and `eip155:4663:` ids are accepted.                                                                        | `GET /api/v1/scan?chain=4663&token=`                                  |
| `/changes <slug>` | The newest five changes in HEY's change ledger for a project — building, contract, token, research and lock domains. Market events are left out.                                                                                                                 | `GET /api/changes?project=&domain=build,contract,token,research,lock` |
| `/today`          | What changed in the last day: changes that count as building across Robinhood Chain projects, with true totals by type and the newest five.                                                                                                                      | `GET /api/agent/what_changed?days=1&building=only`                    |
| `/hey`            | About HEY Research and this bot.                                                                                                                                                                                                                                 | —                                                                     |
| `/help`, `/start` | The command list.                                                                                                                                                                                                                                                | —                                                                     |

`/scan` reads the same lookup HEY's partner integrations use. It never calls `POST /api/scan`,
the live chain read HEY keeps for its own site; an address HEY has not published answers with a
link to that page instead. `/today` is not HEY's "Today" page (which has no API): it restates the
agent contract's `what_changed` answer for a one-day window, and says so.

In groups the bot answers its own commands (`/project` or `/project@YourBot`) and ignores
everything else, including commands addressed to other bots. In a private chat it also answers
plain text with a hint.

### What a reply contains

- HEY's state words exactly: `Shipping`, `Active`, `Quiet`, `Dormant`, `Resumed building`,
  `Activity unknown` (or HEY's reason, such as `No builder source linked`), `VERIFIED`,
  `UNVERIFIED`, `MISMATCH`, `PUBLICLY_VERIFIED`, `SELF_REPORTED`… A status this version does not
  know is printed as HEY sent it. `DORMANT` is never "dead".
- Unknown stays unknown: an absent count prints as "not measured", never `0`; an address HEY has
  not published is "no project in HEY's published index", a reading of one index, not a finding,
  and, when HEY says so, whether it holds the token (a launch record not researched yet, a token
  it has not published, or one it has not indexed) — never a verdict on the token.
- Dates at the precision HEY gives them: a code week reads "week of" its UTC Monday, as HEY
  names it.
- A link to the project's page on heyresearch.xyz with every project fact.
- HEY's own one-line disclaimer.
- No prices, market caps, liquidity, volume or trade counts — the bot does not read them — and
  never a recommendation.

Names, release titles and summaries are a source's words. They are folded onto one line, stripped
of control, invisible and bidirectional-override characters, tags and chat-template tokens,
bounded, HTML-escaped and quoted «…»; words that read like an instruction to a model are flagged
as data.

### Run modes

```
hey-telegram-bot webhook                  serve Telegram's webhook on PORT (default)
hey-telegram-bot polling                  long-poll Telegram (local development)
hey-telegram-bot set-webhook <https-url>  register the webhook, its secret token and the command menu
hey-telegram-bot delete-webhook           remove the webhook (needed before polling)
hey-telegram-bot healthcheck              exit 0 when the local server answers /healthz
```

HTTP endpoints in webhook mode: `POST /telegram/webhook` (Telegram's updates) and `GET /healthz`.

### Configuration

| Variable                  | Required     | Default                   | Meaning                                                                                              |
| ------------------------- | ------------ | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`      | yes          | —                         | The token from @BotFather.                                                                           |
| `TELEGRAM_WEBHOOK_SECRET` | webhook mode | —                         | 32–256 characters of `A-Z a-z 0-9 _ -`; Telegram sends it back in `X-Telegram-Bot-Api-Secret-Token`. |
| `HEY_BASE_URL`            | no           | `https://heyresearch.xyz` | Tests and local mocks only; leave empty. `https` origin, no path.                                    |
| `PORT`                    | no           | `8080`                    | The webhook server's port.                                                                           |
| `LOG_LEVEL`               | no           | `info`                    | `debug`, `info`, `warn` or `error`.                                                                  |

### Limits

| Limit                          | Value                                           |
| ------------------------------ | ----------------------------------------------- |
| Webhook body                   | 64 KB                                           |
| Per chat                       | 8 commands a minute                             |
| Per person                     | 6 commands a minute                             |
| All chats together (HEY calls) | 60 a minute — half of HEY's anonymous allowance |
| HEY answer read                | 1 MB, 10 s timeout                              |
| Updates in flight              | 32 (more answer `503`; Telegram retries)        |

A chat over its limit is told once, then the bot stays silent until the limit refills. Limits are
in memory and reset when the process restarts.

### Optional local watch state

Out of scope for v0.1. The bot keeps no state beyond its in-memory rate limits and the ids of the
last thousand updates (so a retried webhook is answered once). Watching a project and posting its
changes to a group would need local storage and a scheduler; if it is added later, it will be
opt-in, stored on the operator's own disk and independent of any HEY account.

## How it relates to HEY Research Lab

The bot is a client of HEY's public API (`https://heyresearch.xyz/docs/public-api`) through the
published [`@hey-research-lab/sdk`](https://www.npmjs.com/package/@hey-research-lab/sdk). The
`/today` route is not in SDK 0.1.1, so it is read with the SDK's raw `client.get()`. The bot
sends no API key, makes no write, and reads nothing HEY does not publish to everyone. HEY's own
quality gate decides every fact the bot relays; the bot only formats it.

It is not HEY's own Telegram integration and shares no code with it: there is no account linking,
no alert delivery and no analytics here.

Runtime dependencies: `@hey-research-lab/sdk` and `zod` (validation of every Telegram update and
every HEY answer). The Docker image bundles both into one file.

## What it does NOT prove

The bot relays HEY's public research. It is not financial advice, never says a token is safe, never tells anyone to buy or sell, and treats a missing value as unknown.

HEY Research Lab is an independent research project and is not affiliated with, endorsed by or partnered with Robinhood Markets, Inc. or Robinhood Chain.

## Security

See [SECURITY.md](SECURITY.md). In short:

- **Network calls:** `https://api.telegram.org` (Bot API) and the configured HEY origin
  (`https://heyresearch.xyz` by default). Nothing else, and never a URL a message contains.
- **Webhook:** the `X-Telegram-Bot-Api-Secret-Token` header is compared in constant time before
  the body is read; bodies over 64 KB are refused; JSON with `__proto__`, `constructor` or
  `prototype` keys is refused; every update is validated.
- **Secrets:** read from the environment only; the bot token and webhook secret are redacted from
  every log line by value, and any bot-token shape by pattern. Telegram request URLs (which hold
  the token) are never logged or put in an error.
- **Logs:** one JSON object per line; never message text, user ids, usernames or chat titles.
- **Container:** runs as the image's unprivileged `node` user, with no secret baked in; the
  example compose file adds a read-only filesystem, no capabilities and `no-new-privileges`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Tests run offline over saved fixtures (`fixtures/`); the
test setup makes any real `fetch` fail. Before a pull request: `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build` and `pnpm scan`. Never commit a `.env` with values. `pnpm test:live`
(maintainers, never in CI) checks the bot's schemas against what heyresearch.xyz answers today.

## Licence

MIT © 2026 HEY Research Lab. See [LICENSE](LICENSE).
