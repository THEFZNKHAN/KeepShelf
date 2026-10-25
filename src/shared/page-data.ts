import type { SavedItem } from "./types.js";

export type PageDataResponse = { item: Omit<SavedItem, "id" | "savedAt"> | null } | undefined;

/** Asks the tab's content script what it can save, injecting the script first if the page doesn't have one. */
export async function requestPageData(tabId: number, inject = true): Promise<PageDataResponse> {
  try {
    return await chrome.tabs.sendMessage(tabId, { action: "getPageData" });
  } catch (err) {
    if (!inject) throw err;
    // Chrome only injects content scripts on full page loads, so pages reached by in-app navigation lack one.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["dist/content.js"] });
    return await chrome.tabs.sendMessage(tabId, { action: "getPageData" });
  }
}
