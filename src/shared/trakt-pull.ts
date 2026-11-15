/**
 * Getting your Trakt library into KeepShelf: watched movies, episode progress, ratings and the watchlist. Pure: the
 * background worker reads Trakt and applies the plan.
 *
 * Rules (chosen by the user): the side with more watched wins, so progress only ever moves forward; a title watched on
 * Trakt becomes Done here; a rating you set here is kept, and Trakt's fills in where you have none; titles that aren't on
 * the shelf are added, the watchlist as To watch. Everything that came from Trakt is recorded as already sent, so it is
 * never sent back as a second play.
 */
import { normalizeTitle } from "./fuzzy.js";
import { distributeProgress, nextToWatch, seasonTotals, seasonsFinished, sumProgress, watchedProgress } from "./seasons.js";
import type { TraktSent } from "./trakt-sync.js";
import type { ItemStatus, MediaType, SavedItem, TmdbInfo } from "./types.js";
import { normalizeTags, statusOf } from "./user-data.js";

export interface PulledTitle {
  kind: "movie" | "show";
  title: string;
  year?: number;
  tmdb?: number;
  imdb?: string;
  /** Trakt files it as anime (its "anime" genre, or Japanese animation). */
  anime: boolean;
  /** Movie: in your history. */
  watched?: boolean;
  /** When it was last watched, ISO. */
  watchedAt?: string;
  /** Show: episodes watched per season, by Trakt's season numbers (index 0 is season 1). */
  seasons?: number[];
  /** Show: episodes watched in all. */
  episodes?: number;
  /** Show: episodes that have aired, as Trakt counts them. */
  aired?: number;
  rating?: number;
  watchlist?: boolean;
  /** Tags from the Trakt lists it is on, such as "trakt: favourites". */
  tags?: string[];
}

type Ids = { tmdb?: unknown; imdb?: unknown };
interface Media {
  title?: unknown;
  year?: unknown;
  ids?: Ids;
  genres?: unknown;
  language?: unknown;
  aired_episodes?: unknown;
}
interface Entry {
  movie?: Media;
  show?: Media;
  last_watched_at?: unknown;
  rating?: unknown;
  seasons?: Array<{ number?: unknown; episodes?: Array<{ number?: unknown }> }>;
}

const list = (raw: unknown): Entry[] => (Array.isArray(raw) ? (raw as Entry[]) : []);
const cleanText = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 200) : undefined;
};

function baseOf(kind: "movie" | "show", media: Media | undefined): PulledTitle | undefined {
  const title = cleanText(media?.title);
  if (!media || !title) return undefined;
  const tmdb = typeof media.ids?.tmdb === "number" && Number.isInteger(media.ids.tmdb) && media.ids.tmdb > 0 ? media.ids.tmdb : undefined;
  const imdb = typeof media.ids?.imdb === "string" && /^tt\d{5,10}$/.test(media.ids.imdb) ? media.ids.imdb : undefined;
  const year = typeof media.year === "number" && media.year > 1800 && media.year < 2200 ? media.year : undefined;
  const genres = Array.isArray(media.genres) ? media.genres.filter((g): g is string => typeof g === "string").map((g) => g.toLowerCase()) : [];
  const anime = genres.includes("anime") || (media.language === "ja" && genres.includes("animation"));
  return { kind, title, ...(year ? { year } : {}), ...(tmdb ? { tmdb } : {}), ...(imdb ? { imdb } : {}), anime };
}

const keyOf = (t: Pick<PulledTitle, "kind" | "tmdb" | "imdb" | "title" | "year">): string =>
  t.tmdb ? `${t.kind}:tmdb:${t.tmdb}` : t.imdb ? `${t.kind}:imdb:${t.imdb}` : `${t.kind}:title:${normalizeTitle(t.title)}|${t.year ?? ""}`;

/**
 * Merges Trakt's lists into one entry per title: GET /sync/watched/movies and /shows, /sync/ratings/movies and /shows,
 * and /sync/watchlist/movies and /shows. Watched shows are read twice: plain for the episodes watched (Trakt leaves
 * the seasons out with ?extended=full) and with ?extended=full for genres and aired episodes.
 */
