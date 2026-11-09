import type { SavedItem } from "./types.js";

/** Deep copies of the items with these ids, so a later change can't alter what Undo restores. */
export function snapshotItems(all: SavedItem[], ids: string[]): SavedItem[] {
  const wanted = new Set(ids);
  return all.filter((item) => wanted.has(item.id)).map((item) => structuredClone(item));
}
