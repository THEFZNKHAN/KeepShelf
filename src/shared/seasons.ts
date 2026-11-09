import type { ItemStatus, SavedItem } from "./types.js";

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
