import {
  saveItem,
  getAllItems,
  deleteItems,
  clearAll,
  updateItem,
  importItems,
  STORAGE_KEY,
} from "../shared/storage.js";
import {
  getKeepSettings,
  setKeepSettings,
} from "../shared/keep-settings.js";
import { syncItemToKeep, testKeepAppend, getLastKeepResult, clearLastKeepResult } from "../shared/keep-sync.js";
import type { KeepSyncResult } from "../shared/keep-settings.js";
import { isHttpUrl, isSaveableTabUrl, linkItem, noteItem, tabItem, type NewItem } from "../shared/items.js";
import { requestPageData } from "../shared/page-data.js";
import type { EditableFields, MessageAction, MessageResponse, SavedItem } from "../shared/types.js";
import { flashBadge, startBadgeUpdates } from "./badge.js";

// Storage writes are read-modify-write and Keep sync drives a single tab, so these must not overlap.
const SERIAL_ACTIONS = new Set<MessageAction["action"]>([
  "save",
  "saveTab",
  "delete",
  "update",
  "syncKeep",
  "import",
  "clear",
  "setKeepSettings",
  "testKeepAppend",
]);

let queue: Promise<unknown> = Promise.resolve();

function runSerial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

chrome.runtime.onMessage.addListener(
  (
    message: MessageAction,
    _sender,
    sendResponse: (response: MessageResponse) => void
  ) => {
    const task = () => handleMessage(message);
    (SERIAL_ACTIONS.has(message.action) ? runSerial(task) : task())
      .then(sendResponse)
      .catch((err: Error) =>
        sendResponse({ ok: false, error: err.message ?? "Unknown error" })
      );
    return true;
  }
);

async function syncAndRecord(item: SavedItem): Promise<KeepSyncResult> {
  const keep = await syncItemToKeep(item);
  await updateItem(item.id, { keepStatus: keep.status, keepError: keep.error });
  return keep;
}

async function saveAndSync(partial: NewItem) {
  const { item, duplicate } = await saveItem(partial);
  const keep = await syncAndRecord(item);
  return { ok: true as const, item, duplicate, keep };
}

async function saveTab(tab: chrome.tabs.Tab | undefined): Promise<MessageResponse> {
  if (!isSaveableTabUrl(tab?.url)) {
    return { ok: false, error: "Cannot save this page. Open a regular website first." };
  }
  return saveAndSync(tabItem(tab.title, tab.url));
}

const EDITABLE_KEYS: Array<keyof EditableFields> = [
  "title",
  "year",
  "durationOrSeasons",
  "imdbRating",
  "author",
  "publishedYear",
  "url",
  "body",
];

function cleanChanges(
  item: SavedItem,
  changes: EditableFields & { done?: boolean }
): Partial<SavedItem> {
  const patch: Partial<SavedItem> = {};
  for (const key of EDITABLE_KEYS) {
    if (!(key in changes)) continue;
    const value = changes[key]?.trim();
    patch[key] = value || undefined;
  }
  if ("title" in patch && !patch.title) throw new Error("Title can't be empty.");
  if (patch.url && !isHttpUrl(patch.url)) throw new Error("Enter a full http(s) URL.");
  if ((item.type === "tab" || item.type === "link") && "url" in patch && !patch.url) {
    throw new Error("URL can't be empty.");
  }
  if (item.type === "note" && patch.body) {
    patch.title = noteItem(patch.body).title;
  }
  if (typeof changes.done === "boolean") {
    patch.done = changes.done;
    patch.doneAt = changes.done ? Date.now() : undefined;
  }
  return patch;
}

