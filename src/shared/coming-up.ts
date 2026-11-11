import { RECENT_RELEASE_DAYS, daysUntil, upcoming } from "./reminders.js";
import type { SavedItem } from "./types.js";
import { statusOf } from "./user-data.js";

/** How far ahead the Coming up screen looks by default. */
export const COMING_UP_DAYS = 14;

/** The windows to choose from. A streaming date is often more than two weeks away, so wider ones matter. */
export const COMING_UP_WINDOWS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 14, label: "2 weeks" },
  { days: 30, label: "1 month" },
  { days: 90, label: "3 months" },
];

/** A saved choice of window, or the default when it isn't one of the options. */
export function sanitizeWindow(value: unknown): number {
  const days = typeof value === "string" ? Number(value) : value;
  return COMING_UP_WINDOWS.some((w) => w.days === days) ? (days as number) : COMING_UP_DAYS;
}

export interface ComingUpEntry {
  item: SavedItem;
  /** TMDB's date, "2026-11-14". */
  date: string;
  /** Whole days from today. 0 is today. */
  days: number;
  /** "S2 E6" for an episode, "release" for a movie's release, "streaming" for when a movie reaches streaming. */
  label: string;
  /** The country the streaming date is for. */
  region?: string;
}

export interface ComingUpGroup {
  days: number;
  date: string;
  /** "Today", "Tomorrow", or "Fri 21 Nov". */
  heading: string;
  entries: ComingUpEntry[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The country codes to look for a streaming date in: the user's own first, then the US. */
export function regionsFor(locale: string | undefined): string[] {
  const own = /[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(locale ?? "")?.[1]?.toUpperCase();
  return [...new Set([own, "US"].filter((r): r is string => Boolean(r)))];
}

/** When a movie reaches streaming and online stores, for the first of `regions` that TMDB has a date for. */
export function digitalDate(item: SavedItem, regions: string[]): { date: string; region: string } | undefined {
  const dates = item.tmdb?.kind === "movie" ? item.tmdb.digitalDates : undefined;
  if (!dates) return undefined;
  for (const region of regions) {
    const date = dates[region];
    if (date) return { date, region };
  }
  return undefined;
}

/** "9 Dec". */
export function shortDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : isoDate;
}

/** "Streaming 9 Dec" (or "today") for a movie whose streaming date has not passed; undefined otherwise. */
export function streamingNote(item: SavedItem, now: number, regions: string[]): string | undefined {
  const digital = digitalDate(item, regions);
  const days = digital ? daysUntil(digital.date, now) : undefined;
  if (!digital || days === undefined || days < 0) return undefined;
  return `Streaming ${days === 0 ? "today" : days === 1 ? "tomorrow" : shortDate(digital.date)}`;
}

/**
 * What is airing or releasing in the next `windowDays` for titles you haven't finished, soonest first. A movie
 * can appear twice: when it is released, and when it reaches streaming.
 */
export function comingUp(items: SavedItem[], now: number, windowDays = COMING_UP_DAYS, regions: string[] = ["US"]): ComingUpEntry[] {
  const entries: ComingUpEntry[] = [];
  const inWindow = (days: number | undefined): days is number => days !== undefined && days >= 0 && days <= windowDays;
  for (const item of items) {
    const status = statusOf(item);
    if (status === "done" || status === "dropped") continue;
    const next = upcoming(item);
    const digital = digitalDate(item, regions);
    const sameDay = Boolean(next && digital && next.date === digital.date);

    if (next) {
      const days = daysUntil(next.date, now);
      // A film released straight to streaming has one date, and it is a streaming date.
      if (inWindow(days)) {
        entries.push({ item, date: next.date, days, label: sameDay ? "streaming" : next.label, ...(sameDay && digital ? { region: digital.region } : {}) });
      }
    }
    if (digital && !sameDay) {
      const days = daysUntil(digital.date, now);
      if (inWindow(days)) entries.push({ item, date: digital.date, days, label: "streaming", region: digital.region });
    }
  }
  return entries.sort((a, b) => a.days - b.days || a.item.title.localeCompare(b.item.title));
}

/** "Today", "Tomorrow", or the date, such as "Fri 21 Nov". */
export function dayHeading(days: number, isoDate: string): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
  return `${weekday} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

/** Entries that fall on the same day, in order. */
export function groupByDay(entries: ComingUpEntry[]): ComingUpGroup[] {
  const groups: ComingUpGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.days === entry.days) {
      last.entries.push(entry);
    } else {
      groups.push({ days: entry.days, date: entry.date, heading: dayHeading(entry.days, entry.date), entries: [entry] });
    }
  }
  return groups;
}

/**
 * Shows you are following that TMDB says are still airing but gives no next date for, or whose saved date has
 * passed. These are the ones that "should" be on the list and aren't, so the screen can say why.
 */
export function airingWithoutDate(items: SavedItem[], now: number): SavedItem[] {
  return items
    .filter((item) => {
      const tmdb = item.tmdb;
      const status = statusOf(item);
      if (!tmdb || tmdb.kind !== "tv" || status === "done" || status === "dropped") return false;
      if (!tmdb.status || /^(ended|canceled|cancelled)$/i.test(tmdb.status)) return false;
      const next = upcoming(item);
      const days = next ? daysUntil(next.date, now) : undefined;
      return days === undefined || days < 0;
    })
    .sort((a, b) => Number(statusOf(b) === "in_progress") - Number(statusOf(a) === "in_progress") || a.title.localeCompare(b.title));
}

/** Where a movie stands on streaming, for the movies that are not in the list above. */
export interface StreamingStatus {
  item: SavedItem;
  /**
   * `since`: already on streaming. `later`: a date, beyond the window. `none`: TMDB has no streaming date yet.
   * `unchecked`: saved before streaming dates were kept, so KeepShelf hasn't looked.
   */
  state: "since" | "later" | "none" | "unchecked";
  date?: string;
  region?: string;
}

/**
 * Movies you haven't finished that are unreleased or came out recently, with where they stand on streaming.
 * It explains the ones that are missing from the dated list, for example because the date is further away.
 */
export function streamingStatuses(items: SavedItem[], now: number, regions: string[], windowDays = COMING_UP_DAYS): StreamingStatus[] {
  const out: StreamingStatus[] = [];
  for (const item of items) {
    const status = statusOf(item);
    if (status === "done" || status === "dropped" || item.tmdb?.kind !== "movie") continue;
    const release = item.tmdb.releaseDate ? daysUntil(item.tmdb.releaseDate, now) : undefined;
    if (release !== undefined && release < -RECENT_RELEASE_DAYS) continue;

    const digital = digitalDate(item, regions);
    if (digital) {
      const days = daysUntil(digital.date, now);
      if (days === undefined) continue;
      if (days < 0) out.push({ item, state: "since", date: digital.date, region: digital.region });
      else if (days > windowDays) out.push({ item, state: "later", date: digital.date, region: digital.region });
      // Inside the window it is already in the list.
    } else {
      out.push({ item, state: item.tmdb.digitalDates === undefined ? "unchecked" : "none" });
    }
  }
  return out.sort((a, b) => a.item.title.localeCompare(b.item.title));
}
