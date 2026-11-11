import { genreTags } from "./tmdb.js";
import type { SavedItem } from "./types.js";

/**
 * Narrowing what "Pick something for me" chooses from: by kind, by how long it takes, and by genre.
 * "Under 2 hours" means a movie that fits; a series or anime is judged by one episode, so it fits unless its
 * episodes are longer than that.
 */
export type PickType = "all" | "movie" | "series" | "anime";

export interface PickFilters {
  type: PickType;
  /** Only movies up to this many minutes (and episodes up to it, for series). */
  maxMinutes?: number;
  /** A genre tag such as "horror". */
  genre?: string;
}

export const PICK_TYPES: PickType[] = ["all", "movie", "series", "anime"];

export const PICK_LENGTHS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 90, label: "Under 90m" },
  { minutes: 120, label: "Under 2h" },
  { minutes: 150, label: "Under 2½h" },
];

export const NO_PICK_FILTERS: PickFilters = { type: "all" };

/** "2h 14m", "2h", "90m" to minutes. Seasons and episode counts ("5 seasons") are not runtimes. */
export function parseMinutes(text: string | undefined): number | undefined {
  const m = /^\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*$/i.exec(text ?? "");
  if (!m || (m[1] === undefined && m[2] === undefined)) return undefined;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

/** A film, whether saved as a movie or as anime that TMDB lists as a movie. */
function isFeature(item: Pick<SavedItem, "type" | "tmdb">): boolean {
  return item.type === "movie" || item.tmdb?.kind === "movie";
}

/** How long it takes: a movie's runtime, or one episode of a series. Undefined when nothing says. */
export function runtimeMinutes(item: Pick<SavedItem, "type" | "durationOrSeasons" | "tmdb">): number | undefined {
  if (item.tmdb?.runtimeMinutes) return item.tmdb.runtimeMinutes;
  return isFeature(item) ? parseMinutes(item.durationOrSeasons) : undefined;
}

export function matchesPickFilters(item: SavedItem, filters: PickFilters): boolean {
  if (filters.type !== "all" && item.type !== filters.type) return false;
  if (filters.genre && !genreTags(item).includes(filters.genre)) return false;
  if (filters.maxMinutes !== undefined) {
    const minutes = runtimeMinutes(item);
    if (minutes === undefined) {
      // A film with no known length can't be promised to fit. An episode of a show is short enough to assume.
      if (isFeature(item)) return false;
    } else if (minutes > filters.maxMinutes) {
      return false;
    }
  }
  return true;
}

export function applyPickFilters(items: SavedItem[], filters: PickFilters): SavedItem[] {
  return items.filter((item) => matchesPickFilters(item, filters));
}

/** How many filters are narrowing the choice. */
export function activeFilterCount(filters: PickFilters): number {
  return (filters.type !== "all" ? 1 : 0) + (filters.maxMinutes !== undefined ? 1 : 0) + (filters.genre ? 1 : 0);
}

/** Every genre on these items, for the genre choice, A to Z. */
export function pickGenres(items: SavedItem[]): string[] {
  return [...new Set(items.flatMap((item) => genreTags(item)))].sort((a, b) => a.localeCompare(b));
}

/** Filters read back from storage, keeping only values that mean something. */
export function sanitizePickFilters(raw: unknown): PickFilters {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...NO_PICK_FILTERS };
  const input = raw as Record<string, unknown>;
  const filters: PickFilters = { type: PICK_TYPES.includes(input.type as PickType) ? (input.type as PickType) : "all" };
  if (PICK_LENGTHS.some((l) => l.minutes === input.maxMinutes)) filters.maxMinutes = input.maxMinutes as number;
  if (typeof input.genre === "string" && input.genre.trim() && input.genre.length <= 40) filters.genre = input.genre.trim().toLowerCase();
  return filters;
}
