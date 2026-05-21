import type { SavedItem } from "./types.js";

const STORAGE_KEY = "trackbuddy_items";

export async function getAllItems(): Promise<SavedItem[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const items = result[STORAGE_KEY] as SavedItem[] | undefined;
  return Array.isArray(items) ? items : [];
}

export async function saveItem(
  partial: Omit<SavedItem, "id" | "savedAt">
): Promise<{ item: SavedItem; duplicate: boolean }> {
  const items = await getAllItems();
  const key = dedupeKey(partial);
  const existing = items.find((i) => dedupeKey(i) === key);
  if (existing) {
    return { item: existing, duplicate: true };
  }

  const item: SavedItem = {
    ...partial,
    id: crypto.randomUUID(),
    savedAt: Date.now(),
  };
  items.unshift(item);
  await chrome.storage.local.set({ [STORAGE_KEY]: items });
  await updateBadge(items.length);
  return { item, duplicate: false };
}

export async function deleteItems(ids: string[]): Promise<SavedItem[]> {
  const idSet = new Set(ids);
  const items = (await getAllItems()).filter((i) => !idSet.has(i.id));
  await chrome.storage.local.set({ [STORAGE_KEY]: items });
  await updateBadge(items.length);
  return items;
}

export async function clearAll(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  await updateBadge(0);
}

export function dedupeKey(
  item: Pick<SavedItem, "title" | "year" | "type">
): string {
  const year = (item.year ?? "").toLowerCase();
  return `${item.title.toLowerCase().trim()}|${year}|${item.type}`;
}

async function updateBadge(count: number): Promise<void> {
  const text = count > 0 ? String(count) : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#4285F4" });
}

export async function initBadge(): Promise<void> {
  const items = await getAllItems();
  await updateBadge(items.length);
}
