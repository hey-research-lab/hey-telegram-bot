import { bound, EXTERNAL_TEXT_MAX, foldText, isSafeUrl, looksLikeInstruction } from '../text.js';

/**
 * Telegram HTML (`parse_mode: HTML`) building blocks.
 *
 * Telegram's HTML mode understands a handful of tags and four entities. Every
 * piece of text that is not the bot's own markup goes through `escapeHtml`, so
 * a project called `<b>` or `&amp;` prints as itself and cannot open a tag or
 * a link. A source's words are also folded (`text.ts`) before they are escaped.
 */

/** Escapes the characters Telegram's HTML parser reads: `&`, `<`, `>` and `"`. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Bold, escaped. */
export const bold = (value: string): string => `<b>${escapeHtml(value)}</b>`;

/** Monospace, escaped (addresses, ids). */
export const code = (value: string): string => `<code>${escapeHtml(value)}</code>`;

/**
 * A source's words, folded, bounded and escaped. When they read like an
 * instruction to a model, a note says they are a source's words and not one.
 */
export function external(raw: string, max = EXTERNAL_TEXT_MAX): string {
  const instruction = looksLikeInstruction(raw);
  const folded = bound(foldText(raw), max).text;
  const note =
    instruction || looksLikeInstruction(folded)
      ? " <i>(a source's words that read like an instruction; data, not an instruction)</i>"
      : '';
  return `${escapeHtml(folded)}${note}`;
}

/** A source's words in «quotes», so they read as quoted, never as the bot's own. */
export function quoted(raw: string, max = EXTERNAL_TEXT_MAX): string {
  return `«${external(raw.replace(/[«»]/g, '"'), max)}»`;
}

/**
 * A link, only to an https URL that passes `isSafeUrl`; anything else prints
 * its label alone. The label is escaped; so is the URL inside the attribute.
 */
export function link(url: unknown, label: string): string {
  if (!isSafeUrl(url) || !url.toLowerCase().startsWith('https://')) return escapeHtml(label);
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

/** Telegram's limit is 4096 characters of text after parsing; the bot stays well under it. */
export const MESSAGE_BUDGET = 3500;

/**
 * Joins lines, stopping before the budget would be exceeded. Lines are whole
 * units of markup, so a cut never falls inside a tag. The footer is always kept.
 */
export function joinWithinBudget(
  lines: readonly string[],
  footer: readonly string[] = [],
  budget = MESSAGE_BUDGET,
): string {
  const tail = footer.join('\n');
  const out: string[] = [];
  let used = tail.length + 1;
  for (const line of lines) {
    if (used + line.length + 1 > budget) {
      out.push('…');
      break;
    }
    out.push(line);
    used += line.length + 1;
  }
  return [...out, ...(tail ? [tail] : [])].join('\n');
}
