import { describe, expect, it } from 'vitest';

import { createHeyGateway } from '../src/hey/gateway.js';
import { renderChanges, renderProject, renderScan, renderToday } from '../src/render/replies.js';

/**
 * Opt-in live contract check (HEY_LIVE=1, `pnpm test:live`; never in CI): the bot's schemas still
 * read what heyresearch.xyz answers today, and every reply renders from it. Five read-only GETs,
 * no key. A failure means HEY's public contract moved: update the schema and the fixtures.
 */
const live = process.env.HEY_LIVE === '1';
const BASE = 'https://heyresearch.xyz';
const NOBODY = '0x0000000000000000000000000000000000000001';

describe.skipIf(!live)('live contract with heyresearch.xyz', () => {
  const hey = createHeyGateway({ baseUrl: BASE });

  it('/project reads a published dossier', async () => {
    const project = await hey.project('hey-research-lab');
    expect(project.slug).toBe('hey-research-lab');
    expect(renderProject(project)).toContain('Open on HEY');
  });

  it('/scan reads a found card and a not-found card', async () => {
    const project = await hey.project('hey-research-lab');
    const token = project.token?.contractAddress;
    expect(token).toMatch(/^0x[0-9a-f]{40}$/);
    const found = await hey.scan(token ?? NOBODY);
    expect(found.found).toBe(true);
    expect(renderScan(found, token ?? NOBODY)).toContain('Open on HEY');
    const missing = await hey.scan(NOBODY);
    expect(missing.found).toBe(false);
    expect(renderScan(missing, NOBODY)).toContain('HEY’s published index has no project for');
  });

  it('/changes reads the ledger with every domain but market', async () => {
    const page = await hey.changes('hey-research-lab', 5);
    expect(Array.isArray(page.items)).toBe(true);
    expect(renderChanges('hey-research-lab', page, BASE)).toContain('Recent changes');
  });

  it('/today reads what_changed for one day, building only', async () => {
    const answer = await hey.whatChangedToday(5);
    expect(answer.status).toBe('ok');
    expect(renderToday(answer)).toContain('What changed in the last day');
  });
});
