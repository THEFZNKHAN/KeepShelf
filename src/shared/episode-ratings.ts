/**
 * Episode ratings for the grid on a series' card: seasons as columns, episodes as rows, each cell coloured by its
 * rating. Everything here is pure; the data comes from TMDB (see fetchEpisodeRatings in tmdb.ts).
 */

export interface EpisodeRating {
  episode: number;
  name: string;
  /** Out of 10, one decimal. Missing when nobody has rated the episode yet. */
  rating?: number;
  votes?: number;
  /** YYYY-MM-DD. */
  airDate?: string;
}

export interface SeasonRatings {
  season: number;
  episodes: EpisodeRating[];
}

export interface EpisodeRatings {
  fetchedAt: number;
  seasons: SeasonRatings[];
}

export const MAX_SEASONS = 60;
export const MAX_EPISODES = 300;
/** How long fetched ratings are reused before asking TMDB again. */
export const RATINGS_TTL_MS = 24 * 60 * 60 * 1000;

export type RatingBand = "absolute" | "awesome" | "great" | "good" | "average" | "bad" | "garbage" | "none";

/** Legend order, best first. The labels are the ones seriesgraph uses. */
export const RATING_BANDS: ReadonlyArray<{ band: Exclude<RatingBand, "none">; label: string; min: number }> = [
  { band: "absolute", label: "Absolute cinema", min: 9.7 },
  { band: "awesome", label: "Awesome", min: 9 },
  { band: "great", label: "Great", min: 8 },
  { band: "good", label: "Good", min: 7 },
  { band: "average", label: "Average", min: 6 },
  { band: "bad", label: "Bad", min: 4 },
  { band: "garbage", label: "Garbage", min: 0 },
];

export function ratingBand(rating: number | undefined): RatingBand {
  if (typeof rating !== "number" || !Number.isFinite(rating) || rating <= 0) return "none";
  return RATING_BANDS.find((b) => rating >= b.min)?.band ?? "garbage";
}

/** One decimal, rounding halves up; the tiny nudge undoes float error such as 17.299999999999997 / 2. */
const round1 = (n: number) => Math.round(n * 10 + 1e-9) / 10;

const isoDay = (value: unknown): string | undefined =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;

const cleanName = (value: unknown): string =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) : "";

interface RawEpisode {
  episode_number?: unknown;
  name?: unknown;
  vote_average?: unknown;
  vote_count?: unknown;
  air_date?: unknown;
}

/** Turns one TMDB season (as returned inside append_to_response) into a checked SeasonRatings, or undefined if it is junk. */
export function sanitizeSeason(raw: unknown, season?: number): SeasonRatings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as { season_number?: unknown; episodes?: unknown };
  const number = typeof data.season_number === "number" ? data.season_number : season;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1 || number > 999) return undefined;
  if (!Array.isArray(data.episodes)) return undefined;

  const seen = new Set<number>();
  const episodes: EpisodeRating[] = [];
  for (const entry of data.episodes.slice(0, MAX_EPISODES) as RawEpisode[]) {
    if (!entry || typeof entry !== "object") continue;
    const episode = entry.episode_number;
    if (typeof episode !== "number" || !Number.isInteger(episode) || episode < 1 || episode > MAX_EPISODES || seen.has(episode)) continue;
    seen.add(episode);
    const votes = typeof entry.vote_count === "number" && entry.vote_count > 0 ? Math.floor(entry.vote_count) : undefined;
    const average = typeof entry.vote_average === "number" && Number.isFinite(entry.vote_average) ? entry.vote_average : 0;
    // TMDB reports 0 for "no votes", which is not a rating.
    const rating = votes !== undefined && average > 0 ? round1(Math.min(average, 10)) : undefined;
    const item: EpisodeRating = { episode, name: cleanName(entry.name) };
    if (rating !== undefined) item.rating = rating;
    if (votes !== undefined) item.votes = votes;
    const airDate = isoDay(entry.air_date);
    if (airDate) item.airDate = airDate;
    episodes.push(item);
  }
  episodes.sort((a, b) => a.episode - b.episode);
  return { season: number, episodes };
}

/**
 * Checks ratings read back from the cache. They are in this module's own shape (season, episodes with episode, name,
 * rating, votes, airDate), not TMDB's, so they need their own check; running them through sanitizeSeason would throw
 * every episode away. An entry that comes back with no seasons is treated as damaged, so it is fetched again.
 */
export function sanitizeRatings(raw: unknown): EpisodeRatings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as { fetchedAt?: unknown; seasons?: unknown };
  if (typeof data.fetchedAt !== "number" || !Number.isFinite(data.fetchedAt) || !Array.isArray(data.seasons)) return undefined;

  const bySeason = new Map<number, SeasonRatings>();
  for (const entry of data.seasons.slice(0, MAX_SEASONS)) {
    const season = sanitizeStoredSeason(entry);
    if (season && !bySeason.has(season.season)) bySeason.set(season.season, season);
  }
  const seasons = [...bySeason.values()].sort((a, b) => a.season - b.season);
  return seasons.length ? { fetchedAt: data.fetchedAt, seasons } : undefined;
}

