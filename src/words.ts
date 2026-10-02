/**
 * HEY's own words for its states, so the bot prints what heyresearch.xyz
 * prints for the same project.
 *
 * The partner card (`/api/v1/scan`) and the token lookup carry these words in
 * the response (`status_label`, `activityLabel`); the project dossier
 * (`/api/projects/{slug}`) carries only the enum, so the table is restated here.
 * Copied from HEY Research Lab's public scoring words (see CONTRIBUTING.md,
 * "Parity"). A status this table does not know is printed as HEY sent it,
 * never mapped to a guess, and DORMANT is never "dead".
 */

export const ACTIVITY_STATUS_WORDS: Readonly<Record<string, { label: string; help: string }>> = {
  SHIPPING: { label: 'Shipping', help: 'Shipped something meaningful in the last 7 days.' },
  ACTIVE: { label: 'Active', help: 'Meaningful updates in the last month.' },
  QUIET: { label: 'Quiet', help: 'No meaningful updates for over a month.' },
  DORMANT: {
    label: 'Dormant',
    help: 'No meaningful updates observed for a long time. Not the same as abandoned.',
  },
  RESUMED: { label: 'Resumed building', help: 'Started shipping again after a long gap.' },
  UNKNOWN: {
    label: 'Activity unknown',
    help: 'Not enough public sources to judge activity yet.',
  },
};

export const NO_BUILDER_SIGNAL = {
  label: 'No builder source linked',
  help: 'HEY has no repository, changelog or feed linked for this project, so whether it is building is not measured. It does not mean nothing is being built. Trading is not building.',
} as const;

export const ACTIVITY_NOT_MEASURABLE = {
  label: 'Activity not measurable',
  help: 'HEY has a ship on record but no repository, changelog or feed it can keep reading, so whether this project is building now cannot be judged. The last ship is the newest evidence HEY holds.',
} as const;

/** The words for a project's status, with the reason an UNKNOWN is unknown when HEY says it. */
export function activityWords(project: {
  activityStatus: string;
  hasBuilderSource?: boolean | undefined;
  lastShippedAt?: string | undefined;
}): { label: string; help: string | undefined } {
  const status = project.activityStatus;
  if (status === 'UNKNOWN' && project.hasBuilderSource === false) {
    return project.lastShippedAt ? { ...ACTIVITY_NOT_MEASURABLE } : { ...NO_BUILDER_SIGNAL };
  }
  const words = ACTIVITY_STATUS_WORDS[status];
  if (words) return { ...words };
  return { label: status, help: undefined };
}

export const RESEARCH_LEVEL_WORDS: Readonly<Record<string, { label: string; help: string }>> = {
  INDEXED: { label: 'Indexed', help: 'Verified on Robinhood Chain. Not researched yet.' },
  RESEARCHED: { label: 'Researched', help: 'HEY has enriched this project from public sources.' },
  VERIFIED_BUILDER: {
    label: 'Verified Builder',
    help: 'HEY holds verified evidence of shipping.',
  },
};

/** The research level's word; a level this table does not know is printed as HEY sent it. */
export function researchLevelLabel(level: string): string {
  return RESEARCH_LEVEL_WORDS[level]?.label ?? level;
}

/** Still Building in words: HELD, NOT_HELD (measured, not met) or NOT_MEASURED. */
export const STILL_BUILDING_WORDS: Readonly<Record<string, string>> = {
  HELD: 'held — verified building through a market drawdown HEY tracked',
  NOT_HELD: 'not held (measured)',
  NOT_MEASURED: 'not measured',
};

/** Token verification: whether the project itself names the contract. */
export const TOKEN_VERIFICATION_WORDS: Readonly<Record<string, string>> = {
  VERIFIED: 'the project itself names this contract',
  UNVERIFIED: 'HEY has not seen the project name this contract',
  MISMATCH: "the project's own site names a different contract",
};
