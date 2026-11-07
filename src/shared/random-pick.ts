import type { SavedItem } from "./types.js";
import { statusOf } from "./user-data.js";

/**
 * Something to watch or read next. Planned items come first; if there are none,
 * anything already in progress is suggested instead. Done and dropped items are never picked.
 */
export function pickCandidates(items: SavedItem[]): SavedItem[] {
  const planned = items.filter((i) => statusOf(i) === "plan");
  if (planned.length) return planned;
  return items.filter((i) => statusOf(i) === "in_progress");
}

/** Picks uniformly at random, avoiding `excludeId` (for "pick another") whenever there is another choice. */
export function pickRandom(
  items: SavedItem[],
  options: { excludeId?: string; random?: () => number } = {}
): SavedItem | undefined {
  const pool = pickCandidates(items);
  const choices = pool.length > 1 ? pool.filter((i) => i.id !== options.excludeId) : pool;
  if (choices.length === 0) return undefined;
  const random = options.random ?? Math.random;
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}
