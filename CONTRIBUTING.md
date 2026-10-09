# Contributing

Thank you for helping. This bot is small on purpose: a read-only relay of HEY's public API into
Telegram. Changes that keep it that way are welcome.

## Setup

```sh
corepack enable
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm scan
```

Node 22 or newer. `pnpm format` applies Prettier.

## Rules for changes

- **Public API only.** Every HEY call goes through `@hey-research-lab/sdk` (or its raw
  `client.get()` for a public route the SDK lacks) in `src/hey/gateway.ts`. No account, alert,
  webhook or write route, no API key, and never `POST /api/scan`.
- **A new command needs a real public endpoint** and a fixture of its answer.
- **Unknown stays unknown.** An absent value prints as "not measured" or "unknown", never `0`,
  "none" or a blank. Print HEY's state words exactly.
- **No market talk.** Prices, valuations, liquidity, volume and trade counts are not read; no
  reply recommends anything. The forbidden-words test in `test/bot.test.ts` guards the bot's
  own copy.
- **Escape everything that is not the bot's own markup** with the helpers in
  `src/render/html.ts`.
- **Tests run offline.** `vitest.setup.ts` makes the real `fetch` throw (except under
  `HEY_LIVE=1`, which only `pnpm test:live` sets: an opt-in check of the schemas against
  production, never in CI); drive the clients with
  an injected `fetchImpl` over files in `fixtures/`. Fixtures use example addresses
  (`0x000…001`), `example.com`/`example.org` hosts and documentation values only.
- **No secrets** in code, fixtures, logs or commits. `pnpm scan` (also in CI) fails on token
  shapes, local paths, public IP addresses and attribution lines.
- Small, conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`).

## Parity

Two small tables are restated from HEY Research Lab's public code rather than imported. Both
were checked against HEY Research Lab's public contract on 2026-10-09 (the words are unchanged
since they were first extracted on 2026-10-02):

- `src/text.ts` — the machine-safe text rules (`foldText`, `looksLikeInstruction`,
  `isSafeUrl`, the 280-character bound) of the agent contract, `machine-text-v1`, as published
  in [hey-research-open](https://github.com/hey-research-lab/hey-research-open)
  (`packages/agent-provider-core/src/text.ts`). `@hey-research-lab/agent-contract` 0.1.0 on npm
  now exports the same helpers; replacing this copy with it is a planned change of its own.
- `src/words.ts` — the activity status and research level words that heyresearch.xyz prints, as
  published in hey-research-open (`packages/scoring/src/activity-words.ts`,
  `packages/scoring/src/research-level-words.ts`).

`src/chain.ts` and `src/evm.ts` follow the HEY ecosystem's shared chain and address helpers.

When HEY changes one of these, update the copy here in its own commit and note the new commit.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do not open a public issue for a vulnerability.
