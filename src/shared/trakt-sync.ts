/**
 * What to send to Trakt for each title. Pure: the background worker makes the requests.
 *
 * Trakt records every play it is sent, even the same episode twice, so each item remembers what has already been sent
 * (`trakt.sent`) and only the difference goes out. What was sent never shrinks: unmarking an episode here doesn't
 * remove it from Trakt, and marking it again doesn't record a second play.
 */
import { seasonTotals, watchedProgress } from "./seasons.js";
import type { SavedItem } from "./types.js";
import { statusOf } from "./user-data.js";

export interface TraktSent {
  /** The movie is in Trakt's history. */
  movie?: boolean;
  /** Episodes in history per season, from episode 1 (index 0 is season 1). */
  seasons?: number[];
  /** The rating Trakt has. */
  rating?: number;
  /** The title is on Trakt's watchlist. */
  watchlist?: boolean;
}

export interface TraktItemState {
  sent?: TraktSent;
  /** Why the last send didn't work for this title, such as "Not found on Trakt". */
  problem?: string;
  /** When it was last sent. */
  at?: number;
}

export interface TraktIds {
  tmdb: number;
  imdb?: string;
}

export interface SyncOptions {
  /** Keep the Trakt watchlist in step with titles marked "To watch". */
  watchlist: boolean;
}

/** One title's part of a send. */
export interface TraktChange {
  id: string;
  title: string;
  kind: "movie" | "show";
  ids: TraktIds;
  /** Add the movie to history. */
  movie?: boolean;
  /** Episodes to add, per season: [season number, first episode, last episode]. */
  episodes?: Array<[number, number, number]>;
  /** A rating to set, or null to remove the one Trakt has. */
  rating?: number | null;
  watchlist?: "add" | "remove";
  /** When the title was marked finished, for a catch-up send of a movie. */
  doneAt?: number;
  /** What has been sent once this change goes through. */
  next: TraktSent;
}

/** Only titles TMDB has matched can be sent: Trakt is told which title by its TMDB (and IMDb) id. */
export function traktIds(item: SavedItem): TraktIds | undefined {
  const tmdb = item.tmdb;
  if (!tmdb || (tmdb.kind !== "movie" && tmdb.kind !== "tv")) return undefined;
  if (item.type !== "movie" && item.type !== "series" && item.type !== "anime") return undefined;
  return { tmdb: tmdb.id, ...(tmdb.imdbId && /^tt\d{5,10}$/.test(tmdb.imdbId) ? { imdb: tmdb.imdbId } : {}) };
}

/** Where the title should stand on Trakt: watched episodes per season (or the movie), rating and watchlist. */
export function desiredState(item: SavedItem, options: SyncOptions): TraktSent {
  const status = statusOf(item);
  const out: TraktSent = {};
  if (item.tmdb?.kind === "movie") {
    out.movie = status === "done";
  } else {
    // Without TMDB's episode counts nothing is sent for the episodes: "the whole show" could add episodes not watched.
    const totals = seasonTotals(item);
    if (totals?.length) out.seasons = watchedProgress(item, totals);
  }
  if (item.myRating !== undefined) out.rating = item.myRating;
  out.watchlist = options.watchlist && status === "plan";
  return out;
}

/** What has to be sent for one title, or undefined when Trakt is already up to date with it. */
export function pendingChange(item: SavedItem, options: SyncOptions): TraktChange | undefined {
  const ids = traktIds(item);
  if (!ids) return undefined;
  const sent: TraktSent = item.trakt?.sent ?? {};
  const want = desiredState(item, options);
  const kind = item.tmdb?.kind === "movie" ? "movie" : "show";
  const change: TraktChange = { id: item.id, title: item.title, kind, ids, next: { ...sent }, ...(item.doneAt ? { doneAt: item.doneAt } : {}) };
  let any = false;

  if (kind === "movie" && want.movie && !sent.movie) {
    change.movie = true;
    change.next.movie = true;
    any = true;
  }
  if (kind === "show" && want.seasons) {
    const before = sent.seasons ?? [];
    const length = Math.max(before.length, want.seasons.length);
    const after: number[] = [];
    const episodes: Array<[number, number, number]> = [];
    for (let i = 0; i < length; i++) {
      const had = before[i] ?? 0;
      const wanted = want.seasons[i] ?? 0;
      if (wanted > had) episodes.push([i + 1, had + 1, wanted]);
      after[i] = Math.max(had, wanted);
    }
    if (episodes.length) {
      change.episodes = episodes;
      change.next.seasons = after;
      any = true;
    }
  }
  if (want.rating !== sent.rating) {
    if (want.rating !== undefined) {
      change.rating = want.rating;
      change.next.rating = want.rating;
      any = true;
    } else if (sent.rating !== undefined) {
      change.rating = null;
      delete change.next.rating;
      any = true;
    }
  }
  if (want.watchlist && !sent.watchlist) {
    change.watchlist = "add";
    change.next.watchlist = true;
    any = true;
  } else if (!want.watchlist && sent.watchlist) {
    change.watchlist = "remove";
    change.next.watchlist = false;
    any = true;
  }
  return any ? change : undefined;
}

