import type { ParsedMedia } from "./types.js";
import { normalizeYear } from "./year.js";

const ANIME_TITLE_PATH = /^\/anime\/(\d+)(?:\/|$)/i;

const EXCLUDED_ANIME_PREFIXES = [
  "/anime/season/",
  "/anime/genre/",
  "/anime/producer/",
  "/anime/studio/",
  "/anime/type/",
  "/anime/status/",
  "/anime/score/",
  "/anime/alphabetical",
  "/anime/search",
];

export function isMalAnimePage(doc: Document = document): boolean {
  const path = doc.location?.pathname ?? "";
  if (!ANIME_TITLE_PATH.test(path)) return false;
  return !EXCLUDED_ANIME_PREFIXES.some((prefix) =>
    path.toLowerCase().startsWith(prefix)
  );
}

export function malIdFromUrl(href: string): string | undefined {
  return href.match(/\/anime\/(\d+)/i)?.[1];
}

export function parseMalPage(doc: Document): ParsedMedia | null {
  const fromJsonLd = parseFromJsonLd(doc);
  if (fromJsonLd) return enrichFromDom(fromJsonLd, doc);

  const fromDom = parseFromDom(doc);
  if (fromDom) return fromDom;

  return null;
}

function parseFromJsonLd(doc: Document): ParsedMedia | null {
  for (const block of readJsonLd(doc)) {
    if (typeof block !== "object" || block === null) continue;
    const work = pickCreativeWork(block as Record<string, unknown>);
    if (!work) continue;

    const title = stringField(work.name);
    if (!title) continue;

    const year = normalizeYear(stringField(work.datePublished));
    const score = parseAggregateRating(work.aggregateRating);

    return {
      title: cleanMalTitle(title),
      type: "anime",
      subtitle: year ?? "unknown",
      year,
      imdbRating: score,
    };
  }
  return null;
}

function enrichFromDom(base: ParsedMedia, doc: Document): ParsedMedia {
  const dom = parseFromDom(doc);
  if (!dom) return base;

  return {
    ...base,
    title: dom.title || base.title,
    year: dom.year ?? base.year,
    genre: dom.genre ?? base.genre,
    subtitle: dom.subtitle || base.subtitle,
    durationOrSeasons: dom.durationOrSeasons ?? base.durationOrSeasons,
    imdbRating: dom.imdbRating ?? base.imdbRating,
  };
}

function parseFromDom(doc: Document): ParsedMedia | null {
  const title =
    parseEnglishTitle(doc) ??
    parseH1Title(doc) ??
    parseOgTitle(doc);
  if (!title) return null;

  const year = parseYear(doc);
  const episodes = parseEpisodes(doc);
  const score = parseScore(doc);
  const genres = parseGenres(doc);
  const genreLabel = genres.slice(0, 2).join("/") || undefined;

  const subtitleParts: string[] = [];
  if (year) subtitleParts.push(year);
  else subtitleParts.push("unknown");
  if (episodes) subtitleParts.push(episodes);
  if (genreLabel) subtitleParts.push(genreLabel);

  return {
    title,
    type: "anime",
    subtitle: subtitleParts.join(" · "),
    year,
    genre: genreLabel,
    durationOrSeasons: episodes,
    imdbRating: score,
  };
}

function readJsonLd(doc: Document): unknown[] {
  const out: unknown[] = [];
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent ?? "");
      flattenJsonLd(parsed, out);
    } catch {
      /* ignore */
    }
  }
  return out;
}

function flattenJsonLd(value: unknown, out: unknown[]): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, out);
    return;
  }
  if (typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  out.push(obj);
  if (Array.isArray(obj["@graph"])) flattenJsonLd(obj["@graph"], out);
}

function pickCreativeWork(
  obj: Record<string, unknown>
): Record<string, unknown> | null {
  const type = normalizeType(obj["@type"]);
  if (
    type === "TVSeries" ||
    type === "Movie" ||
    type === "VideoObject" ||
    type === "CreativeWork"
  ) {
    return obj;
  }
  return null;
}

