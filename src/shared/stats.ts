import type { ItemStatus, MediaType, SavedItem } from "./types.js";
import { genreText } from "./tmdb.js";
import { statusOf } from "./user-data.js";

export interface ShelfStats {
  total: number;
  byType: Partial<Record<MediaType, number>>;
  byStatus: Record<ItemStatus, number>;
  topGenres: Array<{ name: string; count: number }>;
  topTags: Array<{ name: string; count: number }>;
  /** Oldest to newest, always `months` entries, with zeros for quiet months. Keys are UTC "YYYY-MM". */
  finishedPerMonth: Array<{ month: string; count: number }>;
  rating: {
    rated: number;
    average: number | undefined;
    byType: Partial<Record<MediaType, number>>;
    distribution: number[];
  };
  completionRate: number | undefined;
}

export function monthKey(time: number): string {
  const d = new Date(time);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function lastMonths(now: number, months: number): string[] {
  const d = new Date(now);
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    keys.push(monthKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)));
  }
  return keys;
}

function topCounts(values: string[], limit: number): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function genresOf(item: SavedItem): string[] {
  return genreText(item)
    .split(/[,/|]/)
    .map((g) => g.trim())
    .filter(Boolean)
    .map((g) => g.charAt(0).toUpperCase() + g.slice(1).toLowerCase());
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeStats(items: SavedItem[], now = Date.now(), months = 12): ShelfStats {
  const byType: ShelfStats["byType"] = {};
  const byStatus: ShelfStats["byStatus"] = { plan: 0, in_progress: 0, done: 0, dropped: 0 };
  const ratingSums: Partial<Record<MediaType, { sum: number; n: number }>> = {};
  const distribution = Array<number>(10).fill(0);
  const monthCounts = new Map(lastMonths(now, months).map((m) => [m, 0]));
  let ratingSum = 0;
  let rated = 0;

  for (const item of items) {
    byType[item.type] = (byType[item.type] ?? 0) + 1;
    const status = statusOf(item);
    byStatus[status]++;

    if (status === "done" && item.doneAt) {
      const key = monthKey(item.doneAt);
      if (monthCounts.has(key)) monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1);
    }
    if (item.myRating) {
      rated++;
      ratingSum += item.myRating;
      distribution[item.myRating - 1]++;
      const entry = (ratingSums[item.type] ??= { sum: 0, n: 0 });
      entry.sum += item.myRating;
      entry.n++;
    }
  }

  const ratingByType: ShelfStats["rating"]["byType"] = {};
  for (const [type, { sum, n }] of Object.entries(ratingSums) as Array<[MediaType, { sum: number; n: number }]>) {
    ratingByType[type] = round1(sum / n);
  }

  const tracked = items.filter((i) => i.type !== "tab" && i.type !== "link" && i.type !== "note");
  const finished = tracked.filter((i) => statusOf(i) === "done").length;

  return {
    total: items.length,
    byType,
    byStatus,
    topGenres: topCounts(items.flatMap(genresOf), 8),
    topTags: topCounts(items.flatMap((i) => i.tags ?? []), 8),
    finishedPerMonth: [...monthCounts].map(([month, count]) => ({ month, count })),
    rating: { rated, average: rated ? round1(ratingSum / rated) : undefined, byType: ratingByType, distribution },
    completionRate: tracked.length ? Math.round((finished / tracked.length) * 100) : undefined,
  };
}
