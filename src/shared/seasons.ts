import type { ItemStatus, SavedItem, TmdbInfo } from "./types.js";

/** Episodes per season from TMDB (specials excluded). Index 0 is season 1. Undefined when unknown. */
export function seasonTotals(item: Pick<SavedItem, "tmdb">): number[] | undefined {
  const totals = item.tmdb?.seasonEpisodes;
  return totals && totals.length > 0 ? totals : undefined;
}

export function sumProgress(progress: number[] | undefined): number {
  return (progress ?? []).reduce((sum, n) => sum + n, 0);
}

/** Spreads an overall episode count over the seasons in order, for items tracked before seasons existed. */
export function distributeProgress(current: number, totals: number[]): number[] {
  let left = Math.max(0, current);
  return totals.map((total) => {
    const take = Math.min(left, total);
    left -= take;
    return take;
  });
}

/** Sets one season (1-based) to fully watched. Seasons that have no entry yet count as 0. */
export function markSeasonDone(progress: number[], totals: number[], season: number): number[] {
  const next = totals.map((_, i) => progress[i] ?? 0);
  if (season >= 1 && season <= totals.length) next[season - 1] = totals[season - 1];
  return next;
}

/** The first episode not yet watched, such as { season: 2, episode: 6 }. Undefined when everything is watched. */
export function nextToWatch(progress: number[], totals: number[]): { season: number; episode: number } | undefined {
  for (let i = 0; i < totals.length; i++) {
    const seen = progress[i] ?? 0;
    if (seen < totals[i]) return { season: i + 1, episode: seen + 1 };
  }
  return undefined;
}

/** "S2 E5": the latest episode watched. Undefined when nothing has been watched. */
export function lastWatched(progress: number[] | undefined): string | undefined {
  if (!progress) return undefined;
  for (let i = progress.length - 1; i >= 0; i--) {
    if (progress[i] > 0) return `S${i + 1} E${progress[i]}`;
  }
  return undefined;
}

/** The status that matches the episodes watched: all of them is done, some is in progress, none leaves it be. */
export function statusFromSeasons(progress: number[], totals: number[] | undefined, current: ItemStatus): ItemStatus {
  const sum = sumProgress(progress);
  if (totals && totals.length > 0 && nextToWatch(progress, totals) === undefined) return "done";
  if (sum > 0 && (current === "plan" || current === "done")) return "in_progress";
  return current;
}

/** Checks per-season counts: whole numbers, and none above that season's episode count when it is known. */
export function validateSeasonProgress(input: unknown, totals: number[] | undefined): number[] {
  if (!Array.isArray(input)) throw new Error("Season progress must be a list of numbers.");
  if (input.length > 100) throw new Error("Too many seasons.");
  return input.map((raw, i) => {
    const value = raw === null || raw === undefined || raw === "" ? 0 : Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 100000) throw new Error(`Season ${i + 1} must be a whole number.`);
    const total = totals?.[i];
    if (total !== undefined && value > total) {
      throw new Error(`Season ${i + 1} has ${total} episode${total === 1 ? "" : "s"}, so ${value} is too many.`);
    }
    return value;
  });
}

/** Per-season maximum of several items' progress, for merging duplicates. */
export function mergeSeasonProgress(lists: Array<number[] | undefined>): number[] | undefined {
  const present = lists.filter((l): l is number[] => Array.isArray(l));
  if (present.length === 0) return undefined;
  const length = Math.max(...present.map((l) => l.length));
  return Array.from({ length }, (_, i) => Math.max(...present.map((l) => l[i] ?? 0)));
}

export interface EpisodeStep {
  /** What to save to move on by one episode. */
  changes: { progressCurrent?: number; seasonProgress?: number[]; status: ItemStatus };
  /** The episode this marks as watched: "S2 E6" for a show with seasons, "ep. 120" otherwise. */
  label: string;
  /** True when it is the last episode, so the show is finished. */
  finishes: boolean;
}

type StepItem = Pick<SavedItem, "status" | "done" | "progressCurrent" | "seasonProgress" | "tmdb" | "seasonsAtFinish">;

/**
 * Marks the next episode as watched: the one after the last you watched. Undefined when there is nothing to
 * mark (everything is watched, or the item is already done). `total` is the episode count when it is known.
 * Starting a show, or picking up a dropped one, makes it in progress; the last episode finishes it.
 */