/** Everything waiting to be sent. */
export function pendingChanges(items: SavedItem[], options: SyncOptions): TraktChange[] {
  const out: TraktChange[] = [];
  for (const item of items) {
    const change = pendingChange(item, options);
    if (change) out.push(change);
  }
  return out;
}

/** Splits changes into sends of a sensible size: at most `maxItems` titles and about `maxEpisodes` episodes each. */
export function batches(changes: TraktChange[], maxItems = 50, maxEpisodes = 1000): TraktChange[][] {
  const out: TraktChange[][] = [];
  let current: TraktChange[] = [];
  let episodes = 0;
  for (const change of changes) {
    const count = (change.episodes ?? []).reduce((sum, [, from, to]) => sum + (to - from + 1), 0);
    if (current.length && (current.length >= maxItems || episodes + count > maxEpisodes)) {
      out.push(current);
      current = [];
      episodes = 0;
    }
    current.push(change);
    episodes += count;
  }
  if (current.length) out.push(current);
  return out;
}

type Ids = { ids: Record<string, string | number> };
interface Body {
  movies?: Array<Ids & Record<string, unknown>>;
  shows?: Array<Ids & Record<string, unknown>>;
}

const idsOf = (ids: TraktIds) => ({ tmdb: ids.tmdb, ...(ids.imdb ? { imdb: ids.imdb } : {}) });
const put = (body: Body, kind: "movie" | "show", entry: Ids & Record<string, unknown>) => {
  const key = kind === "movie" ? "movies" : "shows";
  (body[key] ??= []).push(entry);
};
const isEmpty = (body: Body) => !body.movies?.length && !body.shows?.length;

export interface SyncBodies {
  history?: Body;
  ratings?: Body;
  ratingsRemove?: Body;
  watchlist?: Body;
  watchlistRemove?: Body;
}

/**
 * The request bodies for a batch. `mode` decides the date written into history: "now" when something was just marked
 * watched; "catchup" for older watches, where an episode gets "released" (Trakt uses its air date) and a movie the day
 * it was marked finished here, or "unknown".
 */
export function buildBodies(changes: TraktChange[], mode: "now" | "catchup", now: number): SyncBodies {
  const stamp = new Date(now).toISOString();
  const history: Body = {};
  const ratings: Body = {};
  const ratingsRemove: Body = {};
  const watchlist: Body = {};
  const watchlistRemove: Body = {};
  for (const c of changes) {
    const ids = idsOf(c.ids);
    if (c.movie) {
      const watched = mode === "now" ? stamp : c.doneAt ? new Date(c.doneAt).toISOString() : "unknown";
      put(history, "movie", { ids, watched_at: watched });
    }
    if (c.episodes?.length) {
      const seasons = c.episodes.map(([number, from, to]) => ({
        number,
        episodes: Array.from({ length: to - from + 1 }, (_, i) => ({ number: from + i, watched_at: mode === "now" ? stamp : "released" })),
      }));
      put(history, "show", { ids, seasons });
    }
    if (typeof c.rating === "number") put(ratings, c.kind, { ids, rating: c.rating, rated_at: stamp });
    else if (c.rating === null) put(ratingsRemove, c.kind, { ids });
    if (c.watchlist === "add") put(watchlist, c.kind, { ids });
    else if (c.watchlist === "remove") put(watchlistRemove, c.kind, { ids });
  }
  return {
    ...(isEmpty(history) ? {} : { history }),
    ...(isEmpty(ratings) ? {} : { ratings }),
    ...(isEmpty(ratingsRemove) ? {} : { ratingsRemove }),
    ...(isEmpty(watchlist) ? {} : { watchlist }),
    ...(isEmpty(watchlistRemove) ? {} : { watchlistRemove }),
  };
}

/**
 * The titles Trakt answered "not found" for, by TMDB id and kind. Trakt echoes back what it couldn't match under
 * `not_found.movies` and `not_found.shows`.
 */