async function handleMessage(message: MessageAction): Promise<MessageResponse> {
  switch (message.action) {
    case "save":
      return saveAndSync(message.item);
    case "saveTab": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return saveTab(tab);
    }
    case "getAll": {
      const items = await getAllItems();
      return { ok: true, items };
    }
    case "delete": {
      const items = await deleteItems(message.ids);
      return { ok: true, items };
    }
    case "update": {
      const item = (await getAllItems()).find((i) => i.id === message.id);
      if (!item) return { ok: false, error: "That item no longer exists." };
      const items = await updateItem(message.id, cleanChanges(item, message.changes));
      return { ok: true, items };
    }
    case "syncKeep": {
      let synced = 0;
      let failed = 0;
      for (const id of message.ids) {
        const item = (await getAllItems()).find((i) => i.id === id);
        if (!item) continue;
        const keep = await syncAndRecord(item);
        if (keep.status === "synced" || keep.status === "duplicate") synced++;
        else failed++;
      }
      return { ok: true, items: await getAllItems(), synced, failed };
    }
    case "import": {
      const { items, added, skipped } = await importItems(message.items);
      return { ok: true, items, added, skipped };
    }
    case "clear": {
      await clearAll();
      return { ok: true, items: [] };
    }
    case "getKeepSettings": {
      const settings = await getKeepSettings();
      return { ok: true, settings };
    }
    case "setKeepSettings": {
      const settings = await setKeepSettings(message.settings);
      return { ok: true, settings };
    }
    case "testKeepAppend": {
      const keep = await testKeepAppend(message.target);
      return { ok: true, keep };
    }
    case "getLastKeepResult": {
      const lastKeepResult = await getLastKeepResult();
      await clearLastKeepResult();
      return { ok: true, lastKeepResult };
    }
    default:
      return { ok: false, error: "Unknown action" };
  }
}

/* ── Quick save: keyboard shortcut and right-click menu ─────────────── */

const MENU_SAVE_PAGE = "keepshelf-save-page";
const MENU_SAVE_LINK = "keepshelf-save-link";
const MENU_SAVE_NOTE = "keepshelf-save-note";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_SAVE_PAGE, title: "Save page to KeepShelf", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU_SAVE_LINK, title: "Save link to KeepShelf", contexts: ["link"] });
    chrome.contextMenus.create({ id: MENU_SAVE_NOTE, title: "Save selection to KeepShelf as a note", contexts: ["selection"] });
  });
});

/** Saves what the page is about (movie, book…) when detected, otherwise the tab itself. */
async function savePageFromTab(tab: chrome.tabs.Tab): Promise<MessageResponse> {
  const data = tab.id ? await requestPageData(tab.id).catch(() => undefined) : undefined;
  if (data?.item) return saveAndSync(data.item);
  return saveTab(tab);
}

function describeQuickSave(response: MessageResponse): { ok: boolean; message: string } {
  if (!response.ok) return { ok: false, message: response.error };
  if (!("keep" in response)) return { ok: true, message: "Saved" };
  const base = "duplicate" in response && response.duplicate ? "Already saved" : "Saved";
  const keep = response.keep;
  if (keep?.status === "failed" || keep?.status === "missing_config") {
    return { ok: false, message: `${base}, but not added to Keep: ${keep.error ?? "unknown error"}` };
  }
  return { ok: true, message: keep?.status === "synced" ? `${base}, added to Keep` : base };
}

async function quickSave(tab: chrome.tabs.Tab | undefined, save: () => Promise<MessageResponse>): Promise<void> {
  const response = await runSerial(save).catch(
    (err: Error): MessageResponse => ({ ok: false, error: err.message ?? "Could not save." })
  );
  const { ok, message } = describeQuickSave(response);
  if (tab?.id) await flashBadge(tab.id, ok, message);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_SAVE_PAGE && tab) {
    void quickSave(tab, () => savePageFromTab(tab));
  } else if (info.menuItemId === MENU_SAVE_LINK && info.linkUrl) {
    const url = info.linkUrl;
    void quickSave(tab, async () =>
      isHttpUrl(url) ? saveAndSync(linkItem(url)) : { ok: false, error: "Only http(s) links can be saved." }
    );
  } else if (info.menuItemId === MENU_SAVE_NOTE && info.selectionText?.trim()) {
    const text = info.selectionText.trim();
    void quickSave(tab, () => saveAndSync(noteItem(text)));
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "save-page") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) void quickSave(tab, () => savePageFromTab(tab));
});

startBadgeUpdates(STORAGE_KEY);
