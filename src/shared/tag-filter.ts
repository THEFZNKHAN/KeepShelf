import { allTags } from "./tmdb.js";
import type { SavedItem } from "./types.js";

export interface RankedTag {
  tag: string;
  /** How many items have it. */
  count: number;
  /** You typed it yourself on at least one item, as opposed to it coming from a genre. */
  manual: boolean;
}

export interface TagGroups {
  /** Tags you typed, alphabetically. */
  manual: RankedTag[];
  /** Tags that only come from genres, alphabetically. */
  genres: RankedTag[];
}

/**
 * Every tag worth offering in the filter, with how many items use it: the ones you typed, and the ones that
 * only come from genres. A tag counts once per item, and one you typed never also appears under genres.
 */
export function groupTags(items: Array<Pick<SavedItem, "tags" | "genre" | "tmdb" | "bookInfo">>): TagGroups {
  const counts = new Map<string, RankedTag>();
  for (const item of items) {
    const typed = new Set(item.tags ?? []);
    for (const tag of allTags(item)) {
      const entry = counts.get(tag) ?? { tag, count: 0, manual: false };
      entry.count++;
      if (typed.has(tag)) entry.manual = true;
      counts.set(tag, entry);
    }
  }
  const byName = (a: RankedTag, b: RankedTag) => a.tag.localeCompare(b.tag);
  const all = [...counts.values()];
  return { manual: all.filter((t) => t.manual).sort(byName), genres: all.filter((t) => !t.manual).sort(byName) };
}