export function parseTraktLibrary(raw: {
  watchedMovies?: unknown;
  watchedShows?: unknown;
  /** The same list with ?extended=full: genres and aired episodes, but (on Trakt) without the seasons. */
  watchedShowsInfo?: unknown;
  ratedMovies?: unknown;
  ratedShows?: unknown;
  watchlistMovies?: unknown;
  watchlistShows?: unknown;
  /** Your personal lists: GET /users/me/lists, and each list's GET …/items. */
  lists?: Array<{ name: string; items: unknown }>;
}): PulledTitle[] {
  const byKey = new Map<string, PulledTitle>();
  const take = (kind: "movie" | "show", media: Media | undefined): PulledTitle | undefined => {
    const base = baseOf(kind, media);
    if (!base) return undefined;
    const key = keyOf(base);
    const existing = byKey.get(key);
    if (existing) {
      if (base.anime) existing.anime = true;
      return existing;
    }
    byKey.set(key, base);
    return base;
  };
  for (const e of list(raw.watchedMovies)) {
    const t = take("movie", e.movie);
    if (!t) continue;
    t.watched = true;
    if (typeof e.last_watched_at === "string") t.watchedAt = e.last_watched_at;
  }
  for (const e of list(raw.watchedShows)) {
    const t = take("show", e.show);
    if (!t) continue;
    const seasons: number[] = [];
    for (const s of Array.isArray(e.seasons) ? e.seasons : []) {
      if (typeof s?.number !== "number" || s.number < 1 || s.number > 999) continue;
      seasons[s.number - 1] = new Set((s.episodes ?? []).map((ep) => ep?.number).filter((n) => typeof n === "number")).size;
    }
    for (let i = 0; i < seasons.length; i++) seasons[i] ??= 0;
    t.seasons = seasons;
    t.episodes = seasons.reduce((a, b) => a + b, 0);
    const aired = e.show?.aired_episodes;
    if (typeof aired === "number" && aired > 0) t.aired = aired;
    if (typeof e.last_watched_at === "string") t.watchedAt = e.last_watched_at;
  }
  for (const e of list(raw.watchedShowsInfo)) {
    const base = baseOf("show", e.show);
    const t = base ? byKey.get(keyOf(base)) : undefined;
    if (!t) continue; // only adds details to shows with episodes watched
    if (base?.anime) t.anime = true;
    const aired = e.show?.aired_episodes;
    if (typeof aired === "number" && aired > 0) t.aired = aired;
  }
  for (const [source, kind] of [[raw.ratedMovies, "movie"], [raw.ratedShows, "show"]] as const) {
    for (const e of list(source)) {
      const t = take(kind, kind === "movie" ? e.movie : e.show);
      if (t && typeof e.rating === "number" && Number.isInteger(e.rating) && e.rating >= 1 && e.rating <= 10) t.rating = e.rating;
    }
  }
  for (const [source, kind] of [[raw.watchlistMovies, "movie"], [raw.watchlistShows, "show"]] as const) {
    for (const e of list(source)) {
      const t = take(kind, kind === "movie" ? e.movie : e.show);
      if (t) t.watchlist = true;
    }
  }
  for (const traktList of raw.lists ?? []) {
    const tag = listTag(traktList.name);
    if (!tag) continue;
    for (const e of list(traktList.items) as Array<Entry & { type?: unknown }>) {
      // A season or episode on a list stands for its show.
      const kind = e.type === "movie" ? "movie" : e.show ? "show" : undefined;
      const t = kind ? take(kind, kind === "movie" ? e.movie : e.show) : undefined;
      if (t && !(t.tags ?? []).includes(tag)) t.tags = [...(t.tags ?? []), tag];
    }
  }
  return [...byKey.values()];
}

/** The tag for a Trakt list: "trakt: " and the list's name, cut to fit a tag. Undefined for a name with nothing in it. */
export function listTag(name: unknown): string | undefined {
  if (typeof name !== "string" || !name.trim()) return undefined;
  return normalizeTags([`trakt: ${name}`])[0];
}

/** The shelf item a Trakt title is: same TMDB id, else same IMDb id, else the same name and year. */
export function findItemFor(title: PulledTitle, items: SavedItem[]): SavedItem | undefined {
  const tmdbKind = title.kind === "movie" ? "movie" : "tv";
  const media = (i: SavedItem) => (title.kind === "movie" ? i.type === "movie" || i.type === "anime" : i.type === "series" || i.type === "anime");
  if (title.tmdb) {
    const hit = items.find((i) => i.tmdb?.kind === tmdbKind && i.tmdb.id === title.tmdb);
    if (hit) return hit;
  }
  if (title.imdb) {
    const hit = items.find((i) => media(i) && (i.tmdb?.imdbId === title.imdb || i.sourceUrl.includes(`/title/${title.imdb}`)));
    if (hit) return hit;
  }
  const name = normalizeTitle(title.title);
  return items.find(
    (i) => media(i) && (!i.tmdb || i.tmdb.kind === tmdbKind) && normalizeTitle(i.title) === name && (!title.year || !i.year || i.year === String(title.year))
  );
}

