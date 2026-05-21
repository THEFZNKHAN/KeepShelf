import type { MediaType, ParsedMedia } from "./types.js";
import { normalizeYear } from "./year.js";

const TITLE_PATH = /^\/title\/tt\d+/i;

const ANIME_GENRES = /\banimation\b/i;
const SKIP_GENRES =
  /^(action epic|adventure epic|fantasy epic|epic|dark fantasy|sword & sorcery|psychological drama|tragedy)$/i;

export function isImdbTitlePage(doc: Document = document): boolean {
  return TITLE_PATH.test(doc.location?.pathname ?? "");
}

export function imdbIdFromUrl(href: string): string | undefined {
  return href.match(/\/title\/(tt\d+)/i)?.[1];
}

export function parseImdbPage(doc: Document): ParsedMedia | null {
  const entity = findMainEntity(doc);
  if (entity) return entity;

  const fromMeta = parseFromDocumentMeta(doc);
  if (fromMeta) return fromMeta;

  return parseFromDom(doc);
}

function findMainEntity(doc: Document): ParsedMedia | null {
  for (const block of readJsonLd(doc)) {
    const work = pickCreativeWork(block);
    if (work) return mapCreativeWork(work, doc);
  }
  return null;
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
  if (type === "TVEpisode" && obj.partOfSeries) {
    const series = obj.partOfSeries as Record<string, unknown>;
    return pickCreativeWork(series) ?? series;
  }
  if (type === "Movie" || type === "TVSeries" || type === "TVMiniSeries") {
    return obj;
  }
  return null;
}

function normalizeType(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return undefined;
}

function mapCreativeWork(
  work: Record<string, unknown>,
  doc: Document
): ParsedMedia | null {
  const title = stringField(work.name);
  if (!title) return null;

  const schemaType = normalizeType(work["@type"]);
  const genres = normalizeGenres(work.genre);
  const type = resolveImdbType(schemaType, genres, doc);
  const year = normalizeYear(
    stringField(work.datePublished) ?? parseYearFromTitle(doc.title)
  );
  const imdbRating = parseRating(work.aggregateRating);
  const durationOrSeasons = durationLabel(work, schemaType);
  const subtitle = buildSubtitle(year, genres, durationOrSeasons);

  return {
    title,
    type,
    subtitle,
    year,
    genre: genres.slice(0, 2).join("/") || undefined,
    durationOrSeasons,
    imdbRating,
  };
}

function resolveImdbType(
  schemaType: string | undefined,
  genres: string[],
  doc: Document
): MediaType {
  const titleType = parseTitleKind(doc.title);
  const genreText = genres.join(" ");
  if (ANIME_GENRES.test(genreText) || /\banime\b/i.test(doc.title)) {
    return "anime";
  }
  if (schemaType === "Movie") return "movie";
  if (titleType === "movie") return "movie";
  return "series";
}

function normalizeGenres(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values
    .map((g) => (typeof g === "string" ? g.trim() : ""))
    .filter(Boolean)
    .filter((g) => !SKIP_GENRES.test(g));
}

function parseRating(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = (raw as Record<string, unknown>).ratingValue;
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim() || undefined;
  return undefined;
}

function durationLabel(
  work: Record<string, unknown>,
  schemaType: string | undefined
): string | undefined {
  if (schemaType === "Movie" || schemaType === "VideoObject") {
    return formatIsoDuration(stringField(work.duration));
  }
  const seasons = work.numberOfSeasons;
  if (typeof seasons === "number" && seasons > 0) {
    return `${seasons} season${seasons === 1 ? "" : "s"}`;
  }
  if (typeof seasons === "string" && /^\d+$/.test(seasons)) {
    const n = Number(seasons);
    return `${n} season${n === 1 ? "" : "s"}`;
  }
  return undefined;
}

function formatIsoDuration(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const h = raw.match(/(\d+)H/i)?.[1];
  const m = raw.match(/(\d+)M/i)?.[1];
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return undefined;
}

