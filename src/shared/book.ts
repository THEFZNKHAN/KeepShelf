/** Subtitles that carry no author/year. Avoid showing them in formatted output. */
const GENERIC_BOOK_SUBTITLES =
  /^(?:(?:fantasy|fiction|graphic)\s+)?(?:novel|book)\s+series$|^novel\s+series$|^book\s+series$|^series$/i;

/** Two+ capitalized name parts; allows middle initials (George R. R. Martin). */
const PERSON_NAME =
  /^[A-Z][a-z]+(?:\s+(?:[A-Z]\.?\s*)*[A-Z][a-z]+)+$/;

const AUTHOR_BY_PATTERN =
  /\b(?:novel|book(?:\s+series)?|series)\s+by\s+([A-Z][a-z]+(?:\s+(?:[A-Z]\.?\s*)*[A-Z][a-z]+)+)/i;

const SKIP_ABOUT_LINKS =
  /^(wikipedia|overview|books?|fantasy|fiction|polish|english|description|about|see more|feedback|images?|videos?|popular products|people also ask)$/i;

export function isGenericBookSubtitle(subtitle: string): boolean {
  return GENERIC_BOOK_SUBTITLES.test(subtitle.trim());
}

export function parseCommaName(text: string): string | undefined {
  const match = text.trim().match(/^([A-Za-z'.-]+),\s*([A-Za-z'.\s-]+)$/);
  if (!match) return undefined;
  const name = `${match[2].trim()} ${match[1].trim()}`;
  return looksLikePersonName(name) ? name : undefined;
}

export function looksLikePersonName(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 4 || trimmed.length > 60) return false;
  if (!PERSON_NAME.test(trimmed)) return false;
  const tokens = trimmed.split(/\s+/);
  const last = tokens[tokens.length - 1] ?? "";
  if (last.length <= 1) return false;
  if (/^[A-Z][a-z]+\s+(?:[A-Z]\s+){2,}[A-Z]$/.test(trimmed)) return false;
  return true;
}

function cleanAuthorSegment(segment: string): string | undefined {
  const s = segment
    .replace(/^[^A-Z]*/, "")
    .replace(/^(?:authors?|written by|by)\s*:?\s*/i, "")
    .trim();
  if (looksLikePersonName(s)) return s;
  const embedded = extractAuthorFromEmbeddedText(s);
  if (embedded && looksLikePersonName(embedded)) return embedded;
  return undefined;
}

/** Strip Google fact-tile junk (e.g. "s: George R. R. Martin, Martin G R R"). */
export function sanitizeAuthor(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const segments = raw.split(/[,;]/).map((s) => s.trim());
  for (const segment of segments) {
    const name = cleanAuthorSegment(segment);
    if (name) return name;
  }
  return cleanAuthorSegment(raw.trim());
}

export function pickBestAuthor(candidates: string[]): string | undefined {
  const valid = [
    ...new Set(
      candidates.map((c) => sanitizeAuthor(c)).filter((c): c is string => !!c)
    ),
  ];
  if (valid.length === 0) return undefined;
  valid.sort((a, b) => {
    const score = (name: string) =>
      name.split(/\s+/).length + (/\./.test(name) ? 1 : 0);
    return score(b) - score(a);
  });
  return valid[0];
}

export function shouldSkipAboutLink(text: string, title: string): boolean {
  const lower = text.toLowerCase().trim();
  if (lower === title.toLowerCase().trim()) return true;
  return SKIP_ABOUT_LINKS.test(lower);
}

export function extractAuthorByLine(text: string): string | undefined {
  const bySeries = text.match(AUTHOR_BY_PATTERN);
  if (bySeries?.[1] && looksLikePersonName(bySeries[1])) return bySeries[1].trim();
  const byGeneric = text.match(
    /\bby\s+([A-Z][a-z]+(?:\s+(?:[A-Z]\.?\s*)*[A-Z][a-z]+)+)/i
  );
  if (byGeneric?.[1] && looksLikePersonName(byGeneric[1])) {
    return byGeneric[1].trim();
  }
  return undefined;
}

/** Pull author name from product/list/aria-label text. */
export function extractAuthorFromEmbeddedText(
  text: string
): string | undefined {
  const fromLine = extractAuthorByLine(text);
  if (fromLine) return fromLine;

  const patterns = [
    /\bby\s+([A-Z][a-z]+(?:\s+(?:[A-Z]\.?\s*)*[A-Z][a-z]+)+)/i,
    /,\s*([A-Z][a-z]+(?:\s+(?:[A-Z]\.?\s*)*[A-Z][a-z]+)+)\)/,
    /\(([A-Z][a-z]+(?:\s+(?:[A-Z]\.?\s*)*[A-Z][a-z]+)+)\)/,
    /\b([A-Z][a-z]+(?:\s+(?:[A-Z]\.?\s*)*[A-Z][a-z]+)+)\s*[-–—]\s*(?:The\s+)?/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] && looksLikePersonName(match[1])) return match[1].trim();
  }
  return undefined;
}
