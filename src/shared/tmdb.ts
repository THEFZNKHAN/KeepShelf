import { normalizeTitle, similarity } from "./fuzzy.js";
import { bookGenres } from "./openlibrary.js";
import { normalizeTags } from "./user-data.js";
import type { SavedItem, TmdbInfo, TmdbKind } from "./types.js";

export const TMDB_API = "https://api.themoviedb.org/3";
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/";
export const TMDB_NOTICE =
  "This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.";

const DAY = 24 * 60 * 60 * 1000;
/** TMDB's terms forbid caching its data for longer than six months, so refresh well before that. */
export const REFRESH_AFTER_MS = 150 * DAY;
export const PURGE_AFTER_MS = 180 * DAY;

const MATCH_THRESHOLD = 0.85;

export type TmdbAuth = { kind: "bearer" | "key"; value: string };
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class TmdbError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/** Accepts a v4 "API Read Access Token" (a JWT) or a v3 API key (32 hex characters). */
export function parseTmdbToken(raw: string): TmdbAuth | undefined {
  const value = raw.trim();
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) return { kind: "bearer", value };
  if (/^[a-f0-9]{32}$/i.test(value)) return { kind: "key", value };
  return undefined;
}

export interface TmdbClient {
  get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T>;
}

export function createTmdbClient(auth: TmdbAuth, fetchImpl: FetchLike = fetch as unknown as FetchLike): TmdbClient {
  return {
    async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
      const url = new URL(`${TMDB_API}${path}`);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
      }
      const headers: Record<string, string> = { accept: "application/json" };
      if (auth.kind === "bearer") headers.Authorization = `Bearer ${auth.value}`;
      else url.searchParams.set("api_key", auth.value);

      let response;
      try {
        response = await fetchImpl(url.toString(), { headers });
      } catch {
        throw new TmdbError("Could not reach TMDB. Check your connection.");
      }
      if (response.status === 401) throw new TmdbError("TMDB rejected this token. Check it in Settings.", 401);
      if (response.status === 429) throw new TmdbError("TMDB is rate limiting requests. Try again in a moment.", 429);
      if (response.status === 404) throw new TmdbError("Not found on TMDB.", 404);
      if (!response.ok) throw new TmdbError(`TMDB returned an error (${response.status}).`, response.status);
      return (await response.json()) as T;
    },
  };
}

export function isEnrichable(item: Pick<SavedItem, "type">): boolean {
  return item.type === "movie" || item.type === "series" || item.type === "anime";
}

export function imdbIdFromUrl(url: string | undefined): string | undefined {
  return /\/title\/(tt\d{5,})/.exec(url ?? "")?.[1];
}

interface SearchResult {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  popularity?: number;
}

function resultYear(result: SearchResult): number | undefined {
  const year = parseInt((result.release_date ?? result.first_air_date ?? "").slice(0, 4), 10);
  return Number.isNaN(year) ? undefined : year;
}

