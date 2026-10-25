import { requestPageData } from "../shared/page-data.js";
import { dedupeKey, getAllItems, normalizeUrl } from "../shared/storage.js";

type BadgeState = "saved" | "available" | "none";

const BADGES: Record<BadgeState, { text: string; color: string; title: string }> = {
  saved: { text: "✓", color: "#1a5d38", title: "KeepShelf: already on your shelf" },
  available: { text: "+", color: "#000000", title: "KeepShelf: this page can be saved" },
  none: { text: "", color: "#000000", title: "KeepShelf" },
};

async function badgeStateFor(tab: chrome.tabs.Tab): Promise<BadgeState> {
  if (!tab.id || !tab.url || !/^https?:/.test(tab.url)) return "none";
  const items = await getAllItems();

  // Only pages that already have the content script; never inject just to draw the badge.
  const data = await requestPageData(tab.id, false).catch(() => undefined);
  if (data?.item) {
    const key = dedupeKey(data.item);
    return items.some((i) => dedupeKey(i) === key) ? "saved" : "available";
  }

  const url = normalizeUrl(tab.url);
  const savedAsTab = items.some(
    (i) => (i.type === "tab" || i.type === "link") && i.url && normalizeUrl(i.url) === url
  );
  return savedAsTab ? "saved" : "none";
}

async function applyBadge(tabId: number, state: BadgeState): Promise<void> {
  const badge = BADGES[state];
  try {
    await chrome.action.setBadgeText({ tabId, text: badge.text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
    await chrome.action.setTitle({ tabId, title: badge.title });
  } catch {
    /* tab closed */
  }
}

export async function refreshBadge(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    await applyBadge(tabId, await badgeStateFor(tab));
  } catch {
    /* tab closed */
  }
}

export async function refreshActiveBadge(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await refreshBadge(tab.id);
}

/** Briefly shows the result of a shortcut or right-click save, then returns to the normal badge. */
export async function flashBadge(tabId: number, ok: boolean, message: string): Promise<void> {
  try {
    await chrome.action.setBadgeText({ tabId, text: ok ? "✓" : "!" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: ok ? "#1a5d38" : "#ba1a1a" });
    await chrome.action.setTitle({ tabId, title: `KeepShelf: ${message}` });
  } catch {
    return;
  }
  setTimeout(() => void refreshBadge(tabId), 4000);
}

export function startBadgeUpdates(itemsStorageKey: string): void {
  chrome.tabs.onActivated.addListener(({ tabId }) => void refreshBadge(tabId));

  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!tab.active) return;
    if (info.status === "complete" || info.url) {
      // Content scripts run at document_idle, slightly after the tab reports complete.
      setTimeout(() => void refreshBadge(tabId), 1200);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && itemsStorageKey in changes) void refreshActiveBadge();
  });
}
