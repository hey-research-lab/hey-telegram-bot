# Setting up hey-telegram-bot

This guide takes you from nothing to a bot answering `/project` in your group. It assumes a
server with Docker and a domain name you control. For a quick local try without a server, skip to
[Local development (long polling)](#local-development-long-polling).

## 1. Create the bot with @BotFather

1. Open a chat with [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Choose a display name and a username ending in `bot`.
3. BotFather replies with the bot's **token**. Treat it like a password: anyone holding it controls
   the bot. Do not paste it into a group, an issue or a screenshot.
4. Recommended: leave **privacy mode** on (`/setprivacy` → Enable, the default). In groups the bot
   then receives only commands, which is all it needs.
5. Optional: `/setdescription` and `/setabouttext` — for example "Read-only HEY Research lookups
   for Robinhood Chain projects. Not financial advice."

If the token ever leaks, send `/revoke` to BotFather and put the new token in `.env`.

## 2. Choose a webhook secret

Telegram sends this secret back in the `X-Telegram-Bot-Api-Secret-Token` header of every webhook
request, so the bot can refuse requests that did not come from Telegram. It must be 32–256
characters of `A-Z`, `a-z`, `0-9`, `_` and `-`:

```sh
openssl rand -hex 32
```

## 3. Configure

```sh
git clone https://github.com/hey-research-lab/hey-telegram-bot.git
cd hey-telegram-bot
cp .env.example .env
chmod 600 .env
```

Edit `.env`:

```
TELEGRAM_BOT_TOKEN=<the token from BotFather>
TELEGRAM_WEBHOOK_SECRET=<the output of openssl rand -hex 32>
HEY_BASE_URL=
PORT=
LOG_LEVEL=
```

Empty values take their defaults (`https://heyresearch.xyz`, `8080`, `info`). Never commit `.env`;
it is in `.gitignore`.

## 4. Start the container

```sh
cp docker-compose.example.yml docker-compose.yml
docker compose up -d --build
docker compose logs -f
```

The first log line is `webhook_listening`. The container listens on `127.0.0.1:8080` only.

## 5. Put HTTPS in front of it

Telegram delivers webhooks only over HTTPS, to ports 443, 80, 88 or 8443. Use any reverse proxy
that terminates TLS with a valid certificate and forwards one path to the container:

```
https://bot.example.org/telegram/webhook  →  http://127.0.0.1:8080/telegram/webhook
```

Forward only `/telegram/webhook`; `/healthz` does not need to be public. Keep the proxy's request
body limit at or above 64 KB (the bot refuses larger bodies itself).

## 6. Register the webhook

The bot can register itself, reading the token and secret from `.env` so neither appears in your
shell history:

```sh
docker compose run --rm hey-telegram-bot set-webhook https://bot.example.org/telegram/webhook
```

This calls `setWebhook` with `secret_token` set to `TELEGRAM_WEBHOOK_SECRET`,
`allowed_updates: ["message"]` and `drop_pending_updates: true`, then `setMyCommands` so Telegram
shows the command menu.

If you prefer to call the Bot API yourself, the equivalent request is below. It reads the values
from your environment; avoid typing the token on the command line.

```sh
set -a; . ./.env; set +a
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'content-type: application/json' \
  -d "{\"url\":\"https://bot.example.org/telegram/webhook\",\"secret_token\":\"${TELEGRAM_WEBHOOK_SECRET}\",\"allowed_updates\":[\"message\"]}"
```

Check it with `getWebhookInfo` (the same URL pattern, method `getWebhookInfo`): `url` should be
yours and `last_error_message` absent.

## 7. Try it

Add the bot to a group, or message it directly:

```
/help
/project hey-research-lab
/scan 0x…            (a Robinhood Chain contract address)
/changes hey-research-lab
/today
```

## Local development (long polling)

Polling needs no public URL and no TLS. A bot cannot poll while a webhook is set, so remove it
first if you registered one:

```sh
cp .env.example .env               # TELEGRAM_BOT_TOKEN only; the webhook secret can stay empty
corepack enable
pnpm install
node --env-file=.env dist/main.js delete-webhook   # after `pnpm build`, only if a webhook was set
pnpm dev:polling
```

`pnpm dev:polling` builds the bot and runs `node --env-file=.env dist/main.js polling`. Stop it with
Ctrl-C. With Docker, set `command: ["polling"]` in `docker-compose.yml` instead.

Use a separate bot (a second token from BotFather) for development, so polling on your machine
never competes with the webhook of the bot your community uses.

## Operating notes

- **Health:** `GET /healthz` answers `{"status":"ok"}`; the image's `HEALTHCHECK` runs
  `hey-telegram-bot healthcheck` against it.
- **Logs:** JSON lines on stdout (warnings and errors on stderr). They name the command, the kind
  of chat, the outcome and the time taken — never message text, user ids or names. Set
  `LOG_LEVEL=debug` for more.
- **Limits:** see the README's Limits table. HEY's anonymous API allows 120 requests a minute per
  client; the bot spends at most 60 across all chats.
- **Upgrades:** `git pull && docker compose up -d --build`. The bot keeps no state, so nothing
  needs migrating.
- **Several replicas:** possible behind one webhook URL, but each keeps its own in-memory limits,
  so the global limit multiplies. One replica is plenty for most communities.