function stringField(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function buildSubtitle(
  year: string | undefined,
  genres: string[],
  durationOrSeasons: string | undefined
): string {
  const parts: string[] = [];
  if (year) parts.push(year);
  const genre = genres.slice(0, 2).join("/");
  if (genre) parts.push(genre);
  if (durationOrSeasons) parts.push(durationOrSeasons);
  return parts.join(" · ") || "IMDb";
}

function parseFromDocumentMeta(doc: Document): ParsedMedia | null {
  const ogTitle =
    doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ??
    doc.title;
  const parsed = parseTitleLine(ogTitle);
  if (!parsed?.title) return null;

  const imdbRating = parseDomRating(doc);
  const durationOrSeasons =
    parseDomSeasons(doc) ?? parseDomRuntime(doc);
  const genre = parseDomGenres(doc);
  const type =
    parsed.kind === "movie"
      ? "movie"
      : ANIME_GENRES.test(genre)
        ? "anime"
        : "series";

  return {
    title: parsed.title,
    type,
    subtitle: buildSubtitle(parsed.year, genre.split("/"), durationOrSeasons),
    year: parsed.year,
    genre: genre || undefined,
    durationOrSeasons,
    imdbRating,
  };
}

function parseFromDom(doc: Document): ParsedMedia | null {
  const title =
    doc.querySelector('[data-testid="hero__primary-text"]')?.textContent?.trim() ??
    doc.querySelector("h1")?.textContent?.trim();
  if (!title) return null;

  const year = parseYearFromTitle(doc.title);
  const imdbRating = parseDomRating(doc);
  const durationOrSeasons =
    parseDomSeasons(doc) ?? parseDomRuntime(doc);
  const genre = parseDomGenres(doc);
  const kind = parseTitleKind(doc.title);
  const type =
    kind === "movie"
      ? "movie"
      : ANIME_GENRES.test(genre)
        ? "anime"
        : "series";

  return {
    title,
    type,
    subtitle: buildSubtitle(year, genre.split("/"), durationOrSeasons),
    year,
    genre: genre || undefined,
    durationOrSeasons,
    imdbRating,
  };
}

function parseTitleLine(
  raw: string
): { title: string; year?: string; kind: "movie" | "series" } | null {
  const match = raw.match(
    /^(.*?)\s*\((?:(TV Series|TV Mini Series|Video|Movie)\s*)?(\d{4})(?:[–-]\d{4})?\)\s*(?:-\s*IMDb)?/i
  );
  if (!match) return null;
  const kindToken = match[2]?.toLowerCase() ?? "";
  const kind =
    kindToken.includes("movie") || kindToken === "video" ? "movie" : "series";
  return {
    title: match[1].trim(),
    year: match[3],
    kind,
  };
}

function parseTitleKind(docTitle: string): "movie" | "series" {
  if (/\((?:Movie|Video)\s+\d{4}/i.test(docTitle)) return "movie";
  return "series";
}

function parseYearFromTitle(docTitle: string): string | undefined {
  return parseTitleLine(docTitle)?.year;
}

function parseDomRating(doc: Document): string | undefined {
  const score = doc.querySelector(
    '[data-testid="hero-rating-bar__aggregate-rating__score"]'
  );
  const text = score?.textContent?.trim();
  if (text && /^\d+(?:\.\d+)?$/.test(text)) return text;

  const aria = doc.querySelector('[aria-label*="IMDb rating"]');
  const fromAria = aria
    ?.getAttribute("aria-label")
    ?.match(/(\d+(?:\.\d+)?)\s*out of/i)?.[1];
  return fromAria;
}

function parseDomRuntime(doc: Document): string | undefined {
  for (const el of doc.querySelectorAll(
    '[data-testid="title-techspec_runtime"] .ipc-metadata-list-item__content-container, [data-testid="techspec-runtime"]'
  )) {
    const text = el.textContent?.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return undefined;
}

function parseDomSeasons(doc: Document): string | undefined {
  for (const el of doc.querySelectorAll(
    '[data-testid="title-techspec_seasons"] .ipc-metadata-list-item__content-container, [data-testid="techspec-seasons"]'
  )) {
    const text = el.textContent?.replace(/\s+/g, " ").trim();
    const match = text?.match(/(\d+)\s+season/i);
    if (match) {
      const n = Number(match[1]);
      return `${n} season${n === 1 ? "" : "s"}`;
    }
  }
  return undefined;
}

function parseDomGenres(doc: Document): string {
  const genres: string[] = [];
  for (const link of doc.querySelectorAll(
    '[data-testid="genres"] a, .ipc-chip-list a'
  )) {
    const text = link.textContent?.trim();
    if (!text || SKIP_GENRES.test(text)) continue;
    if (!genres.includes(text)) genres.push(text);
    if (genres.length >= 2) break;
  }
  return genres.join("/");
}
