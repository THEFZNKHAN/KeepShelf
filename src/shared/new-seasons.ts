import { shortDate } from "./coming-up.js";
import { daysUntil } from "./reminders.js";
import { seasonsFinished } from "./seasons.js";
import type { SavedItem } from "./types.js";
import { statusOf } from "./user-data.js";

/**
 * Series you marked finished that have a season you haven't watched: one that is already out, one that is airing,
 * one with a premiere date, or one TMDB has announced without a date. Everything is worked out from what is saved, so
 * the list is as fresh as the last TMDB check.
 */
export interface NewSeasonEntry {
  item: SavedItem;
  /** Seasons you had when you finished the show. */
  watched: number;
  /** Seasons that are out beyond those, first to last. A season that is airing counts. Empty if there are none. */
  out: number[];
  /** `airing`: the last of them is still being released. */
  airing: boolean;
  /** A season that has not started, with its premiere date. */
  premiere?: { season: number; date: string };
  /** Seasons TMDB lists beyond all of the above, which have no date yet. */
  announced: number[];
  /** "S3 out now", "S2–S3 out now", "S4 airing now", "S3 on 12 Dec", "S3 announced". */
  label: string;
  /** Smaller is more worth watching now: seasons you can watch first, then the nearest premiere, then announcements. */
  rank: number;
}

const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

const seasonsText = (seasons: number[]): string =>
  seasons.length === 1 ? `S${seasons[0]}` : `S${seasons[0]}–S${seasons[seasons.length - 1]}`;

/**
 * The seasons you haven't watched of a finished series, or undefined when there are none. Needs the number of seasons
 * it had when finished (`seasonsAtFinish`), because TMDB's own count only grows. Without it nothing is claimed.
 */
export function newSeasonOf(item: SavedItem, now: number): NewSeasonEntry | undefined {
  const tmdb = item.tmdb;
  if (statusOf(item) !== "done" || !tmdb || tmdb.kind !== "tv" || item.seasonsAtFinish === undefined) return undefined;
  const watched = item.seasonsAtFinish;
  const next = tmdb.nextEpisode;
  let aired = seasonsFinished(tmdb);
  if (aired === undefined) return undefined;

  let premiere: NewSeasonEntry["premiere"];
  if (next && next.episode === 1 && next.season > watched) {
    const days = daysUntil(next.airDate, now);
    if (days === undefined || days >= 0) premiere = { season: next.season, date: next.airDate };
    // A premiere that has already passed is a season that is out; TMDB just hasn't moved its "next" yet.
    else aired = Math.max(aired, next.season);
  }

  const out = range(watched + 1, aired);
  const airing = out.length > 0 && !!next && next.episode > 1 && next.season === aired;

  const known = Math.max(aired, premiere?.season ?? 0, watched);
  const announced = range(known + 1, typeof tmdb.seasons === "number" ? tmdb.seasons : 0);
  if (out.length === 0 && !premiere && announced.length === 0) return undefined;

  let label: string;
  let rank: number;
  if (out.length > 0) {
    label = `${seasonsText(out)} ${airing ? "airing now" : "out now"}`;
    rank = 0;
  } else if (premiere) {
    label = `S${premiere.season} on ${shortDate(premiere.date)}`;
    rank = 1;
  } else {
    label = `${seasonsText(announced)} announced`;
    rank = 2;
  }
  return { item, watched, out, airing, ...(premiere ? { premiere } : {}), announced, label, rank };
}

/** Finished series with a season you haven't watched: out now first, then the nearest premiere, then announcements. */
export function newSeasonEntries(items: SavedItem[], now: number): NewSeasonEntry[] {
  const entries: NewSeasonEntry[] = [];
  for (const item of items) {
    const entry = newSeasonOf(item, now);
    if (entry) entries.push(entry);
  }
  const date = (e: NewSeasonEntry) => e.premiere?.date ?? "9999-99-99";
  return entries.sort((a, b) => a.rank - b.rank || date(a).localeCompare(date(b)) || a.item.title.localeCompare(b.item.title));
}
