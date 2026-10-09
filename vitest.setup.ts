/**
 * No test may touch the network. The HEY client and the Telegram client take
 * an injected `fetchImpl`, so any call reaching the real `fetch` is a mistake:
 * fail loudly instead of silently making a request.
 */
const blocked = async (input: unknown): Promise<never> => {
  const target = typeof input === 'string' ? input : String(input);
  throw new Error(
    `Network access is disabled in tests. Something tried to fetch ${target}. ` +
      'Drive the clients with a stubbed fetchImpl over saved fixtures.',
  );
};

// The one exception: `test/live.test.ts`, run only with HEY_LIVE=1 (`pnpm test:live`), never in CI.
if (process.env.HEY_LIVE !== '1') {
  globalThis.fetch = blocked as unknown as typeof fetch;
}
