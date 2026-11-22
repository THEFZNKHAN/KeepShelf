import type { ItemStatus, SavedItem } from "./types.js";
import type { DefaultView, StatusFilter } from "./status-view.js";
import { statusOf } from "./user-data.js";

/** Where a row's "See all" leads: the shelf with that status filter, or the Coming up screen. */
export type SeeAll = StatusFilter | "upcoming";

export interface HomeRow<T> {
  key: string;
  title: string;
  items: T[];
  /** How many titles the row has in all; `items` may be cut to the row limit. */
  total: number;
  seeAll: SeeAll;
}

/** A quiet link under the rows to what the default view keeps out of the way, such as "Watched 12". */
export interface HomeLink {
  filter: StatusFilter;
  label: string;
  count: number;
}

export interface HomeOptions {
  shelf: "media" | "books";
  defaultView: DefaultView;
  /** Titles airing or releasing soon, soonest first (from Coming up). Only ids that are in `items` are used. */
  soonIds?: string[];
  /** Finished series with a season you haven't watched, best first. */
  newSeasonIds?: string[];
  /** The most titles one row shows; "See all" has the rest. */
  limit?: number;
}

export const HOME_ROW_LIMIT = 20;

type RowItem = Pick<SavedItem, "id" | "status" | "done" | "savedAt">;

const WORDS = {
  media: { progress: "Continue watching", plan: "My list", done: "Watched", dropped: "Dropped" },
  books: { progress: "Continue reading", plan: "Want to read", done: "Read", dropped: "Dropped" },
} as const;

/**
 * The home screen's rows, in the order a person wants them: what you are in the middle of, what is coming out, then
 * your list. Watched and dropped titles get rows only when the default view shows everything; otherwise they are
 * offered as links underneath. Empty rows are left out, and a title appears in one status row only.
 */
export function buildHomeRows<T extends RowItem>(items: T[], options: HomeOptions): { rows: HomeRow<T>[]; links: HomeLink[] } {
  const limit = options.limit ?? HOME_ROW_LIMIT;
  const words = WORDS[options.shelf];
  const newestFirst = (a: T, b: T) => b.savedAt - a.savedAt;
  const byStatus = (status: ItemStatus) => items.filter((i) => statusOf(i) === status).sort(newestFirst);
  const byIds = (ids: string[] | undefined) => {
    if (!ids?.length) return [];
    const index = new Map(items.map((i) => [i.id, i]));
    const seen = new Set<string>();
    const out: T[] = [];
    for (const id of ids) {
      const item = index.get(id);
      if (item && !seen.has(id)) {
        seen.add(id);
        out.push(item);
      }
    }
    return out;
  };

  const rows: HomeRow<T>[] = [];
  const add = (key: string, title: string, list: T[], seeAll: SeeAll) => {
    if (list.length) rows.push({ key, title, items: list.slice(0, limit), total: list.length, seeAll });
  };

  add("progress", words.progress, byStatus("in_progress"), "progress");
  if (options.shelf === "media") {
    add("soon", "Coming up", byIds(options.soonIds), "upcoming");
    add("new-seasons", "New seasons", byIds(options.newSeasonIds), "upcoming");
  }
  add("plan", words.plan, byStatus("plan"), "todo");

  const links: HomeLink[] = [];
  for (const status of ["done", "dropped"] as const) {
    const list = byStatus(status);
    const filter: StatusFilter = status;
    if (options.defaultView === "all") add(status, words[status], list, filter);
    else if (list.length) links.push({ filter, label: words[status], count: list.length });
  }
  return { rows, links };
}

/** How far through a title you are, 0 to 1, for the bar under its poster. Undefined when there is nothing to show. */
export function progressFraction(current: number | undefined, total: number | undefined): number | undefined {
  if (current === undefined || !total || total <= 0 || current <= 0) return undefined;
  return Math.min(1, current / total);
}

/** The order the home billboard looks in for a title to feature: what you are watching, then what's out soon, then your list. */
const FEATURE_ORDER = ["progress", "soon", "new-seasons", "plan"];

/** The row whose first title the billboard at the top of home shows, or undefined when there is nothing to feature. */
export function featuredRow<T>(rows: HomeRow<T>[]): HomeRow<T> | undefined {
  for (const key of FEATURE_ORDER) {
    const row = rows.find((r) => r.key === key && r.items.length > 0);
    if (row) return row;
  }
  return undefined;
}

/**
 * What a Coming up poster says under its title: when, then what. `label` is the Coming up label, such as "S3 E2",
 * "release" or "streaming".
 */
export function soonText(days: number, label: string): string {
  const when = days <= 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
  const what = label === "release" ? "Release" : label === "streaming" ? "Streaming" : label;
  return what ? `${when} · ${what}` : when;
}
