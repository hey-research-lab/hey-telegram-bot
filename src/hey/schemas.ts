import { z } from 'zod';

/**
 * Runtime validation of the HEY API answers the bot reads.
 *
 * Only the fields the bot prints are declared; anything else HEY sends is
 * dropped (the API is additive, so a new field must never break the bot).
 * A field HEY leaves out stays absent: the renderers print "not measured" or
 * "unknown" for it, never 0 or "none". Market figures are not declared at all,
 * so they can never reach a reply.
 */

const iso = z.string().max(40);
const httpsUrl = z.string().max(600);
const shortText = z.string().max(2000);

export const projectSchema = z.object({
  slug: z.string().max(120),
  name: shortText,
  symbol: shortText.optional(),
  shortDescription: shortText.optional(),
  projectKind: z.string().max(60).optional(),
  activityStatus: z.string().max(40),
  researchLevel: z.string().max(40).optional(),
  hasBuilderSource: z.boolean().optional(),
  lastShippedAt: iso.optional(),
  stillBuildingState: z.string().max(40).optional(),
  primaryNarrative: z.object({ slug: z.string().max(120), name: shortText }).optional(),
  token: z.object({ chainId: z.number().int(), contractAddress: z.string().max(60) }).optional(),
  tokenVerification: z.object({ status: z.string().max(40) }).optional(),
  ships: z
    .array(
      z.object({
        title: shortText,
        publishedAt: iso,
        precision: z.string().max(20).optional(),
        verification: z.string().max(40).optional(),
        sourceUrl: httpsUrl.optional(),
        url: httpsUrl.optional(),
      }),
    )
    .max(200)
    .optional(),
  url: httpsUrl,
  disclaimer: shortText.optional(),
});
export type Project = z.infer<typeof projectSchema>;

const scanNotFound = z.object({
  found: z.literal(false),
  chainId: z.number().int(),
  contractAddress: z.string().max(60).optional(),
  reason: z.string().max(40).optional(),
  message: shortText.optional(),
  scan_url: httpsUrl.optional(),
  disclaimer: shortText.optional(),
});

const scanFound = z.object({
  found: z.literal(true),
  chainId: z.number().int(),
  contractAddress: z.string().max(60),
  status: z.string().max(40),
  status_label: shortText,
  status_help: shortText.optional(),
  verified_builder: z.boolean().optional(),
  token_verification: z.string().max(40).optional(),
  activity_applies_to_token: z.boolean().optional(),
  research_level: z.string().max(40).optional(),
  activity_measured: z.boolean().optional(),
  coverage: z.string().max(40).optional(),
  as_of: iso.optional(),
  activity: z
    .object({
      commits_30d: z.number().int().min(0).optional(),
      commits_30d_partial: z.literal(true).optional(),
      releases_30d: z.number().int().min(0).optional(),
      ships_30d: z.number().int().min(0).optional(),
      meaningful_ships_30d: z.number().int().min(0).optional(),
      last_ship: iso.optional(),
      last_ship_title: shortText.optional(),
      last_ship_url: httpsUrl.optional(),
    })
    .optional(),
  project: z.object({
    slug: z.string().max(120),
    name: shortText,
    symbol: shortText.optional(),
  }),
  project_url: httpsUrl,
  cta: z.object({ label: shortText, url: httpsUrl }).optional(),
  disclaimer: shortText.optional(),
});

export const scanCardSchema = z.discriminatedUnion('found', [scanNotFound, scanFound]);
export type ScanCard = z.infer<typeof scanCardSchema>;
export type ScanFound = z.infer<typeof scanFound>;

const changeUpsert = z.object({
  id: z.string().max(260),
  op: z.literal('upsert'),
  type: z.string().max(80),
  domain: z.string().max(40),
  project: z.object({ slug: z.string().max(120), name: shortText, url: httpsUrl }),
  occurredAt: iso.nullable(),
  precision: z.string().max(20),
  detectedAt: iso,
  summary: shortText,
  source: z.string().max(120).optional(),
  countsAsBuilding: z.literal(true).optional(),
  facts: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
const changeRetract = z.object({ id: z.string().max(260), op: z.literal('retract') });

export const changesPageSchema = z.object({
  items: z.array(z.discriminatedUnion('op', [changeUpsert, changeRetract])).max(100),
  hasMore: z.boolean().optional(),
  ledger: z
    .object({
      collectionStart: iso.nullable().optional(),
      newestRecordedAt: iso.nullable().optional(),
    })
    .optional(),
  disclaimer: shortText.optional(),
});
export type ChangesPage = z.infer<typeof changesPageSchema>;
export type ChangeUpsert = z.infer<typeof changeUpsert>;

const agentText = z.object({
  text: shortText,
  contentOrigin: z.enum(['hey', 'derived', 'external_source']),
  instructionLike: z.literal(true).optional(),
});

const agentChange = z.object({
  id: z.string().max(260),
  type: z.string().max(80),
  domain: z.string().max(40),
  occurredAt: iso.nullable(),
  precision: z.string().max(20),
  detectedAt: iso,
  summary: agentText,
  status: z.string().max(20).optional(),
  countsAsBuilding: z.boolean().optional(),
  verification: z.string().max(40).optional(),
  project: z.object({ slug: z.string().max(120), url: httpsUrl }),
});

/** AgentIntelligenceResponse v1 for `what_changed`: only the parts the bot prints. */
export const whatChangedSchema = z.object({
  schema: z.literal('hey.agent-intelligence-response'),
  schemaVersion: z.literal('1'),
  capability: z.literal('what_changed'),
  status: z.enum(['ok', 'not_found', 'moved', 'invalid_request', 'unavailable']),
  answer: agentText,
  data: z
    .object({
      scope: z.enum(['project', 'chain']),
      window: z.object({ days: z.number().int(), from: iso, to: iso }),
      total: z.number().int().min(0),
      countsAsBuilding: z.number().int().min(0).optional(),
      byType: z
        .array(z.object({ type: z.string().max(80), count: z.number().int().min(0) }))
        .max(40),
      shown: z.number().int().min(0),
      items: z.array(agentChange).max(50),
    })
    .nullable(),
  boundaries: z.object({ disclaimer: agentText }).optional(),
  error: z.object({ code: z.string().max(120), message: agentText }).optional(),
  asOf: iso,
});
export type WhatChanged = z.infer<typeof whatChangedSchema>;