/**
 * Trakt's episodes per season placed on TMDB's seasons (the shelf's numbering). Season by season when Trakt's seasons
 * fit TMDB's; otherwise (long anime are often split differently) as a count from the first episode.
 */
export function mapSeasons(trakt: number[], total: number, totals: number[]): number[] {
  const fits = trakt.length <= totals.length && trakt.every((n, i) => n <= totals[i]);
  if (fits) return totals.map((_, i) => trakt[i] ?? 0);
  return distributeProgress(Math.min(total, sumProgress(totals)), totals);
}

const max = (a: number[] = [], b: number[] = []) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => Math.max(a[i] ?? 0, b[i] ?? 0));

export interface PullUpdate {
  id: string;
  title: string;
  patch: Partial<SavedItem>;
  parts: string[];
}

export interface PullAddition {
  title: string;
  year?: string;
  type: MediaType;
  kind: "movie" | "tv";
  tmdb?: number;
  imdb?: string;
  status: ItemStatus;
  doneAt?: number;
  myRating?: number;
  tags?: string[];
  /** Shows: Trakt's episodes per season and in all, placed on TMDB's seasons once TMDB info is fetched. */
  traktSeasons?: number[];
  episodes?: number;
  sent: TraktSent;
  parts: string[];
}

export interface PullPlan {
  updates: PullUpdate[];
  additions: PullAddition[];
  /** Trakt titles already matching the shelf. */
  unchanged: number;
}

const whenMs = (iso: string | undefined, fallback: number): number => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : fallback;
};

const episodesWord = (n: number) => `${n} episode${n === 1 ? "" : "s"}`;

/** What would change on the shelf. Nothing is written here. */
export function planPull(items: SavedItem[], pulled: PulledTitle[], now: number): PullPlan {
  const updates: PullUpdate[] = [];
  const additions: PullAddition[] = [];
  let unchanged = 0;

  for (const t of pulled) {
    const item = findItemFor(t, items);
    if (!item) {
      const addition = additionFor(t, now);
      if (addition) additions.push(addition);
      continue;
    }
    const patch: Partial<SavedItem> = {};
    const parts: string[] = [];
    const status = statusOf(item);
    const sentBefore: TraktSent = item.trakt?.sent ?? {};
    const sent: TraktSent = { ...sentBefore };

    if (t.kind === "movie" && t.watched) {
      sent.movie = true;
      if (status !== "done") {
        Object.assign(patch, { status: "done", done: true, doneAt: whenMs(t.watchedAt, now) });
        parts.push("marked watched");
      }
    }

    if (t.kind === "show" && (t.episodes ?? 0) > 0) {
      const totals = seasonTotals(item);
      if (totals?.length) {
        const current = watchedProgress(item, totals);
        const fromTrakt = mapSeasons(t.seasons ?? [], t.episodes ?? 0, totals);
        const merged = max(current, fromTrakt).slice(0, totals.length);
        sent.seasons = max(sentBefore.seasons, fromTrakt);
        const gained = sumProgress(merged) - sumProgress(current);
        if (gained > 0) {
          patch.seasonProgress = merged;
          patch.progressCurrent = sumProgress(merged);
          const next = nextToWatch(merged, totals);
          parts.push(`${episodesWord(gained)} more watched${next ? ` (next: S${next.season} E${next.episode})` : ""}`);
          if (!next && status !== "done") {
            Object.assign(patch, { status: "done", done: true, doneAt: whenMs(t.watchedAt, now) });
            const finished = seasonsFinished(item.tmdb);
            if (finished !== undefined) patch.seasonsAtFinish = finished;
            parts.push("finished");
          } else if (next && (status === "plan" || status === "done")) {
            // Started on Trakt, or a newer season begun there after you finished it here.
            Object.assign(patch, { status: "in_progress", done: false, doneAt: undefined });
            parts.push("now in progress");
          }
        }
      } else if (status !== "done" && (t.episodes ?? 0) > (item.progressCurrent ?? 0)) {
        patch.progressCurrent = t.episodes;
        parts.push(`${episodesWord((t.episodes ?? 0) - (item.progressCurrent ?? 0))} more watched`);
        if (t.aired && (t.episodes ?? 0) >= t.aired) {
          Object.assign(patch, { status: "done", done: true, doneAt: whenMs(t.watchedAt, now) });
          parts.push("finished");
        } else if (status === "plan") {
          patch.status = "in_progress";
          parts.push("now in progress");
        }
      }
    }

    if (t.rating !== undefined) {
      if (item.myRating === undefined) {
        patch.myRating = t.rating;
        parts.push(`rating ${t.rating} from Trakt`);
      }
      // Trakt has a rating; yours (if any) stays here and isn't sent over it.
      sent.rating = item.myRating ?? t.rating;
    }
    if (t.watchlist) sent.watchlist = true;

    const missingTags = (t.tags ?? []).filter((tag) => !(item.tags ?? []).includes(tag));
    if (missingTags.length) {
      patch.tags = normalizeTags([...(item.tags ?? []), ...missingTags]);
      parts.push(`tagged ${missingTags.join(", ")}`);
    }

    const sentChanged = JSON.stringify(sent) !== JSON.stringify(sentBefore);
    if (sentChanged) patch.trakt = { ...(item.trakt ?? {}), sent };
    if (parts.length) updates.push({ id: item.id, title: item.title, patch, parts });
    else if (sentChanged) updates.push({ id: item.id, title: item.title, patch, parts: [] });
    else unchanged++;
  }

  additions.sort((a, b) => a.title.localeCompare(b.title));
  updates.sort((a, b) => a.title.localeCompare(b.title));
  return { updates, additions, unchanged };
}

