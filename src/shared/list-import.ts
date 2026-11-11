import { findNearDuplicates } from "./fuzzy.js";
import { dedupeKey } from "./storage.js";
import type { ImportItem, SavedItem } from "./types.js";

/**
 * Reads a pasted list of titles, such as lines copied from a Keep note or from KeepShelf's own "Copy all":
 *
 *   Drishyam (2015) | 2h 43m | IMDb 8.2
 *   Fargo (2014) | S05 | IMDb 8.8
 *   86 (2021) | S01 | IMDb 8.3 (A)
 *
 * It is forgiving: bullets and checkboxes are dropped, unknown parts are ignored, the year is optional, and a
 * heading such as "Watched" switches the lines under it. Movies, series and anime only.
 */

export interface ParsedLine {
  title: string;
  year?: string;
  type: "movie" | "series" | "anime";
  durationOrSeasons?: string;
  imdbRating?: string;
  watched: boolean;
}

export interface ParsedList {
  entries: ParsedLine[];
  /** Lines that were skipped because they aren't titles (an address, or far too long). */
  unreadable: string[];
}

const WATCHED_HEADING = /^(?:already\s+)?(?:watched|seen|done|finished)\s*:?$/i;
const PLAN_HEADING = /^(?:to\s+watch|unwatched|not\s+watched|watchlist|planned|plan|queue)\s*:?$/i;
const CHECKED = /^(?:\[[xX✓✔]\]|[☑✓✔])\s*/;
const UNCHECKED = /^(?:\[\s?\]|☐)\s*/;
const BULLET = /^[-*•]\s+/;
const MAX_LINE = 250;

/** Reads one line, or undefined when it isn't a title. `watched` is what the list says unless the line is ticked. */
export function parseListLine(raw: string, watched: boolean): ParsedLine | undefined {
  let line = raw.replace(/\s+/g, " ").trim();
  if (!line || line.length > MAX_LINE || /^https?:\/\//i.test(line)) return undefined;

  if (CHECKED.test(line)) {
    watched = true;
    line = line.replace(CHECKED, "");
  } else if (UNCHECKED.test(line)) {
    line = line.replace(UNCHECKED, "");
  }
  line = line.replace(BULLET, "").trim();
  if (!line) return undefined;

  // Parts are separated by "|" (what Copy all writes) or by " · " (what the list shows).
  const [head, ...parts] = line.split(/\s*\|\s*|\s+·\s+/).map((p) => p.trim());
  let anime = false;
  let title = head;
  let year: string | undefined;

  const withYear = /^(.*?)\s*\((\d{4})\)\s*(\(A\))?$/.exec(head);
  if (withYear && withYear[1]) {
    title = withYear[1].trim();
    year = withYear[2];
    anime = Boolean(withYear[3]);
  } else if (/\(A\)\s*$/.test(head)) {
    title = head.replace(/\s*\(A\)\s*$/, "").trim();
    anime = true;
  }
  // A dash, a bare "(2015)" or other leftovers are not titles.
  if (!/[\p{L}\p{N}]/u.test(title) || /^\(\d{4}\)$/.test(title)) return undefined;

  let seasons = false;
  let durationOrSeasons: string | undefined;
  let imdbRating: string | undefined;
  for (let part of parts) {
    if (/\(A\)\s*$/.test(part)) {
      anime = true;
      part = part.replace(/\s*\(A\)\s*$/, "").trim();
    }
    let m: RegExpExecArray | null;
    if ((m = /^S0*(\d+)$/i.exec(part))) {
      seasons = true;
      durationOrSeasons = `${m[1]} season${m[1] === "1" ? "" : "s"}`;
    } else if (/^\d+h(?:\s*\d+m)?$|^\d+m$/i.test(part)) {
      durationOrSeasons = part.toLowerCase();
    } else if ((m = /^(\d+)\s*eps?$/i.exec(part))) {
      durationOrSeasons = `${m[1]} eps`;
    } else if ((m = /^IMDb\s+(\d+(?:\.\d+)?)$/i.exec(part))) {
      imdbRating = m[1];
    }
    // Anything else (other sites' ratings, certificates, notes) is ignored.
  }

  const type = anime ? "anime" : seasons ? "series" : "movie";
  return { title, year, type, durationOrSeasons, imdbRating, watched };
}

/** Reads a whole pasted list. `watched` is what the list is, unless a heading or a ticked box says otherwise. */
export function parseList(text: string, watched: boolean): ParsedList {
  const entries: ParsedLine[] = [];
  const unreadable: string[] = [];
  let current = watched;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (WATCHED_HEADING.test(line)) {
      current = true;
      continue;
    }
    if (PLAN_HEADING.test(line)) {
      current = false;
      continue;
    }
    const entry = parseListLine(line, current);
    if (entry) entries.push(entry);
    else unreadable.push(line.length > 60 ? `${line.slice(0, 57)}…` : line);
  }
  return { entries, unreadable };
}

/** Shelf entries for parsed lines. The first line is the newest, so the list keeps the order it was pasted in. */
export function listToItems(entries: ParsedLine[], now = Date.now()): ImportItem[] {
  return entries.map((entry, i) => {
    const savedAt = now - i * 1000;
    const item: ImportItem = {
      title: entry.title,
      type: entry.type,
      subtitle: [entry.year, entry.durationOrSeasons].filter(Boolean).join(" · "),
      googleQuery: [entry.title, entry.year].filter(Boolean).join(" "),
      sourceUrl: "",
      savedAt,
      ...(entry.year ? { year: entry.year } : {}),
      ...(entry.durationOrSeasons ? { durationOrSeasons: entry.durationOrSeasons } : {}),
      ...(entry.imdbRating ? { imdbRating: entry.imdbRating } : {}),
    };
    if (entry.watched) {
      item.done = true;
      item.status = "done";
      item.doneAt = savedAt;
    }
    return item;
  });
}

export interface ListPlan {
  /** New to the shelf. */
  fresh: ImportItem[];
  /** The same title, year and type as something already saved. */
  duplicates: ImportItem[];
  /** Close to something saved under another name; skipped, and named so the user can tell. */
  similar: Array<{ item: ImportItem; like: string }>;
}

/** Splits parsed items into what to add and what to leave out, so a pasted list never doubles up the shelf. */
export function planListImport(items: ImportItem[], existing: SavedItem[]): ListPlan {
  const have = new Set(existing.map(dedupeKey));
  const plan: ListPlan = { fresh: [], duplicates: [], similar: [] };
  const seen = new Set<string>();
  for (const item of items) {
    const key = dedupeKey(item);
    if (have.has(key) || seen.has(key)) {
      plan.duplicates.push(item);
      continue;
    }
    const near = findNearDuplicates(item, existing)[0];
    if (near) {
      plan.similar.push({ item, like: near.title });
      continue;
    }
    seen.add(key);
    plan.fresh.push(item);
  }
  return plan;
}
