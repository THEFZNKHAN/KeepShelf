import type { MediaType, ParsedMedia } from "./types.js";

/** Series Graph show pages use /show/{id}-{slug} (TV episode grids). */
export function isSeriesGraphShowPage(doc: Document = document): boolean {
  return /^\/show\/\d+-/.test(doc.location?.pathname ?? "");
}

export function findSeriesGraphRoot(doc: Document): Element | null {
  return doc.querySelector("#show-chart-container");
}

export function parseSeriesGraphPage(doc: Document): ParsedMedia | null {
  const root = findSeriesGraphRoot(doc);
  if (!root) return null;

  const title =
    root.querySelector("h3.rt-Heading")?.textContent?.trim() ??
    doc.querySelector('img[id^="poster-"]')?.getAttribute("alt")?.trim();
  if (!title) return null;

  const year = parseYearRange(root);
  const rating = parseCommunityRating(root);
  const seasons = countSeasons(root);
  const durationOrSeasons =
    seasons > 0
      ? `${seasons} season${seasons === 1 ? "" : "s"}`
      : undefined;

  const yearLabel = year ?? "unknown";
  const subtitle = durationOrSeasons
    ? `${yearLabel} · ${durationOrSeasons}`
    : yearLabel;

  return {
    title,
    type: resolveSeriesGraphType(doc, title),
    subtitle,
    year,
    durationOrSeasons,
    imdbRating: rating,
  };
}

function resolveSeriesGraphType(doc: Document, title: string): MediaType {
  const haystack = `${title} ${doc.title}`.toLowerCase();
  if (/\banime\b/.test(haystack)) return "anime";
  return "series";
}

function parseYearRange(root: ParentNode): string | undefined {
  for (const el of root.querySelectorAll('p[data-accent-color="gray"]')) {
    const text = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const range = text.match(/^(\d{4})\s*-\s*(?:now|present|\d{4})$/i);
    if (range) return range[1];
    if (/^\d{4}$/.test(text)) return text;
  }
  return undefined;
}

function parseCommunityRating(root: ParentNode): string | undefined {
  const strong = root.querySelector("strong.rt-Strong, p strong");
  const text = strong?.textContent?.replace(/\s+/g, " ") ?? "";
  const match = text.match(/^(\d+(?:\.\d+)?)/);
  return match?.[1];
}

function countSeasons(root: ParentNode): number {
  let max = 0;

  const consider = (raw: string | null | undefined) => {
    const text = raw?.replace(/\s+/g, " ").trim() ?? "";
    const tick = text.match(/^S(\d+)$/i);
    if (tick) {
      max = Math.max(max, Number(tick[1]));
      return;
    }
    const label = text.match(/^Season\s+(\d+)$/i);
    if (label) max = Math.max(max, Number(label[1]));
  };

  for (const el of root.querySelectorAll(
    "g.tick text, .tick text, #show-chart-container text, svg text"
  )) {
    consider(el.textContent);
  }

  for (const el of root.querySelectorAll(
    '#show-chart-container [aria-label*="Season"], #show-chart-container button'
  )) {
    consider(el.textContent);
    consider(el.getAttribute("aria-label"));
  }

  return max;
}

export function isSeriesGraphChartReady(doc: Document = document): boolean {
  const root = findSeriesGraphRoot(doc);
  if (!root) return false;
  return countSeasons(root) > 0;
}

export function seriesGraphQueryFromUrl(href: string): string {
  const slug = href.match(/\/show\/\d+-(.+?)\/?$/)?.[1];
  if (slug) return slug.replace(/-/g, " ");
  return "";
}
