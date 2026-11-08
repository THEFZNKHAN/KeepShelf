import type { ItemStatus, SavedItem, UserFields } from "./types.js";

export const ITEM_STATUSES: ItemStatus[] = ["plan", "in_progress", "done", "dropped"];

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 30;
export const MAX_REVIEW_LENGTH = 2000;

export function isItemStatus(value: unknown): value is ItemStatus {
  return typeof value === "string" && (ITEM_STATUSES as string[]).includes(value);
}

/** Lowercased, trimmed, de-duplicated, without a leading "#". Accepts an array or a comma-separated string. */
export function normalizeTags(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim().replace(/^#+/, "").replace(/\s+/g, " ").toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (tag) seen.add(tag);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

/** A whole rating from 1 to 10, or undefined for "no rating". Throws on anything else. */
export function normalizeRating(input: unknown): number | undefined {
  if (input === null || input === undefined || input === "") return undefined;
  const value = Number(input);
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error("Rating must be a whole number from 1 to 10.");
  }
  return value;
}

/** A non-negative whole number, or undefined when empty. Throws on anything else. */
export function normalizeCount(input: unknown, label: string): number | undefined {
  if (input === null || input === undefined || input === "") return undefined;
  const value = Number(input);
  if (!Number.isInteger(value) || value < 0 || value > 100000) {
    throw new Error(`${label} must be a whole number.`);
  }
  return value;
}

/** Whether to offer the rating box when something is marked finished. Only things you watch or read are rated. */
export function shouldAskForRating(item: Pick<SavedItem, "type">, enabled: boolean): boolean {
  return enabled && (item.type === "movie" || item.type === "series" || item.type === "anime" || item.type === "book");
}

export function statusOf(item: Pick<SavedItem, "status" | "done">): ItemStatus {
  if (item.status) return item.status;
  return item.done ? "done" : "plan";
}

/**
 * Turns the user-facing fields of an update into a patch for the stored item.
 * Keeps `done` and `doneAt` consistent with `status` so older code paths and backups still work.
 */
export function buildUserPatch(
  item: Pick<SavedItem, "status" | "done" | "doneAt" | "progressTotal" | "progressCurrent">,
  changes: UserFields & { done?: boolean },
  now = Date.now()
): Partial<SavedItem> {
  const patch: Partial<SavedItem> = {};

  if ("tags" in changes) {
    const tags = normalizeTags(changes.tags);
    patch.tags = tags.length ? tags : undefined;
  }
  if ("list" in changes) {
    patch.list = changes.list?.trim().slice(0, MAX_TAG_LENGTH) || undefined;
  }
  if ("myRating" in changes) patch.myRating = normalizeRating(changes.myRating);
  if ("review" in changes) {
    const review = changes.review?.trim() ?? "";
    if (review.length > MAX_REVIEW_LENGTH) throw new Error(`Review is limited to ${MAX_REVIEW_LENGTH} characters.`);
    patch.review = review || undefined;
  }
  if ("progressCurrent" in changes) patch.progressCurrent = normalizeCount(changes.progressCurrent, "Progress");
  if ("progressTotal" in changes) patch.progressTotal = normalizeCount(changes.progressTotal, "Total");

  const current = patch.progressCurrent ?? ("progressCurrent" in patch ? undefined : item.progressCurrent);
  const total = patch.progressTotal ?? ("progressTotal" in patch ? undefined : item.progressTotal);
  if (current !== undefined && total !== undefined && current > total) {
    throw new Error("Progress can't be higher than the total.");
  }

  let status: ItemStatus | undefined;
  if ("status" in changes && changes.status !== undefined) {
    if (!isItemStatus(changes.status)) throw new Error("Unknown status.");
    status = changes.status;
  } else if (typeof changes.done === "boolean") {
    const before = statusOf(item);
    status = changes.done ? "done" : before === "done" ? "plan" : before;
  }

  if (status) {
    patch.status = status;
    const isDone = status === "done";
    patch.done = isDone;
    patch.doneAt = isDone ? (item.done ? (item.doneAt ?? now) : now) : undefined;
  }
  return patch;
}

/** Cleans the user fields of an imported item; invalid values are dropped rather than failing the import. */
export function sanitizeImportedUserData(raw: Record<string, unknown>): Partial<SavedItem> {
  const out: Partial<SavedItem> = {};
  const tags = normalizeTags(raw.tags);
  if (tags.length) out.tags = tags;
  if (typeof raw.list === "string" && raw.list.trim()) out.list = raw.list.trim().slice(0, MAX_TAG_LENGTH);
  try {
    const rating = normalizeRating(raw.myRating);
    if (rating) out.myRating = rating;
  } catch {
    /* ignore */
  }
  if (typeof raw.review === "string" && raw.review.trim()) out.review = raw.review.trim().slice(0, MAX_REVIEW_LENGTH);
  if (isItemStatus(raw.status)) {
    out.status = raw.status;
    out.done = raw.status === "done";
  }
  for (const key of ["progressCurrent", "progressTotal"] as const) {
    try {
      const count = normalizeCount(raw[key], key);
      if (count !== undefined) out[key] = count;
    } catch {
      /* ignore */
    }
  }
  return out;
}
