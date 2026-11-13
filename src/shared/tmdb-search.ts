/**
 * Searching TMDB from the shelf's search box and adding what you find. Everything here is pure: the requests are made
 * by the background worker (see searchTmdb and addFromTmdb in main.ts).
 */
import { normalizeTitle } from "./fuzzy.js";
import type { NewItem } from "./items.js";
import type { SavedItem, TmdbInfo, TmdbKind } from "./types.js";

export type SearchType = "movie" | "series" | "anime";

export interface TmdbSearchResult {
  id: number;
  kind: TmdbKind;
  /** What KeepShelf would file it as. */
  type: SearchType;
  title: string;
  year?: string;
  overview?: string;
  /** TMDB poster path such as "/abc.jpg". */
  posterPath?: string;
  /** TMDB community score, 0 to 10. */
  rating?: number;
  /** "franchise": a sequel, remake or part of the same series as the title the list was made for. */
  group?: "franchise";
}

/** How the search box can reach TMDB: a row you tap, the same plus automatic when nothing on the shelf matches, or never. */
export const SEARCH_MODES = ["row", "auto", "off"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];
export const DEFAULT_SEARCH_MODE: SearchMode = "row";

export const MIN_QUERY = 2;
/** Automatic search waits for a few more letters, so it doesn't send half-typed words. */
export const MIN_AUTO_QUERY = 3;
export const AUTO_SEARCH_DELAY_MS = 700;
export const MAX_QUERY = 100;
export const MAX_RESULTS = 20;
/** Long enough for any TMDB description, so the hover can show all of it. */
export const MAX_OVERVIEW = 1500;

const ANIMATION_GENRE = 16;

const round1 = (n: number) => Math.round(n * 10) / 10;

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : undefined;
};

const yearOf = (value: unknown): string | undefined => {
  const m = typeof value === "string" ? /^(\d{4})/.exec(value) : null;
  return m ? m[1] : undefined;
};

const isPosterPath = (value: unknown): value is string => typeof value === "string" && /^\/[\w.-]{1,80}\.(jpg|jpeg|png)$/i.test(value);

/**
 * TMDB files anime as animation, so a Japanese animated title is anime and everything else is a movie or a series.
 * It will sometimes be wrong (Edit changes it), which is better than asking every time.
 */
export function guessType(kind: TmdbKind, genreIds: unknown, language: unknown, countries: unknown): SearchType {
  const animated = Array.isArray(genreIds) && genreIds.includes(ANIMATION_GENRE);
  const japanese = language === "ja" || (Array.isArray(countries) && countries.includes("JP"));
  if (animated && japanese) return "anime";
  return kind === "movie" ? "movie" : "series";
}

interface RawResult {
  id?: unknown;
  media_type?: unknown;
  title?: unknown;
  name?: unknown;
  release_date?: unknown;
  first_air_date?: unknown;
  overview?: unknown;
  poster_path?: unknown;
  vote_average?: unknown;
  vote_count?: unknown;
  genre_ids?: unknown;
  original_language?: unknown;
  origin_country?: unknown;
}

/**
 * Turns a TMDB list (search or recommendations) into the few fields the results view needs. Each entry says whether it
 * is a movie or a show; a list that doesn't say, such as one fetched for a known title, passes `defaultKind`.
 * People and anything odd are dropped.
 */
