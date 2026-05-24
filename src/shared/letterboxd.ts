import type { MediaType, ParsedMedia } from "./types.js";
import { normalizeYear } from "./year.js";

const FILM_PATH = /^\/film\/([a-z0-9-]+)\/?$/i;

export function isLetterboxdFilmPage(doc: Document = document): boolean {
  return FILM_PATH.test(doc.location?.pathname ?? "");
}

export function letterboxdSlugFromUrl(href: string): string | undefined {
  return href.match(/\/film\/([a-z0-9-]+)/i)?.[1];
}

export function parseLetterboxdPage(doc: Document): ParsedMedia | null {
  const fromJsonLd = parseFromJsonLd(doc);
  if (fromJsonLd) return enrichFromDom(fromJsonLd, doc);

  const fromProduction = parseProductionData(doc);
  if (fromProduction) return enrichFromDom(fromProduction, doc);

  return parseFromDom(doc);
}

function parseProductionData(doc: Document): ParsedMedia | null {
  const script = doc.querySelector("#production-data");
  if (!script?.textContent) return null;

  try {
    const data = JSON.parse(script.textContent) as {
      name?: string;
      nameAndYear?: string;
    };
    const title = data.name?.trim();
    if (!title) return null;

    const year =
      parseYearFromNameAndYear(data.nameAndYear) ??
      parseYearFromOgTitle(doc);

    return {
      title,
      type: "movie",
      subtitle: year ?? "unknown",
      year,
    };
  } catch {
    return null;
  }
}

