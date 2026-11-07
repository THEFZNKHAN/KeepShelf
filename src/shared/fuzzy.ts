import type { SavedItem } from "./types.js";
import { statusOf } from "./user-data.js";

const TITLE_THRESHOLD = 0.86;
const STATUS_RANK = { plan: 0, dropped: 1, in_progress: 2, done: 3 } as const;

type Comparable = Pick<SavedItem, "type" | "title" | "year" | "publishedYear" | "author">;

export function isFuzzyComparable(item: Pick<SavedItem, "type">): boolean {
  return item.type !== "tab" && item.type !== "link" && item.type !== "note";
}

/** Lowercase, no accents, no bracketed qualifiers like "(US)", no leading article, no punctuation. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "")
    .replace(/\s+/g, " ");
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 1 for identical, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - editDistance(a, b) / longest;
}

function yearOf(item: Comparable): number | undefined {
  const year = parseInt(item.year ?? item.publishedYear ?? "", 10);
  return Number.isNaN(year) ? undefined : year;
}

function lastNames(author: string | undefined): Set<string> {
  const names = (author ?? "")
    .toLowerCase()
    .split(/,|&| and /)
    .map((part) => part.trim().split(/\s+/).pop() ?? "")
    .filter(Boolean);
  return new Set(names);
}

function authorsCompatible(a: Comparable, b: Comparable): boolean {
  const first = lastNames(a.author);
  const second = lastNames(b.author);
  if (first.size === 0 || second.size === 0) return true;
  return [...first].some((name) => second.has(name));
}

/** True when two items are probably the same title saved twice under slightly different names. */
export function areLikelyDuplicates(a: Comparable, b: Comparable): boolean {
  if (a.type !== b.type || !isFuzzyComparable(a)) return false;
  const yearA = yearOf(a);
  const yearB = yearOf(b);
  if (yearA !== undefined && yearB !== undefined && Math.abs(yearA - yearB) > 1) return false;
  if (a.type === "book" && !authorsCompatible(a, b)) return false;

  const titleA = normalizeTitle(a.title);
  const titleB = normalizeTitle(b.title);
  if (!titleA || !titleB) return false;
  if (titleA === titleB) return true;
  // Short titles differ by a single character far too often ("Her" / "Heat").
  if (Math.min(titleA.length, titleB.length) < 5) return false;
  return similarity(titleA, titleB) >= TITLE_THRESHOLD;
}

/** Groups of two or more items that look like the same title. Each group keeps shelf order. */
export function findDuplicateGroups(items: SavedItem[]): SavedItem[][] {
  const candidates = items.filter(isFuzzyComparable);
  const parent = candidates.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (find(i) === find(j)) continue;
      if (areLikelyDuplicates(candidates[i], candidates[j])) parent[find(j)] = find(i);
    }
  }

  const groups = new Map<number, SavedItem[]>();
  candidates.forEach((item, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), item]);
  });
  return [...groups.values()].filter((group) => group.length > 1);
}

/** Existing items that a not-yet-saved item closely resembles (but doesn't exactly match). */
export function findNearDuplicates(candidate: Comparable, items: SavedItem[]): SavedItem[] {
  return items.filter((item) => areLikelyDuplicates(candidate, item));
}

/** The item to keep from a group: the one with the most personal data, then the earliest saved. */
export function pickKeeper(group: SavedItem[]): SavedItem {
  const weight = (item: SavedItem) =>
    STATUS_RANK[statusOf(item)] +
    (item.myRating ? 2 : 0) +
    (item.review ? 2 : 0) +
    (item.tags?.length ? 1 : 0) +
    (item.list ? 1 : 0) +
    (item.progressCurrent ? 1 : 0);
  return [...group].sort((a, b) => weight(b) - weight(a) || a.savedAt - b.savedAt)[0];
}

/** Fields to write onto the keeper so nothing the user entered on the duplicates is lost. */
export function mergeUserData(keeper: SavedItem, others: SavedItem[]): Partial<SavedItem> {
  const all = [keeper, ...others];
  const patch: Partial<SavedItem> = {};

  const tags = [...new Set(all.flatMap((i) => i.tags ?? []))];
  if (tags.length) patch.tags = tags;

  const pick = <K extends "list" | "myRating" | "review" | "progressTotal">(key: K) =>
    all.map((i) => i[key]).find((value) => value !== undefined);
  const list = pick("list");
  if (list !== undefined) patch.list = list;
  const rating = pick("myRating");
  if (rating !== undefined) patch.myRating = rating;
  const review = pick("review");
  if (review !== undefined) patch.review = review;
  const total = pick("progressTotal");
  if (total !== undefined) patch.progressTotal = total;

  const progress = Math.max(...all.map((i) => i.progressCurrent ?? -1));
  if (progress >= 0) patch.progressCurrent = progress;

  const best = all.reduce((top, item) => (STATUS_RANK[statusOf(item)] > STATUS_RANK[statusOf(top)] ? item : top));
  patch.status = statusOf(best);
  patch.done = patch.status === "done";
  patch.doneAt = patch.done ? (all.find((i) => i.done && i.doneAt)?.doneAt ?? Date.now()) : undefined;
  return patch;
}