/** The best search result for a title (and year, when known), or undefined rather than a bad guess. */
export function pickBestMatch(
  results: SearchResult[],
  wanted: { title: string; year?: string }
): SearchResult | undefined {
  const target = normalizeTitle(wanted.title);
  const wantedYear = parseInt(wanted.year ?? "", 10);
  let best: { result: SearchResult; score: number } | undefined;

  for (const result of results) {
    const year = resultYear(result);
    if (!Number.isNaN(wantedYear) && year !== undefined && Math.abs(year - wantedYear) > 1) continue;
    const names = [result.title, result.name, result.original_title, result.original_name].filter(
      (n): n is string => Boolean(n)
    );
    const score = Math.max(0, ...names.map((n) => similarity(target, normalizeTitle(n))));
    if (score < MATCH_THRESHOLD) continue;
    if (!best || score > best.score || (score === best.score && (result.popularity ?? 0) > (best.result.popularity ?? 0))) {
      best = { result, score };
    }
  }
  return best?.result;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

interface Details {
  id: number;
  genres?: Array<{ name?: string }>;
  overview?: string;
  tagline?: string;
  vote_average?: number;
  vote_count?: number;
  runtime?: number | null;
  episode_run_time?: number[];
  last_episode_to_air?: { runtime?: number | null } | null;
  number_of_seasons?: number;
  number_of_episodes?: number;
  seasons?: Array<{ season_number?: number; episode_count?: number }>;
  next_episode_to_air?: { air_date?: string | null; season_number?: number; episode_number?: number } | null;
  release_date?: string | null;
  status?: string;
  poster_path?: string | null;
  imdb_id?: string | null;
  external_ids?: { imdb_id?: string | null };
  release_dates?: { results?: Array<{ iso_3166_1?: string; release_dates?: Array<{ certification?: string }> }> };
  content_ratings?: { results?: Array<{ iso_3166_1?: string; rating?: string }> };
}

function certificationOf(kind: TmdbKind, d: Details): string | undefined {
  if (kind === "movie") {
    const us = d.release_dates?.results?.find((r) => r.iso_3166_1 === "US");
    return us?.release_dates?.map((r) => r.certification?.trim()).find(Boolean) || undefined;
  }
  return d.content_ratings?.results?.find((r) => r.iso_3166_1 === "US")?.rating?.trim() || undefined;
}

const isIsoDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function nextEpisodeOf(kind: TmdbKind, d: Details): TmdbInfo["nextEpisode"] {
  const next = d.next_episode_to_air;
  if (kind !== "tv" || !next || !isIsoDay(next.air_date)) return undefined;
  const season = next.season_number;
  const episode = next.episode_number;
  if (!Number.isInteger(season) || !Number.isInteger(episode)) return undefined;
  return { airDate: next.air_date, season: season!, episode: episode! };
}

/** Episodes per regular season, ordered by season number. Specials (season 0) are left out. */
function seasonEpisodesOf(kind: TmdbKind, d: Details): number[] | undefined {
  if (kind !== "tv" || !Array.isArray(d.seasons)) return undefined;
  const counts = d.seasons
    .filter((s) => typeof s.season_number === "number" && s.season_number > 0)
    .sort((a, b) => a.season_number! - b.season_number!)
    .map((s) => (typeof s.episode_count === "number" && s.episode_count >= 0 ? Math.floor(s.episode_count) : 0));
  return counts.length > 0 ? counts : undefined;
}

export function toTmdbInfo(kind: TmdbKind, d: Details, now = Date.now()): TmdbInfo {
  const votes = d.vote_count ?? 0;
  const info: TmdbInfo = {
    id: d.id,
    kind,
    genres: (d.genres ?? []).map((g) => g.name?.trim() ?? "").filter(Boolean),
    fetchedAt: now,
  };
  const imdbId = d.imdb_id || d.external_ids?.imdb_id;
  if (imdbId) info.imdbId = imdbId;
  if (d.overview?.trim()) info.overview = d.overview.trim();
  if (d.tagline?.trim()) info.tagline = d.tagline.trim();
  if (d.vote_average && votes > 0) {
    info.rating = round1(d.vote_average);
    info.votes = votes;
  }
  const certification = certificationOf(kind, d);
  if (certification) info.certification = certification;
  // TMDB often leaves episode_run_time empty for shows; the latest episode is a good stand-in.
  const runtime = kind === "movie" ? d.runtime : d.episode_run_time?.[0] || d.last_episode_to_air?.runtime;
  if (runtime) info.runtimeMinutes = runtime;
  if (d.number_of_seasons) info.seasons = d.number_of_seasons;
  if (d.number_of_episodes) info.episodes = d.number_of_episodes;
  const seasonEpisodes = seasonEpisodesOf(kind, d);
  if (seasonEpisodes) info.seasonEpisodes = seasonEpisodes;
  const nextEpisode = nextEpisodeOf(kind, d);
  if (nextEpisode) info.nextEpisode = nextEpisode;
  if (kind === "movie" && isIsoDay(d.release_date)) info.releaseDate = d.release_date;
  if (d.status) info.status = d.status;
  if (d.poster_path) info.posterPath = d.poster_path;
  return info;
}

const DETAIL_APPEND: Record<TmdbKind, string> = {
  movie: "release_dates",
  tv: "external_ids,content_ratings",
};

export async function fetchDetails(client: TmdbClient, kind: TmdbKind, id: number, now = Date.now()): Promise<TmdbInfo> {
  const details = await client.get<Details>(`/${kind}/${id}`, { append_to_response: DETAIL_APPEND[kind], language: "en-US" });
  return toTmdbInfo(kind, details, now);
}

/** Finds the TMDB entry for a saved item: exact by IMDb id when the source URL has one, otherwise by title and year. */
export async function lookupInfo(
  client: TmdbClient,
  item: Pick<SavedItem, "type" | "title" | "year" | "sourceUrl">,
  now = Date.now()
): Promise<TmdbInfo | undefined> {
  // Anime can be a series or a film, so try both.
  const kinds: TmdbKind[] = item.type === "movie" ? ["movie"] : item.type === "series" ? ["tv"] : ["tv", "movie"];

  const imdbId = imdbIdFromUrl(item.sourceUrl);
  if (imdbId) {
    const found = await client.get<{ movie_results?: SearchResult[]; tv_results?: SearchResult[] }>(`/find/${imdbId}`, {
      external_source: "imdb_id",
    });
    for (const kind of kinds) {
      const hit = (kind === "movie" ? found.movie_results : found.tv_results)?.[0];
      if (hit) return fetchDetails(client, kind, hit.id, now);
    }
  }

  for (const kind of kinds) {
    const yearParam = kind === "movie" ? "year" : "first_air_date_year";
    const search = await client.get<{ results?: SearchResult[] }>(`/search/${kind}`, {
      query: item.title,
      [yearParam]: item.year,
    });
    const hit = pickBestMatch(search.results ?? [], { title: item.title, year: item.year });
    if (hit) return fetchDetails(client, kind, hit.id, now);
  }
  return undefined;
}

export function isStale(info: Pick<TmdbInfo, "fetchedAt">, now = Date.now()): boolean {
  return now - info.fetchedAt > REFRESH_AFTER_MS;
}

/** Shows saved before per-season counts existed: worth one refresh so the season tracker can appear. */
export function lacksSeasons(info: Pick<TmdbInfo, "kind" | "seasons" | "seasonEpisodes">): boolean {
  return info.kind === "tv" && (info.seasons ?? 0) > 0 && !info.seasonEpisodes;
}

export function mustPurge(info: Pick<TmdbInfo, "fetchedAt">, now = Date.now()): boolean {
  return now - info.fetchedAt > PURGE_AFTER_MS;
}

/** Validates TMDB data read from a backup. Anything malformed or past the retention limit is dropped. */
export function sanitizeTmdb(raw: unknown, now = Date.now()): TmdbInfo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number" || (r.kind !== "movie" && r.kind !== "tv")) return undefined;
  if (typeof r.fetchedAt !== "number" || mustPurge({ fetchedAt: r.fetchedAt }, now)) return undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const info: TmdbInfo = {
    id: r.id,
    kind: r.kind,
    genres: Array.isArray(r.genres) ? r.genres.filter((g): g is string => typeof g === "string" && g.trim() !== "") : [],
    fetchedAt: r.fetchedAt,
  };
  const seasonEpisodes =
    Array.isArray(r.seasonEpisodes) && r.seasonEpisodes.length > 0 && r.seasonEpisodes.length <= 100 &&
    r.seasonEpisodes.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100000)
      ? (r.seasonEpisodes as number[])
      : undefined;
  const next = r.nextEpisode as Record<string, unknown> | undefined;
  const nextEpisode =
    next && typeof next === "object" && isIsoDay(next.airDate) && Number.isInteger(next.season) && Number.isInteger(next.episode)
      ? { airDate: next.airDate, season: next.season as number, episode: next.episode as number }
      : undefined;
  const optional: Partial<TmdbInfo> = {
    seasonEpisodes,
    nextEpisode,
    releaseDate: isIsoDay(r.releaseDate) ? r.releaseDate : undefined,
    imdbId: str(r.imdbId),
    overview: str(r.overview),
    tagline: str(r.tagline),
    rating: num(r.rating),
    votes: num(r.votes),
    certification: str(r.certification),
    runtimeMinutes: num(r.runtimeMinutes),
    seasons: num(r.seasons),
    episodes: num(r.episodes),
    status: str(r.status),
    posterPath: str(r.posterPath),
  };
  for (const [key, value] of Object.entries(optional)) if (value !== undefined) (info as unknown as Record<string, unknown>)[key] = value;
  return info;
}