function additionFor(t: PulledTitle, now: number): PullAddition | undefined {
  const base = {
    title: t.title,
    ...(t.year ? { year: String(t.year) } : {}),
    kind: t.kind === "movie" ? ("movie" as const) : ("tv" as const),
    type: (t.anime ? "anime" : t.kind === "movie" ? "movie" : "series") as MediaType,
    ...(t.tmdb ? { tmdb: t.tmdb } : {}),
    ...(t.imdb ? { imdb: t.imdb } : {}),
    ...(t.rating ? { myRating: t.rating } : {}),
    ...(t.tags?.length ? { tags: t.tags } : {}),
  };
  const sent: TraktSent = { ...(t.rating ? { rating: t.rating } : {}), ...(t.watchlist ? { watchlist: true } : {}) };
  const rated = [...(t.rating ? [`rating ${t.rating}`] : []), ...(t.tags?.length ? [`tagged ${t.tags.join(", ")}`] : [])];
  if (t.kind === "movie") {
    if (t.watched) return { ...base, status: "done", doneAt: whenMs(t.watchedAt, now), sent: { ...sent, movie: true }, parts: ["watched", ...rated] };
    if (t.watchlist) return { ...base, status: "plan", sent, parts: ["to watch", ...rated] };
    if (t.rating) return { ...base, status: "done", doneAt: now, sent, parts: rated };
    if (t.tags?.length) return { ...base, status: "plan", sent, parts: ["to watch", ...rated] };
    return undefined;
  }
  const episodes = t.episodes ?? 0;
  if (episodes > 0) {
    const finished = !!t.aired && episodes >= t.aired;
    return {
      ...base,
      status: finished ? "done" : "in_progress",
      ...(finished ? { doneAt: whenMs(t.watchedAt, now) } : {}),
      traktSeasons: t.seasons ?? [],
      episodes,
      sent,
      parts: [`${episodesWord(episodes)} watched${finished ? ", finished" : ""}`, ...rated],
    };
  }
  if (t.watchlist) return { ...base, status: "plan", sent, parts: ["to watch", ...rated] };
  if (t.rating) return { ...base, status: "done", doneAt: now, sent, parts: rated };
  if (t.tags?.length) return { ...base, status: "plan", sent, parts: ["to watch", ...rated] };
  return undefined;
}

/**
 * The item to save for an addition, once its TMDB info is known (or not). A show's episodes are placed on TMDB's seasons,
 * and recorded as sent, since they came from Trakt.
 */
