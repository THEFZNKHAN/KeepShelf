import type { ItemStatus } from "./types.js";

/**
 * Which items the status filter keeps, and what the popup shows when you open it.
 * "pending" is "Not watched": still to watch or in progress, so watched and dropped items stay out of the way.
 */
export type StatusFilter = "all" | "pending" | "todo" | "progress" | "done" | "dropped";

export const STATUS_FILTERS: StatusFilter[] = ["all", "pending", "todo", "progress", "done", "dropped"];

/** What to show when KeepShelf opens: the default view, or wherever you were last time. */
export type StartMode = "fresh" | "remember";
export const START_MODES: StartMode[] = ["fresh", "remember"];

/** The default view: hide what is already watched (and dropped), or show everything. */
export type DefaultView = "hide" | "all";
export const DEFAULT_VIEWS: DefaultView[] = ["hide", "all"];

const KEPT: Record<Exclude<StatusFilter, "all">, ItemStatus[]> = {
  pending: ["plan", "in_progress"],
  todo: ["plan"],
  progress: ["in_progress"],
  done: ["done"],
  dropped: ["dropped"],
};

export function matchesStatusFilter(status: ItemStatus, filter: StatusFilter): boolean {
  return filter === "all" || KEPT[filter].includes(status);
}

/**
 * The status filter to apply while the search box has words in it. "Not watched" is the default view's way of keeping
 * watched titles out of the way, but someone searching for a title wants it found whether or not they have watched it,
 * so it stands aside while searching. A status picked on purpose (To watch, Watched, ...) is kept.
 */
export function statusFilterWhileSearching(filter: StatusFilter, searching: boolean): StatusFilter {
  return searching && filter === "pending" ? "all" : filter;
}

export function defaultStatusFilter(view: DefaultView): StatusFilter {
  return view === "hide" ? "pending" : "all";
}

/**
 * The filter that is really applied on a shelf. A choice the shelf doesn't offer falls back: "Not watched" on a
 * shelf with only To do and Done (saved tabs) is just "To do", and anything else unknown is "All".
 */
export function effectiveStatusFilter(filter: StatusFilter, available: StatusFilter[]): StatusFilter {
  if (available.includes(filter)) return filter;
  if (filter === "pending" && available.includes("todo")) return "todo";
  return "all";
}