/** Genre text for an item: what the source page gave us, else TMDB's genres. */
export function genreText(item: Pick<SavedItem, "genre" | "tmdb" | "bookInfo">): string {
  return item.genre?.trim() || item.tmdb?.genres.join(", ") || bookGenres(item.bookInfo).join(", ") || "";
}

export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * Runtime, season count or episode count from TMDB, written the way the page parsers write
 * `durationOrSeasons` ("2h 28m", "5 seasons", "37 eps"), so the rest of the app treats them the same.
 * It is computed on the fly and never stored, so it disappears together with the TMDB data.
 */
export function tmdbDuration(item: Pick<SavedItem, "type" | "tmdb">): string | undefined {
  const info = item.tmdb;
  if (!info) return undefined;
  if (info.kind === "movie") return info.runtimeMinutes ? formatMinutes(info.runtimeMinutes) : undefined;
  if (item.type === "anime") return info.episodes ? `${info.episodes} eps` : undefined;
  return info.seasons ? `${info.seasons} season${info.seasons === 1 ? "" : "s"}` : undefined;
}

/** What the page said, or else what TMDB says. */
export function durationText(item: Pick<SavedItem, "type" | "durationOrSeasons" | "tmdb">): string | undefined {
  return item.durationOrSeasons?.trim() || tmdbDuration(item);
}

