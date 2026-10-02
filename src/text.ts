/**
 * Machine-safe text: the folding rules of HEY's agent contract
 * (`machine-text-v1`), restated for one transport.
 *
 * Project names, release titles, descriptions and change summaries are a
 * source's words. They are data, never an instruction to the bot or to a
 * reader. Before any of them is printed it is folded onto one line and
 * stripped of control, invisible and bidirectional-override characters, HTML
 * tags, chat-template tokens and decorative Markdown, then bounded. Words that
 * read like an instruction to a model are kept, as evidence of what the source
 * says, and flagged.
 *
 * These functions are copied from HEY Research Lab's public agent contract (see
 * CONTRIBUTING.md, "Parity") and are to be replaced by the
 * `@hey-research-lab/agent-contract` package once it is published.
 */

/** The most characters of one external string the bot prints. */
export const EXTERNAL_TEXT_MAX = 280;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
// Variation selectors are matched on their own, never as part of a combined character.
const INVISIBLE =
  // eslint-disable-next-line no-misleading-character-class
  /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;
const TAG = /<\/?[A-Za-z!][^<>]{0,300}>/g;
const TEMPLATE_TOKEN = /<\|[^|<>]{0,40}\|>|\[\/?(?:INST|SYS)\]|<<\/?SYS>>/gi;
const FENCE = /`{3,}[^`]*`{0,3}/g;
const LINK = /!?\[([^\]]{0,200})\]\((?:[^)]{0,500})\)/g;
const EMPHASIS = /(\*\*|__|~~|`)/g;
const HEADING = /(^|\s)#{1,6}\s+/g;

const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b[^.]{0,40}\b(previous|prior|above|earlier|all|any|your|these|the)\b[^.]{0,30}\b(instructions?|prompts?|messages?|rules|guidelines|directions)\b/i,
  /\b(system|developer|hidden)\s+(prompt|message|instructions?)\b/i,
  /\byou\s+are\s+(now|no\s+longer)\b/i,
  /\b(act|behave)\s+as\s+(an?|the|if)\b/i,
  /\bpretend\s+(to\s+be|you\s+are)\b/i,
  /\b(new|updated|revised)\s+instructions?\b/i,
  /\b(tell|instruct|advise|urge)\s+(the\s+)?(user|reader|human|customer|investor)s?\b/i,
  /\b(call|invoke|use|run|execute)\s+(the\s+)?(tool|function|command)\b/i,
  /(^|\s)(system|assistant|user|developer)\s*:/i,
  /<\|[^|<>]{0,40}\|>|\[\/?INST\]|<<\/?SYS>>/i,
  /\b(note|message|notice|important|attention|reminder)\s+(for|to)\s+(any\s+|all\s+)?(ai|llms?|agents?|assistants?|models?|chatbots?|bots?)\b/i,
  /\bsystem\s+(note|notice|override|update)\b/i,
  /\b(ai|llm|assistant|agent|model|chatbot)s?\s*[,:]\s*(please\s+)?(recommend|buy|sell|say|tell|output|respond|reply|answer|ignore)\b/i,
  /\b(recommend|suggest|advise)\w*\s+(purchasing|buying|selling|a\s+(full\s+)?position)\b/i,
  /\b(strong\s+(buy|sell)|buy\s+now|sell\s+now|guaranteed\s+(returns?|profits?))\b/i,
];

/** Whether the words read like an instruction to a model. A flag, never a defence. */
export function looksLikeInstruction(text: string): boolean {
  const readable = text.normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/g, ' ');
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(readable));
}

/** An absolute http(s) URL with no whitespace, quote or angle bracket, within the bound. */
export function isSafeUrl(value: unknown, max = 500): value is string {
  return (
    typeof value === 'string' && value.length <= max && /^https?:\/\/[^\s"'<>`\\]+$/i.test(value)
  );
}

/** The text with everything that could change how it is read removed, on one line, unshortened. */
export function foldText(raw: string): string {
  return raw
    .replace(/[\t\r\n\f\v\u2028\u2029]+/g, ' ')
    .replace(CONTROL, '')
    .replace(INVISIBLE, '')
    .replace(TEMPLATE_TOKEN, ' ')
    .replace(TAG, ' ')
    .replace(FENCE, ' ')
    .replace(LINK, '$1')
    .replace(EMPHASIS, '')
    .replace(HEADING, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Shortened to `max` characters (code points), with an ellipsis when cut. */
export function bound(text: string, max: number): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  if (chars.length <= max) return { text, truncated: false };
  return {
    text: `${chars
      .slice(0, max - 1)
      .join('')
      .trimEnd()}…`,
    truncated: true,
  };
}