function normalizeType(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return undefined;
}

function stringField(raw: unknown): string | undefined {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return undefined;
}

function parseAggregateRating(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rating = raw as Record<string, unknown>;
  const value = rating.ratingValue ?? rating.value;
  if (typeof value === "number") return formatScore(String(value));
  if (typeof value === "string") return formatScore(value);
  return undefined;
}

function parseEnglishTitle(doc: Document): string | undefined {
  const bodyText = normalizedBodyText(doc);
  const match = bodyText.match(/English:\s*([^]+?)(?:\s+More titles|\s+Information|$)/i);
  if (match?.[1]) {
    const title = match[1].trim();
    if (title.length > 0 && title.length < 120) return title;
  }
  return undefined;
}

function parseH1Title(doc: Document): string | undefined {
  const h1 = doc.querySelector("h1");
  const text = h1?.textContent?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return cleanMalTitle(text);
}

function parseOgTitle(doc: Document): string | undefined {
  const og = doc
    .querySelector('meta[property="og:title"]')
    ?.getAttribute("content");
  if (!og) return undefined;
  return cleanMalTitle(og);
}

function cleanMalTitle(raw: string): string {
  return raw
    .replace(/\s*-\s*MyAnimeList\.net.*$/i, "")
    .replace(/\s*\((?:TV|Movie|OVA|ONA|Special)[^)]*\)\s*$/i, "")
    .trim();
}

function parseYear(doc: Document): string | undefined {
  const bodyText = normalizedBodyText(doc);

  const aired = bodyText.match(
    /Aired:\s*(?:[A-Za-z]{3}\s+\d{1,2},\s*)?(\d{4})/i
  );
  if (aired?.[1]) return normalizeYear(aired[1]);

  const premiered = bodyText.match(/Premiered:\s*(?:\[[^\]]+\]\s*)?(?:\w+\s+)?(\d{4})/i);
  if (premiered?.[1]) return normalizeYear(premiered[1]);

  const docTitle = doc.title?.match(/\((?:TV|Movie)\s+(\d{4})\)/i);
  if (docTitle?.[1]) return normalizeYear(docTitle[1]);

  return undefined;
}

function parseEpisodes(doc: Document): string | undefined {
  const bodyText = normalizedBodyText(doc);
  const match = bodyText.match(/Episodes:\s*(\d+)/i);
  if (!match?.[1]) return undefined;
  return `${match[1]} eps`;
}

function parseScore(doc: Document): string | undefined {
  for (const el of doc.querySelectorAll('[class*="score"], [class*="rating"], span, div')) {
    const label = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (/^Score:/i.test(label)) {
      const inline = label.match(/Score:\s*([\d.]+)/i);
      if (inline?.[1]) return formatScore(inline[1]);
    }
  }

  const bodyText = normalizedBodyText(doc);
  const match = bodyText.match(/Score:\s*([\d.]+)/i);
  if (match?.[1]) return formatScore(match[1]);

  const itemprop = doc.querySelector('[itemprop="ratingValue"]');
  const value = itemprop?.getAttribute("content") ?? itemprop?.textContent;
  if (value) return formatScore(value.trim());

  return undefined;
}

function parseGenres(doc: Document): string[] {
  const genres: string[] = [];
  for (const link of doc.querySelectorAll('a[href*="/anime/genre/"]')) {
    const name = link.textContent?.replace(/\s+/g, " ").trim();
    if (!name || genres.includes(name)) continue;
    genres.push(name);
  }
  return genres;
}

function formatScore(raw: string): string | undefined {
  const num = Number.parseFloat(raw);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return num.toFixed(2);
}

function normalizedBodyText(doc: Document): string {
  return doc.body?.textContent?.replace(/\s+/g, " ") ?? "";
}