export function stepEpisode(item: StepItem, total?: number): EpisodeStep | undefined {
  const now: ItemStatus = item.status ?? (item.done ? "done" : "plan");
  if (now === "done") return undefined;
  const restart = (status: ItemStatus): ItemStatus => (status === "plan" || status === "dropped" ? "in_progress" : status);

  const totals = seasonTotals(item);
  if (totals) {
    const seen = item.seasonProgress ?? ((item.progressCurrent ?? 0) > 0 ? distributeProgress(item.progressCurrent ?? 0, totals) : []);
    const progress = totals.map((_, i) => seen[i] ?? 0);
    const next = nextToWatch(progress, totals);
    if (!next) return undefined;
    progress[next.season - 1] += 1;
    const finishes = nextToWatch(progress, totals) === undefined;
    return {
      changes: { seasonProgress: progress, status: finishes ? "done" : restart(now) },
      label: `S${next.season} E${next.episode}`,
      finishes,
    };
  }

  const next = (item.progressCurrent ?? 0) + 1;
  if (total !== undefined && total > 0 && next > total) return undefined;
  const finishes = total !== undefined && total > 0 && next >= total;
  return { changes: { progressCurrent: next, status: finishes ? "done" : restart(now) }, label: `ep. ${next}`, finishes };
}

/** How many episodes of each season count as watched right now, one entry per season in `totals`. */
export function watchedProgress(item: StepItem, totals: number[]): number[] {
  const now: ItemStatus = item.status ?? (item.done ? "done" : "plan");
  // A show marked finished with no episode counts has watched the seasons it had then, not one that came later.
  const finishedSeasons = item.seasonsAtFinish ?? totals.length;
  const seen =
    item.seasonProgress ??
    ((item.progressCurrent ?? 0) > 0
      ? distributeProgress(item.progressCurrent ?? 0, totals)
      : now === "done"
        ? totals.map((total, i) => (i < finishedSeasons ? total : 0))
        : []);
  return totals.map((total, i) => Math.min(Math.max(0, seen[i] ?? 0), total));
}

/** Whether episode `episode` (1-based) of the season at `column` (0-based, in `totals` order) is watched. */
export function isWatched(progress: number[] | undefined, column: number, episode: number): boolean {
  return episode >= 1 && episode <= (progress?.[column] ?? 0);
}

/**
 * Progress for "watched everything up to here": every earlier season complete, the season at `column` up to
 * `episode` (kept inside that season's total), later seasons not started.
 */
export function markUpTo(totals: number[], column: number, episode: number): number[] {
  const upTo = Math.min(Math.max(0, Math.floor(episode)), totals[column] ?? 0);
  return totals.map((total, i) => (i < column ? total : i === column ? upTo : 0));
}

export interface UpToStep {
  /** What to save. */
  changes: { seasonProgress: number[]; status: ItemStatus };
  /** True when this unwatched episodes instead of marking more. */
  unwatched: boolean;
  /** True when it leaves every episode watched, so the show is finished. */
  finishes: boolean;
}

/**
 * Taps an episode in the ratings grid. An episode you haven't watched marks everything up to it as watched; one you
 * have watched takes it, and everything after it, back to unwatched. Undefined when the show has no season counts
 * or the season isn't one of them. Status follows the episodes: all watched is done, some is in progress, none goes
 * back to plan (a dropped show you pick up again is in progress).
 */
export function upToStep(item: StepItem, column: number, episode: number): UpToStep | undefined {
  const totals = seasonTotals(item);
  if (!totals || !Number.isInteger(column) || column < 0 || column >= totals.length) return undefined;
  if (!Number.isInteger(episode) || episode < 1) return undefined;
  const ep = Math.min(episode, totals[column]);

  const now: ItemStatus = item.status ?? (item.done ? "done" : "plan");
  const seen = watchedProgress(item, totals);
  const unwatched = isWatched(seen, column, ep);
  const progress = markUpTo(totals, column, unwatched ? ep - 1 : ep);

  const finishes = nextToWatch(progress, totals) === undefined;
  let status: ItemStatus;
  if (finishes) status = "done";
  else if (sumProgress(progress) === 0) status = now === "dropped" ? "dropped" : "plan";
  else status = "in_progress";
  return { changes: { seasonProgress: progress, status }, unwatched, finishes };
}

/**
 * How many seasons a series has behind it right now: the ones you could have finished. TMDB's season count already
 * includes a season that has only been announced, so it can't be used as it stands. When the next episode is a season
 * premiere (episode 1), that season is still to come and the ones before it are the finished ones; when it is a later
 * episode of a season already airing, that season counts as seen. Undefined when nothing can be said.
 */
export function seasonsFinished(tmdb: Pick<TmdbInfo, "kind" | "seasons" | "nextEpisode"> | undefined): number | undefined {
  if (!tmdb || tmdb.kind !== "tv") return undefined;
  const next = tmdb.nextEpisode;
  const count = next ? (next.episode === 1 ? next.season - 1 : next.season) : tmdb.seasons;
  return typeof count === "number" && Number.isInteger(count) && count >= 1 ? count : undefined;
}