export function itemForAddition(a: PullAddition, info: TmdbInfo | undefined): Omit<SavedItem, "id" | "savedAt"> {
  const sent: TraktSent = { ...a.sent };
  const user: Partial<SavedItem> = {
    status: a.status,
    done: a.status === "done",
    ...(a.doneAt ? { doneAt: a.doneAt } : {}),
    ...(a.myRating ? { myRating: a.myRating } : {}),
    ...(a.tags?.length ? { tags: a.tags } : {}),
  };
  const totals = info?.kind === "tv" ? info.seasonEpisodes : undefined;
  if (a.kind === "tv" && (a.episodes ?? 0) > 0) {
    if (totals?.length) {
      const progress = mapSeasons(a.traktSeasons ?? [], a.episodes ?? 0, totals);
      user.seasonProgress = progress;
      user.progressCurrent = sumProgress(progress);
      sent.seasons = progress;
      if (a.status === "done") {
        const finished = seasonsFinished(info);
        if (finished !== undefined) user.seasonsAtFinish = finished;
      }
    } else {
      user.progressCurrent = a.episodes;
    }
  }
  return {
    type: a.type,
    title: a.title,
    ...(a.year ? { year: a.year } : {}),
    subtitle: a.year ?? "",
    googleQuery: [a.title, a.year].filter(Boolean).join(" "),
    sourceUrl: a.tmdb ? `https://www.themoviedb.org/${a.kind}/${a.tmdb}` : a.imdb ? `https://www.imdb.com/title/${a.imdb}/` : "",
    ...(info ? { tmdb: info } : {}),
    ...user,
    trakt: { sent },
  };
}

export interface PullPreview {
  updates: Array<{ title: string; parts: string[] }>;
  additions: Array<{ title: string; parts: string[] }>;
  unchanged: number;
}

/** The plan in words, for checking before anything changes on the shelf. Updates that only record what Trakt has are left out. */
export function describePull(plan: PullPlan): PullPreview {
  return {
    updates: plan.updates.filter((u) => u.parts.length).map((u) => ({ title: u.title, parts: u.parts })),
    additions: plan.additions.map((a) => ({ title: a.year ? `${a.title} (${a.year})` : a.title, parts: [a.type === "anime" ? "anime" : a.kind === "movie" ? "movie" : "series", ...a.parts] })),
    unchanged: plan.unchanged + plan.updates.filter((u) => !u.parts.length).length,
  };
}

/** How often to get changes from Trakt by itself. */
export const PULL_INTERVALS = ["off", "1h", "6h", "24h"] as const;
export type PullInterval = (typeof PULL_INTERVALS)[number];
export const PULL_MINUTES: Record<Exclude<PullInterval, "off">, number> = { "1h": 60, "6h": 360, "24h": 1440 };

export function sanitizePullInterval(value: unknown): PullInterval {
  return (PULL_INTERVALS as readonly unknown[]).includes(value) ? (value as PullInterval) : "off";
}

/**
 * A fingerprint of what matters in GET /sync/last_activities: when movies and episodes were last watched, rated or put
 * on the watchlist. When it hasn't changed since the last check, there is nothing new on Trakt to get.
 */
export function activityFingerprint(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, Record<string, unknown> | undefined>;
  const pick = (group: string, field: string) => {
    const value = r[group]?.[field];
    return typeof value === "string" ? value : "";
  };
  const parts = [
    pick("movies", "watched_at"),
    pick("movies", "rated_at"),
    pick("movies", "watchlisted_at"),
    pick("episodes", "watched_at"),
    pick("shows", "rated_at"),
    pick("shows", "watchlisted_at"),
    pick("seasons", "watchlisted_at"),
    pick("lists", "updated_at"),
  ];
  return parts.some(Boolean) ? parts.join("|") : undefined;
}

/**
 * Whether a show from the watched list needs its progress read on an automatic check: anything not on the shelf, and
 * anything watched since the last check (with an hour's slack for clocks). Everything else is unchanged on Trakt.
 */
export function showChangedSince(entry: unknown, since: number | undefined, onShelf: (tmdb: number) => boolean): boolean {
  if (since === undefined) return true;
  const e = entry as { last_watched_at?: unknown; show?: { ids?: { tmdb?: unknown } } } | null;
  const tmdb = e?.show?.ids?.tmdb;
  if (typeof tmdb !== "number" || !onShelf(tmdb)) return true;
  const watched = typeof e?.last_watched_at === "string" ? Date.parse(e.last_watched_at) : NaN;
  return !Number.isFinite(watched) || watched > since - 60 * 60 * 1000;
}
