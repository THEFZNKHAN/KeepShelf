import {
  saveItem,
  getAllItems,
  deleteItems,
  clearAll,
  updateItem,
  importItems,
  mergeItems,
  restoreItems,
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
import type { EditableFields, MessageAction, MessageResponse, SavedItem, UserFields } from "../shared/types.js";
import { isBookInfoEnabled, setBookInfoEnabled } from "../shared/book-info-settings.js";
import { OpenLibraryError, createOpenLibraryClient, isBookItem, lookupBook } from "../shared/openlibrary.js";
import { getTmdbAuth, setTmdbToken } from "../shared/tmdb-settings.js";
import {
  TmdbError,
  createTmdbClient,
  fetchDetails,
  isEnrichable,
  isStale,
  lacksSeasons,
  lookupInfo,
  mustPurge,
  parseTmdbToken,
} from "../shared/tmdb.js";
import { findNearDuplicates } from "../shared/fuzzy.js";
import { buildUserPatch } from "../shared/user-data.js";
import { flashBadge, startBadgeUpdates } from "./badge.js";

// Storage writes are read-modify-write and Keep sync drives a single tab, so these must not overlap.
const SERIAL_ACTIONS = new Set<MessageAction["action"]>([
  "save",
  "saveTab",
  "delete",
  "update",
  "syncKeep",
  "import",
  "merge",
  "restore",
  "setTmdbToken",
  "setBookInfoEnabled",
  "enrichBooks",
  "removeBookMatch",
  "enrich",
  "removeTmdbMatch",
  "refreshStaleTmdb",
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

async function tmdbClient() {
  const auth = await getTmdbAuth();
  return auth ? createTmdbClient(auth) : undefined;
}

/** Best-effort TMDB lookup after a save. A failure never blocks the save or the Keep sync. */
async function enrichQuietly(item: SavedItem): Promise<SavedItem> {
  if (!isEnrichable(item) || item.tmdb || item.tmdbOptOut) return item;
  try {
    const client = await tmdbClient();
    if (!client) return item;
    const info = await lookupInfo(client, item);
    if (!info) return item;
    const items = await updateItem(item.id, { tmdb: info });
    return items.find((i) => i.id === item.id) ?? item;
  } catch {
    /* offline, rate limited or a bad token: the item is still saved */
    return item;
  }
}

// One client for the life of the worker, because it remembers when the last request went out
// and keeps every Open Library request at least a second apart.
let openLibraryClient: ReturnType<typeof createOpenLibraryClient> | undefined;
function bookClient() {
  return (openLibraryClient ??= createOpenLibraryClient());
}

/** Best-effort Open Library lookup after a save, only when the user has turned book info on. */
async function enrichBookQuietly(item: SavedItem): Promise<SavedItem> {
  if (!isBookItem(item) || item.bookInfo || item.bookInfoOptOut) return item;
  try {
    if (!(await isBookInfoEnabled())) return item;
    const info = await lookupBook(bookClient(), item);
    if (!info) return item;
    const items = await updateItem(item.id, { bookInfo: info });
    return items.find((i) => i.id === item.id) ?? item;
  } catch {
    /* offline or rate limited: the book is still saved */
    return item;
  }
}

async function enrichBooks(ids: string[], force: boolean): Promise<MessageResponse> {
  if (!(await isBookInfoEnabled())) return { ok: false, error: "Turn on book info in Settings first." };
  let enriched = 0;
  let unmatched = 0;
  let failed = 0;
  for (const id of ids) {
    const item = (await getAllItems()).find((i) => i.id === id);
    if (!item || !isBookItem(item)) continue;
    if (item.bookInfo && !force) continue;
    try {
      const info = await lookupBook(bookClient(), item);
      if (info) {
        await updateItem(id, { bookInfo: info, bookInfoOptOut: undefined });
        enriched++;
      } else {
        unmatched++;
      }
    } catch (err) {
      // Being rate limited fails every remaining book the same way, so stop.
      if (err instanceof OpenLibraryError && (err.status === 429 || err.status === 403)) {
        return { ok: false, error: err.message };
      }
      failed++;
    }
  }
  return { ok: true, items: await getAllItems(), enriched, unmatched, failed };
}

async function enrichItems(ids: string[], force: boolean): Promise<MessageResponse> {
  const client = await tmdbClient();
  if (!client) return { ok: false, error: "Add your TMDB token in Settings first." };
  let enriched = 0;
  let unmatched = 0;
  let failed = 0;
  for (const id of ids) {
    const item = (await getAllItems()).find((i) => i.id === id);
    if (!item || !isEnrichable(item)) continue;
    if (item.tmdb && !force) continue;
    try {
      const info = item.tmdb && force ? await fetchDetails(client, item.tmdb.kind, item.tmdb.id) : await lookupInfo(client, item);
      if (info) {
        await updateItem(id, { tmdb: info, tmdbOptOut: undefined });
        enriched++;
      } else {
        unmatched++;
      }
    } catch (err) {
      // A rejected token or rate limit will fail every remaining item the same way, so stop.
      if (err instanceof TmdbError && (err.status === 401 || err.status === 429)) {
        return { ok: false, error: err.message };
      }
      failed++;
    }
  }
  return { ok: true, items: await getAllItems(), enriched, unmatched, failed };
}

/** TMDB data may only be cached for six months: refresh it when old, and drop it if it can't be refreshed in time. */
async function refreshStaleTmdb(): Promise<SavedItem[]> {
  const now = Date.now();
  const client = await tmdbClient();
  for (const item of await getAllItems()) {
    const info = item.tmdb;
    if (!info || !(isStale(info, now) || lacksSeasons(info))) continue;
    try {
      if (!client) throw new Error("no token");
      await updateItem(item.id, { tmdb: await fetchDetails(client, info.kind, info.id, now) });
    } catch {
      if (mustPurge(info, now)) await updateItem(item.id, { tmdb: undefined });
    }
  }
  return getAllItems();
}

async function saveAndSync(partial: NewItem) {
  const similar = findNearDuplicates(partial, await getAllItems()).map((i) => i.title);
  const { item, duplicate } = await saveItem(partial);
  // Keep gets the enriched item, so a runtime or episode count found on TMDB lands in the Keep line too.
  const saved = duplicate ? item : await enrichBookQuietly(await enrichQuietly(item));
  const keep = await syncAndRecord(saved);
  return { ok: true as const, item: saved, duplicate, keep, ...(!duplicate && similar.length ? { similar } : {}) };
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
  changes: EditableFields & UserFields & { done?: boolean }
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
  return { ...patch, ...buildUserPatch(item, changes) };
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
    case "merge": {
      const items = await mergeItems(message.keepId, message.removeIds);
      return { ok: true, items };
    }
    case "restore": {
      const items = await restoreItems(message.items);
      return { ok: true, items };
    }
    case "getBookInfoSettings": {
      return { ok: true, bookInfo: { enabled: await isBookInfoEnabled() } };
    }
    case "setBookInfoEnabled": {
      return { ok: true, bookInfo: { enabled: await setBookInfoEnabled(message.enabled) } };
    }
    case "enrichBooks": {
      const ids = message.ids ?? (await getAllItems()).filter((i) => isBookItem(i) && !i.bookInfo && !i.bookInfoOptOut).map((i) => i.id);
      return enrichBooks(ids, Boolean(message.force));
    }
    case "removeBookMatch": {
      const items = await updateItem(message.id, { bookInfo: undefined, bookInfoOptOut: true });
      return { ok: true, items };
    }
    case "getTmdbSettings": {
      return { ok: true, tmdb: { configured: Boolean(await getTmdbAuth()) } };
    }
    case "setTmdbToken": {
      const configured = await setTmdbToken(message.token);
      return { ok: true, tmdb: { configured } };
    }
    case "testTmdb": {
      const auth = message.token?.trim() ? parseTmdbToken(message.token) : await getTmdbAuth();
      if (!auth) return { ok: false, error: message.token?.trim() ? "That doesn't look like a TMDB token." : "No TMDB token saved yet." };
      try {
        await createTmdbClient(auth).get("/configuration");
        return { ok: true, message: "Connected to TMDB." };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Could not reach TMDB." };
      }
    }
    case "enrich": {
      const ids = message.ids ?? (await getAllItems()).filter((i) => isEnrichable(i) && !i.tmdb && !i.tmdbOptOut).map((i) => i.id);
      return enrichItems(ids, Boolean(message.force));
    }
    case "removeTmdbMatch": {
      const items = await updateItem(message.id, { tmdb: undefined, tmdbOptOut: true });
      return { ok: true, items };
    }
    case "refreshStaleTmdb": {
      return { ok: true, items: await refreshStaleTmdb() };
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

chrome.runtime.onStartup.addListener(() => {
  void runSerial(refreshStaleTmdb).catch(() => undefined);
});

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
  const similar = "similar" in response ? response.similar?.[0] : undefined;
  const base =
    "duplicate" in response && response.duplicate ? "Already saved" : similar ? `Saved (similar to "${similar}")` : "Saved";
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
