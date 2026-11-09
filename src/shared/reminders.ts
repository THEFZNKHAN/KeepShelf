import type { SavedItem } from "./types.js";
import { statusOf } from "./user-data.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Notify when something comes out today or tomorrow. */
export const REMINDER_WINDOW_DAYS = 1;
/** Release dates are re-checked at most this often per item, so a daily alarm doesn't mean daily requests. */
export const DATE_REFRESH_AFTER_MS = 7 * DAY_MS;
/** At most this many TMDB requests per check. */
export const MAX_DATE_REFRESHES = 25;
/** Records of what was announced are kept this long past the release date, then dropped. */
const KEEP_NOTIFIED_DAYS = 14;

export interface DueReminder {
  /** Identifies this release for this item, so it is announced once. */
  key: string;
  item: SavedItem;
  date: string;
  days: number;
  /** "S2 E5" for an episode, "release" for a movie. */
  label: string;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole calendar days from today to a TMDB date such as "2026-11-10", in the user's own time zone. */
export function daysUntil(isoDate: string, now: number): number | undefined {
  const m = ISO_DAY.exec(isoDate);
  if (!m) return undefined;
  const today = new Date(now);
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(target)) return undefined;
  return Math.round((target - todayUtc) / DAY_MS);
}

function isOpen(item: Pick<SavedItem, "status" | "done">): boolean {
  const status = statusOf(item);
  return status !== "done" && status !== "dropped";
}

/** The next thing to be reminded about for an item: an episode for a series, the release for a movie. */
export function upcoming(item: SavedItem): { date: string; label: string } | undefined {
  const tmdb = item.tmdb;
  if (!tmdb) return undefined;
  if (tmdb.kind === "tv") {
    const next = tmdb.nextEpisode;
    return next ? { date: next.airDate, label: `S${next.season} E${next.episode}` } : undefined;
  }
  return tmdb.releaseDate ? { date: tmdb.releaseDate, label: "release" } : undefined;
}

export function reminderKey(item: Pick<SavedItem, "id">, date: string): string {
  return `${item.id}:${date}`;
}

/** What to announce now: open items whose date is today or within the window, not announced before. */
export function dueReminders(
  items: SavedItem[],
  now: number,
  notified: Record<string, string>,
  windowDays = REMINDER_WINDOW_DAYS
): DueReminder[] {
  const due: DueReminder[] = [];
  for (const item of items) {
    if (!isOpen(item)) continue;
    const next = upcoming(item);
    if (!next) continue;
    const days = daysUntil(next.date, now);
    if (days === undefined || days < 0 || days > windowDays) continue;
    const key = reminderKey(item, next.date);
    if (notified[key]) continue;
    due.push({ key, item, date: next.date, days, label: next.label });
  }
  return due.sort((a, b) => a.days - b.days || a.item.title.localeCompare(b.item.title));
}

/** Forgets announcements for dates long gone. */
export function pruneNotified(notified: Record<string, string>, now: number): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, date] of Object.entries(notified)) {
    const days = typeof date === "string" ? daysUntil(date, now) : undefined;
    if (days !== undefined && days >= -KEEP_NOTIFIED_DAYS) kept[key] = date;
  }
  return kept;
}

/** Whether the saved TMDB dates for an item may be out of date and worth one request. */
export function needsDateRefresh(item: SavedItem, now: number): boolean {
  const tmdb = item.tmdb;
  if (!tmdb || !isOpen(item)) return false;
  if (now - tmdb.fetchedAt < DATE_REFRESH_AFTER_MS) return false;
  if (tmdb.kind === "tv") {
    if (/^(ended|canceled|cancelled)$/i.test(tmdb.status ?? "")) return false;
    const days = tmdb.nextEpisode ? daysUntil(tmdb.nextEpisode.airDate, now) : undefined;
    return days === undefined || days < 0;
  }
  const days = tmdb.releaseDate ? daysUntil(tmdb.releaseDate, now) : undefined;
  return days === undefined || days > 0;
}

export function selectForRefresh(items: SavedItem[], now: number, max = MAX_DATE_REFRESHES): SavedItem[] {
  return items.filter((item) => needsDateRefresh(item, now)).slice(0, max);
}

function when(days: number): string {
  return days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}

/** The notification text: the title alone for one release, a short list for several. */
export function describeReminders(due: DueReminder[]): { title: string; message: string } {
  const line = (d: DueReminder) =>
    d.label === "release" ? `${d.item.title}: out ${when(d.days)}` : `${d.item.title}: ${d.label} ${when(d.days)}`;
  if (due.length === 1) {
    return { title: "Coming up on your shelf", message: line(due[0]) };
  }
  return { title: `${due.length} things coming up on your shelf`, message: due.map(line).join("\n") };
}