export function notFoundIn(response: unknown): Set<string> {
  const out = new Set<string>();
  const nf = (response as { not_found?: Record<string, unknown> } | null)?.not_found;
  if (!nf || typeof nf !== "object") return out;
  for (const [key, kind] of [["movies", "movie"], ["shows", "show"]] as const) {
    const list = nf[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const tmdb = (entry as { ids?: { tmdb?: unknown } } | null)?.ids?.tmdb;
      if (typeof tmdb === "number") out.add(`${kind}:${tmdb}`);
    }
  }
  return out;
}

export const changeKey = (change: Pick<TraktChange, "kind" | "ids">): string => `${change.kind}:${change.ids.tmdb}`;

interface WatchedEntry {
  movie?: { ids?: { tmdb?: unknown; imdb?: unknown } };
  show?: { ids?: { tmdb?: unknown; imdb?: unknown } };
  seasons?: Array<{ number?: unknown; episodes?: Array<{ number?: unknown }> }>;
}

/**
 * What Trakt already has, before KeepShelf has sent anything: so the first sync doesn't add a second play of what is
 * already there (for example from an import). Built from GET /sync/watched/movies and /sync/watched/shows.
 *
 * Seasons are counted from episode 1 without gaps. When Trakt has at least as many episodes of a show as the shelf
 * wants, the show is taken as up to date: long anime are often numbered differently on TMDB and Trakt, and sending
 * "missing" episodes by the wrong numbers would add plays that don't belong.
 */
export function seedFromWatched(items: SavedItem[], watchedMovies: unknown, watchedShows: unknown, options: SyncOptions): Map<string, TraktSent> {
  const key = (ids: { tmdb?: unknown; imdb?: unknown } | undefined) => [
    typeof ids?.tmdb === "number" ? `tmdb:${ids.tmdb}` : undefined,
    typeof ids?.imdb === "string" ? `imdb:${ids.imdb}` : undefined,
  ].filter((k): k is string => !!k);

  const movies = new Set<string>();
  for (const entry of Array.isArray(watchedMovies) ? (watchedMovies as WatchedEntry[]) : []) for (const k of key(entry?.movie?.ids)) movies.add(k);

  const shows = new Map<string, number[]>();
  for (const entry of Array.isArray(watchedShows) ? (watchedShows as WatchedEntry[]) : []) {
    const seasons: number[] = [];
    for (const season of Array.isArray(entry?.seasons) ? entry.seasons : []) {
      if (typeof season?.number !== "number" || season.number < 1 || season.number > 999) continue;
      const numbers = new Set((season.episodes ?? []).map((e) => e?.number).filter((n): n is number => typeof n === "number"));
      let run = 0;
      while (numbers.has(run + 1)) run++;
      seasons[season.number - 1] = run;
    }
    for (let i = 0; i < seasons.length; i++) seasons[i] ??= 0;
    for (const k of key(entry?.show?.ids)) shows.set(k, seasons);
  }

  const out = new Map<string, TraktSent>();
  for (const item of items) {
    const ids = traktIds(item);
    if (!ids) continue;
    const keys = [`tmdb:${ids.tmdb}`, ...(ids.imdb ? [`imdb:${ids.imdb}`] : [])];
    const want = desiredState(item, options);
    const sent: TraktSent = { ...(item.trakt?.sent ?? {}) };
    if (item.tmdb?.kind === "movie") {
      if (keys.some((k) => movies.has(k))) sent.movie = true;
    } else if (want.seasons) {
      const have = keys.map((k) => shows.get(k)).find(Boolean);
      if (have) {
        const total = have.reduce((a, b) => a + b, 0);
        const wanted = want.seasons.reduce((a, b) => a + b, 0);
        const base = sent.seasons ?? [];
        sent.seasons = total >= wanted
          ? want.seasons.map((n, i) => Math.max(n, base[i] ?? 0))
          : want.seasons.map((n, i) => Math.max(Math.min(n, have[i] ?? 0), base[i] ?? 0));
      }
    }
    out.set(item.id, sent);
  }
  return out;
}

/** What Settings shows about the Trakt connection. */
export interface TraktStatus {
  clientId?: string;
  connected: boolean;
  username?: string;
  redirectUri: string;
  auto: boolean;
  watchlist: boolean;
  ready: boolean;
  running: boolean;
  /** What a running send is doing, such as "Part 1 of 2: history…". */
  progress?: string;
  lastRun?: number;
  lastMessage?: string;
  lastError?: string;
  pending: number;
  problems: Array<{ id: string; title: string; problem: string }>;
}