function parseFromJsonLd(doc: Document): ParsedMedia | null {
  for (const block of readJsonLd(doc)) {
    if (typeof block !== "object" || block === null) continue;
    const work = pickMovie(block as Record<string, unknown>);
    if (!work) continue;

    const title = stringField(work.name);
    if (!title) continue;

    const year =
      parseYearFromReleasedEvent(work.releasedEvent) ??
      parseYearFromOgTitle(doc);
    const genres = normalizeGenres(work.genre);
    const score = parseAggregateRating(work.aggregateRating);
    const durationOrSeasons = parseDurationFromJsonLd(work);

    const subtitleParts: string[] = [];
    if (year) subtitleParts.push(year);
    else subtitleParts.push("unknown");
    if (durationOrSeasons) subtitleParts.push(durationOrSeasons);
    const genreLabel = genres.slice(0, 2).join("/");
    if (genreLabel) subtitleParts.push(genreLabel);

    return {
      title,
      type: resolveLetterboxdType(work),
      subtitle: subtitleParts.join(" · "),
      year,
      genre: genreLabel || undefined,
      durationOrSeasons,
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
    genre: base.genre ?? dom.genre,
    subtitle: dom.subtitle || base.subtitle,
    durationOrSeasons: dom.durationOrSeasons ?? base.durationOrSeasons,
    imdbRating: dom.imdbRating ?? base.imdbRating,
  };
}

function parseFromDom(doc: Document): ParsedMedia | null {
  const title =
    parseProductionData(doc)?.title ??
    parseH1Title(doc) ??
    parseTitleFromOg(doc);
  if (!title) return null;

  const year =
    parseYearFromOgTitle(doc) ??
    parseYearFromDocumentTitle(doc);
  const durationOrSeasons = parseRuntimeFromDom(doc);
  const score = parseRatingFromMeta(doc) ?? parseRatingFromDom(doc);
  const genres = parseGenresFromDom(doc);
  const genreLabel = genres.slice(0, 2).join("/") || undefined;

  const subtitleParts: string[] = [];
  if (year) subtitleParts.push(year);
  else subtitleParts.push("unknown");
  if (durationOrSeasons) subtitleParts.push(durationOrSeasons);
  if (genreLabel) subtitleParts.push(genreLabel);

  return {
    title,
    type: "movie",
    subtitle: subtitleParts.join(" · "),
    year,
    genre: genreLabel,
    durationOrSeasons,
    imdbRating: score,
  };
}

function readJsonLd(doc: Document): unknown[] {
  const out: unknown[] = [];
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = script.textContent ?? "";
    const cleaned = raw.replace(/^\/\*[\s\S]*?\*\/\s*/, "").trim();
    try {
      const parsed = JSON.parse(cleaned);
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

function pickMovie(obj: Record<string, unknown>): Record<string, unknown> | null {
  const type = normalizeType(obj["@type"]);
  if (type === "Movie") return obj;
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

function resolveLetterboxdType(work: Record<string, unknown>): MediaType {
  return normalizeType(work["@type"]) === "Movie" ? "movie" : "movie";
}

function normalizeGenres(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values
    .map((g) => (typeof g === "string" ? g.trim() : ""))
    .filter(Boolean);
}

function parseAggregateRating(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rating = raw as Record<string, unknown>;
  const value = rating.ratingValue ?? rating.value;
  if (typeof value === "number") return formatLetterboxdScore(String(value));
  if (typeof value === "string") return formatLetterboxdScore(value);
  return undefined;
}

function parseYearFromReleasedEvent(raw: unknown): string | undefined {
  const events = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const startDate = (event as Record<string, unknown>).startDate;
    if (typeof startDate === "string") {
      const year = normalizeYear(startDate);
      if (year) return year;
    }
  }
  return undefined;
}

function parseDurationFromJsonLd(work: Record<string, unknown>): string | undefined {
  const duration = stringField(work.duration);
  if (!duration) return undefined;
  return parseIsoDuration(duration) ?? duration;
}

function parseIsoDuration(value: string): string | undefined {
  const match = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!match) return undefined;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const total = hours * 60 + minutes;
  if (total <= 0) return undefined;
  return formatMinutes(total);
}

function parseYearFromNameAndYear(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/\((\d{4})\)/);
  return match ? normalizeYear(match[1]) : undefined;
}

function parseYearFromOgTitle(doc: Document): string | undefined {
  const og = doc
    .querySelector('meta[property="og:title"]')
    ?.getAttribute("content");
  if (!og) return undefined;
  const match = og.match(/\((\d{4})\)/);
  return match ? normalizeYear(match[1]) : undefined;
}

function parseTitleFromOg(doc: Document): string | undefined {
  const og = doc
    .querySelector('meta[property="og:title"]')
    ?.getAttribute("content");
  if (!og) return undefined;
  return og.replace(/\s*\(\d{4}\)\s*$/, "").trim() || undefined;
}

function parseH1Title(doc: Document): string | undefined {
  return doc.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim();
}

function parseYearFromDocumentTitle(doc: Document): string | undefined {
  const match = doc.title?.match(/\((\d{4})\)/);
  return match ? normalizeYear(match[1]) : undefined;
}

function parseRuntimeFromDom(doc: Document): string | undefined {
  for (const el of doc.querySelectorAll(".text-footer, p, span, a")) {
    const text = el.textContent?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim() ?? "";
    const match = text.match(/^(\d{1,4})\s*mins?\b/i);
    if (match) return formatMinutes(Number(match[1]));
  }

  const bodyMatch = doc.body?.textContent
    ?.replace(/\u00a0/g, " ")
    .match(/(\d{1,4})\s*mins?\b/i);
  if (bodyMatch) return formatMinutes(Number(bodyMatch[1]));

  return undefined;
}

function formatMinutes(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function parseRatingFromMeta(doc: Document): string | undefined {
  const twitter = doc
    .querySelector('meta[name="twitter:data2"]')
    ?.getAttribute("content");
  if (twitter) {
    const match = twitter.match(/([\d.]+)\s*out\s*of\s*5/i);
    if (match) return formatLetterboxdScore(match[1]);
  }
  return undefined;
}

function parseRatingFromDom(doc: Document): string | undefined {
  const bodyText = doc.body?.textContent?.replace(/\s+/g, " ") ?? "";
  const match = bodyText.match(/Average rating[\s\S]{0,40}?([\d.]+)\s*out\s*of\s*5/i);
  if (match) return formatLetterboxdScore(match[1]);
  return undefined;
}

function parseGenresFromDom(doc: Document): string[] {
  const genres: string[] = [];
  for (const link of doc.querySelectorAll('a[href*="/films/genre/"]')) {
    const name = link.textContent?.replace(/\s+/g, " ").trim();
    if (!name || genres.includes(name)) continue;
    genres.push(name);
  }
  return genres;
}

function formatLetterboxdScore(raw: string): string | undefined {
  const num = Number.parseFloat(raw);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return num.toFixed(2);
}