/** Total episodes: the user's own number, else TMDB's, else "37 eps" from the page. */
export function totalEpisodes(item: Pick<SavedItem, "progressTotal" | "durationOrSeasons" | "tmdb">): number | undefined {
  if (item.progressTotal !== undefined) return item.progressTotal;
  if (item.tmdb?.episodes) return item.tmdb.episodes;
  const fromPage = /(\d+)\s*eps?\b/i.exec(item.durationOrSeasons ?? "");
  return fromPage ? Number(fromPage[1]) : undefined;
}

/** Genres as tags ("Sci-Fi & Fantasy" becomes sci-fi and fantasy), from the source page and from TMDB. */
export function genreTags(item: Pick<SavedItem, "genre" | "tmdb" | "bookInfo">): string[] {
  const fromPage = (item.genre ?? "").split(/[,/|]| & /);
  const fromTmdb = (item.tmdb?.genres ?? []).flatMap((g) => g.split(/ & /));
  const fromBook = bookGenres(item.bookInfo).flatMap((s) => s.split(/ & /));
  return normalizeTags([...fromPage, ...fromTmdb, ...fromBook]);
}

/** The tags the user added plus the genre tags. Genre tags are derived, so they are never stored on the item. */
export function allTags(item: Pick<SavedItem, "tags" | "genre" | "tmdb" | "bookInfo">): string[] {
  return [...new Set([...(item.tags ?? []), ...genreTags(item)])];
}

export function tmdbPosterUrl(item: Pick<SavedItem, "tmdb">, size = "w92"): string | undefined {
  return item.tmdb?.posterPath ? `${TMDB_IMAGE_BASE}${size}${item.tmdb.posterPath}` : undefined;
}