export function parseResultList(raw: unknown, defaultKind?: TmdbKind): TmdbSearchResult[] {
  const list = (raw as { results?: unknown } | null)?.results;
  if (!Array.isArray(list)) return [];
  const out: TmdbSearchResult[] = [];
  const seen = new Set<string>();
  for (const entry of list as RawResult[]) {
    if (!entry || typeof entry !== "object") continue;
    const kind: TmdbKind | undefined =
      entry.media_type === "movie" ? "movie" : entry.media_type === "tv" ? "tv" : entry.media_type === undefined ? defaultKind : undefined;
    if (!kind || typeof entry.id !== "number" || !Number.isInteger(entry.id) || entry.id <= 0) continue;
    const key = `${kind}:${entry.id}`;
    const title = text(kind === "movie" ? entry.title : entry.name, 200);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    const result: TmdbSearchResult = { id: entry.id, kind, type: guessType(kind, entry.genre_ids, entry.original_language, entry.origin_country), title };
    const year = yearOf(kind === "movie" ? entry.release_date : entry.first_air_date);
    if (year) result.year = year;
    const overview = text(entry.overview, MAX_OVERVIEW);
    if (overview) result.overview = overview;
    if (isPosterPath(entry.poster_path)) result.posterPath = entry.poster_path;
    if (typeof entry.vote_average === "number" && entry.vote_average > 0 && typeof entry.vote_count === "number" && entry.vote_count > 0) {
      result.rating = round1(Math.min(entry.vote_average, 10));
    }
    out.push(result);
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

/** TMDB's /search/multi answer: movies and shows, in TMDB's order. */
export const parseSearchResults = (raw: unknown): TmdbSearchResult[] => parseResultList(raw);

const clean = (title: string): string =>
  title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const withoutArticle = (title: string): string => title.replace(/^(the|a|an) /, "");

/**
 * The name a whole franchise shares: "Drishyam 2" and "Drishyam (2015)" are "drishyam", "Mission: Impossible - Fallout"
 * is "mission". Subtitles after a colon or dash and a trailing number, roman numeral or "part 2" are dropped.
 */
export function franchiseBase(title: string): string {
  let t = clean(title).split(/\s*[:\u2013\u2014]\s*|\s+-\s+/)[0];
  t = t.replace(/\s+(?:(?:part|chapter|season|vol|volume)\.?\s*)?(?:\d+|[ivx]{1,4})$/, "");
  return t.trim();
}

/**
 * Whether a title belongs with a franchise name: the same name (a remake in another language), or the name followed by
 * a number, roman numeral, "part", or a subtitle. "Dark Matter" is not part of "Dark".
 */
export function matchesFranchise(base: string, title: string): boolean {
  const b = withoutArticle(clean(base));
  if (b.length < 3) return false;
  const t = withoutArticle(clean(title));
  if (t === b) return true;
  if (!t.startsWith(b)) return false;
  return /^(?::|\s+-\s+|\s+(?:part|chapter|season|vol|volume)\b|\s+\d+\b|\s+[ivx]{1,4}\b)/.test(t.slice(b.length));
}

/**
 * The list for "More like this": the title's own franchise first (sequels, remakes, parts of its collection), oldest
 * first, then what TMDB recommends. A title is never listed twice, or recommended to itself.
 */
export function mergeFranchise(parts: {
  self: Pick<TmdbSearchResult, "id" | "kind">;
  collection: TmdbSearchResult[];
  named: TmdbSearchResult[];
  recommended: TmdbSearchResult[];
}): TmdbSearchResult[] {
  const key = (r: Pick<TmdbSearchResult, "id" | "kind">) => `${r.kind}:${r.id}`;
  const seen = new Set<string>([key(parts.self)]);
  const franchise: TmdbSearchResult[] = [];
  for (const r of [...parts.collection, ...parts.named]) {
    if (seen.has(key(r))) continue;
    seen.add(key(r));
    franchise.push({ ...r, group: "franchise" });
  }
  franchise.sort((a, b) => (a.year ?? "9999").localeCompare(b.year ?? "9999") || a.title.localeCompare(b.title));
  const rest = parts.recommended.filter((r) => {
    if (seen.has(key(r))) return false;
    seen.add(key(r));
    return true;
  });
  return [...franchise, ...rest];
}

/** Checks a result that came back from the popup before anything is saved from it. */
export function sanitizeResult(raw: unknown): TmdbSearchResult | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number" || !Number.isInteger(r.id) || r.id <= 0) return undefined;
  if (r.kind !== "movie" && r.kind !== "tv") return undefined;
  if (r.type !== "movie" && r.type !== "series" && r.type !== "anime") return undefined;
  const title = text(r.title, 200);
  if (!title) return undefined;
  const result: TmdbSearchResult = { id: r.id, kind: r.kind, type: r.type, title };
  const year = typeof r.year === "string" && /^\d{4}$/.test(r.year) ? r.year : undefined;
  if (year) result.year = year;
  return result;
}

/** The saved item this result already is, if there is one: the same TMDB title, or the same name and year. */
export function findOnShelf(result: Pick<TmdbSearchResult, "id" | "kind" | "title" | "year">, items: SavedItem[]): SavedItem | undefined {
  const wanted = normalizeTitle(result.title);
  return items.find((i) => {
    if (i.tmdb && i.tmdb.id === result.id && i.tmdb.kind === result.kind) return true;
    if (!result.year || !i.year || i.year !== result.year) return false;
    return (i.type === "movie" || i.type === "series" || i.type === "anime") && normalizeTitle(i.title) === wanted;
  });
}

export const tmdbPageUrl = (result: Pick<TmdbSearchResult, "id" | "kind">): string => `https://www.themoviedb.org/${result.kind}/${result.id}`;

/** The item to save for a result, with its TMDB info already in place so it is never looked up (and mismatched) again. */
export function newItemFromResult(result: TmdbSearchResult, info: TmdbInfo): NewItem {
  return {
    type: result.type,
    title: result.title,
    ...(result.year ? { year: result.year } : {}),
    subtitle: result.year ?? "",
    googleQuery: [result.title, result.year].filter(Boolean).join(" "),
    sourceUrl: tmdbPageUrl(result),
    tmdb: info,
  };
}

/** Whether to show the online search for what is typed, and whether it should start by itself. */
export function onlineSearchState(options: {
  mode: SearchMode;
  tab: string;
  query: string;
  localMatches: number;
}): { offer: boolean; auto: boolean; query: string } {
  const query = options.query.trim().replace(/\s+/g, " ").slice(0, MAX_QUERY);
  const offer = options.mode !== "off" && options.tab === "media" && query.length >= MIN_QUERY;
  const auto = offer && options.mode === "auto" && options.localMatches === 0 && query.length >= MIN_AUTO_QUERY;
  return { offer, auto, query };
}
