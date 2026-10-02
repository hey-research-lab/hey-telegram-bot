# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## 0.1.0 — 2026-10-02

### Added

- Read-only commands over HEY's public API: `/project <slug>` (`GET /api/projects/{slug}`),
  `/scan <address>` (`GET /api/v1/scan?chain=4663&token=`), `/changes <slug>`
  (`GET /api/changes`, market events excluded), `/today` (`GET /api/agent/what_changed?days=1&building=only`,
  labelled "What changed in the last day"), `/hey`, `/help` and `/start`.
- Webhook mode on `node:http`: `X-Telegram-Bot-Api-Secret-Token` check in constant time, 64 KB
  body limit, prototype-key refusal, schema validation of updates, replies sent in the webhook
  response, duplicate-update suppression, `GET /healthz`.
- Long-polling mode for local development, with bounded backoff and a stop after 20 consecutive
  failures, on a rejected token or while a webhook is still set.
- `set-webhook`, `delete-webhook` and `healthcheck` commands.
- In-memory rate limits per chat, per person and across all chats.
- Structured JSON logs with the bot token and webhook secret redacted; no message text or user
  identifiers are logged.
- HTML replies with escaping and folding of every source's words; HEY's state words printed
  exactly; unknown values printed as unknown; a project link with every project fact.
- Dockerfile (Node 22 Alpine, unprivileged user, one bundled file), `docker-compose.example.yml`,
  `.env.example`, setup guide, fixtures and tests.
- Leak and attribution scan (`pnpm scan`) and CI.

### Not included

- Optional local watch state (following a project and posting its changes). Out of scope for
  v0.1; the bot is stateless.