function sanitizeStoredSeason(raw: unknown): SeasonRatings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as { season?: unknown; episodes?: unknown };
  if (typeof data.season !== "number" || !Number.isInteger(data.season) || data.season < 1 || data.season > 999) return undefined;
  if (!Array.isArray(data.episodes)) return undefined;
  const seen = new Set<number>();
  const episodes: EpisodeRating[] = [];
  for (const entry of data.episodes.slice(0, MAX_EPISODES)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { episode?: unknown; name?: unknown; rating?: unknown; votes?: unknown; airDate?: unknown };
    if (typeof e.episode !== "number" || !Number.isInteger(e.episode) || e.episode < 1 || e.episode > MAX_EPISODES || seen.has(e.episode)) continue;
    seen.add(e.episode);
    const item: EpisodeRating = { episode: e.episode, name: cleanName(e.name) };
    if (typeof e.rating === "number" && Number.isFinite(e.rating) && e.rating > 0 && e.rating <= 10) item.rating = round1(e.rating);
    if (typeof e.votes === "number" && Number.isFinite(e.votes) && e.votes > 0) item.votes = Math.floor(e.votes);
    const airDate = isoDay(e.airDate);
    if (airDate) item.airDate = airDate;
    episodes.push(item);
  }
  episodes.sort((x, y) => x.episode - y.episode);
  return { season: data.season, episodes };
}

/** Sanitises every season, drops junk and duplicates, and orders them. */
export function collectSeasons(rawSeasons: unknown[]): SeasonRatings[] {
  const bySeason = new Map<number, SeasonRatings>();
  for (const raw of rawSeasons) {
    const season = sanitizeSeason(raw);
    if (season && !bySeason.has(season.season)) bySeason.set(season.season, season);
  }
  return [...bySeason.values()].sort((a, b) => a.season - b.season);
}

export const isFresh = (entry: { fetchedAt: number } | undefined, now: number, ttl = RATINGS_TTL_MS): boolean =>
  !!entry && now >= entry.fetchedAt && now - entry.fetchedAt < ttl;

export interface GridCell {
  season: number;
  episode: number;
  name: string;
  rating?: number;
  votes?: number;
  airDate?: string;
  band: RatingBand;
}

export interface EpisodeGrid {
  /** Season numbers, one per column. */
  seasons: number[];
  /** Rows of episode numbers 1..rows. */
  rows: number;
  /** cells[row][column]; undefined where a season has no such episode. */
  cells: Array<Array<GridCell | undefined>>;
  /** Average of the rated episodes per column; undefined when none is rated. */
  seasonAverages: Array<number | undefined>;
  average?: number;
  best?: GridCell;
  lowest?: GridCell;
  rated: number;
  total: number;
}

export function buildGrid(ratings: EpisodeRatings): EpisodeGrid {
  const seasons = ratings.seasons.map((s) => s.season);
  const rows = Math.max(0, ...ratings.seasons.flatMap((s) => s.episodes.map((e) => e.episode)));
  const cells: Array<Array<GridCell | undefined>> = Array.from({ length: rows }, () => new Array(seasons.length).fill(undefined));
  const seasonAverages: Array<number | undefined> = [];
  let sum = 0;
  let rated = 0;
  let total = 0;
  let best: GridCell | undefined;
  let lowest: GridCell | undefined;

  ratings.seasons.forEach((season, column) => {
    let seasonSum = 0;
    let seasonRated = 0;
    for (const e of season.episodes) {
      const cell: GridCell = { season: season.season, ...e, band: ratingBand(e.rating) };
      cells[e.episode - 1][column] = cell;
      total += 1;
      if (e.rating !== undefined) {
        seasonSum += e.rating;
        seasonRated += 1;
        sum += e.rating;
        rated += 1;
        if (!best || e.rating > (best.rating as number)) best = cell;
        if (!lowest || e.rating < (lowest.rating as number)) lowest = cell;
      }
    }
    seasonAverages.push(seasonRated ? round1(seasonSum / seasonRated) : undefined);
  });

  return { seasons, rows, cells, seasonAverages, average: rated ? round1(sum / rated) : undefined, best, lowest, rated, total };
}

export const hasAnyRating = (grid: EpisodeGrid): boolean => grid.rated > 0;

export const formatRating = (rating: number | undefined): string => (rating === undefined ? "–" : rating.toFixed(1));

/** "S2 E5" */
export const episodeCode = (cell: { season: number; episode: number }): string => `S${cell.season} E${cell.episode}`;

/** "9 Dec 2017" from YYYY-MM-DD, without going through Date so the day never shifts with the time zone. */
export function longDate(iso: string | undefined): string {
  const m = iso && /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? ""} ${m[1]}`.replace("  ", " ");
}

/** One line describing a cell: "S2 E5 · Title · 8.6 (1,203 votes) · 12 Mar 2017". */
export function describeCell(cell: GridCell): string {
  const parts = [episodeCode(cell)];
  if (cell.name) parts.push(cell.name);
  parts.push(cell.rating === undefined ? "not rated yet" : `${formatRating(cell.rating)}${cell.votes ? ` (${cell.votes.toLocaleString("en-US")} votes)` : ""}`);
  const date = longDate(cell.airDate);
  if (date) parts.push(date);
  return parts.join(" · ");
}
