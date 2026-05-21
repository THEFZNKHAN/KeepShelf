import { formatItemLine } from "./format.js";
import {
  getKeepSettings,
  getKeepTargetForItem,
  isLikelyValidKeepNoteId,
  missingKeepConfigMessage,
  type KeepSyncResult,
  type KeepTarget,
} from "./keep-settings.js";
import type { SavedItem } from "./types.js";
import { keepPageAction } from "./keep-append-page.js";
import { trustedInsertTextInKeep } from "./keep-debugger.js";

export type { KeepSyncResult } from "./keep-settings.js";

const LAST_RESULT_KEY = "trackbuddy_keep_last_result";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function storeLastResult(message: string, isError = false): Promise<void> {
  await chrome.storage.local.set({
    [LAST_RESULT_KEY]: { message, isError, at: Date.now() },
  });
}

function waitForTabComplete(tabId: number, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Keep note tab timed out."));
    }, timeoutMs);

    function listener(
      updatedTabId: number,
      info: chrome.tabs.TabChangeInfo
    ): void {
      if (updatedTabId === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (tab.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

async function findKeepTab(noteId: string): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ url: "https://keep.google.com/*" });
  return tabs.find(
    (tab) =>
      tab.url?.includes(`NOTE/${noteId}`) ||
      tab.url?.includes(`LIST/${noteId}`) ||
      tab.url?.includes(noteId)
  );
}

async function ensureKeepTab(
  noteId: string,
  noteUrl: string
): Promise<{ tabId: number; restoreTabId?: number }> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const restoreTabId = activeTab?.id;

  const existing = await findKeepTab(noteId);

  if (existing?.id) {
    if (!existing.url?.includes(noteId)) {
      await chrome.tabs.update(existing.id, { url: noteUrl, active: false });
      await waitForTabComplete(existing.id);
      await sleep(2000);
    } else {
      await sleep(500);
    }
    return { tabId: existing.id, restoreTabId };
  }

  const keepTabs = await chrome.tabs.query({ url: "https://keep.google.com/*" });
  const tab = keepTabs[0];

  if (tab?.id) {
    await chrome.tabs.update(tab.id, { url: noteUrl, active: false });
    await waitForTabComplete(tab.id);
    await sleep(2000);
    return { tabId: tab.id, restoreTabId };
  }

  const created = await chrome.tabs.create({
    url: noteUrl,
    active: false,
  });
  if (!created.id) {
    throw new Error("Could not open Keep note tab.");
  }
  await waitForTabComplete(created.id);
  await sleep(2000);
  return { tabId: created.id, restoreTabId };
}

async function restoreActiveTab(tabId: number | undefined): Promise<void> {
  if (!tabId) return;
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    /* tab may have been closed */
  }
}

async function injectAppend(
  tabId: number,
  noteId: string,
  text: string
): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {
  if (!isLikelyValidKeepNoteId(noteId)) {
    return {
      ok: false,
      error: "Keep URL looks incomplete. Copy the full link from your browser address bar.",
    };
  }

  try {
    const [{ result: prep }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: keepPageAction,
      args: ["prepare", noteId, text, ""],
    });

    const prepare = prep as {
      ok: boolean;
      duplicate?: boolean;
      error?: string;
      editedBefore?: string;
    };

    if (!prepare?.ok) {
      return {
        ok: false,
        error: prepare?.error ?? "Could not prepare Keep list field.",
      };
    }

    if (prepare.duplicate) {
      return { ok: true, duplicate: true };
    }

    await trustedInsertTextInKeep(tabId, text);

    const [{ result: committed }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: keepPageAction,
      args: ["commit", noteId, text, ""],
    });

    const commit = committed as { ok: boolean; error?: string };
    if (!commit?.ok) {
      return {
        ok: false,
        error: commit?.error ?? "Could not commit Keep list item.",
      };
    }

    const [{ result: verified }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: keepPageAction,
      args: ["verify", noteId, text, prepare.editedBefore ?? ""],
    });

    if (verified && typeof verified === "object" && "ok" in verified) {
      return verified as { ok: boolean; duplicate?: boolean; error?: string };
    }

    return { ok: false, error: "Keep returned an unexpected response." };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not run Keep script.",
    };
  }
}

export async function appendToKeepList(options: {
  noteId: string;
  noteUrl: string;
  text: string;
}): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {
  const { tabId, restoreTabId } = await ensureKeepTab(
    options.noteId,
    options.noteUrl
  );
  try {
    return await injectAppend(tabId, options.noteId, options.text);
  } finally {
    await restoreActiveTab(restoreTabId);
  }
}

async function publishKeepResult(result: KeepSyncResult): Promise<void> {
  if (result.status === "synced") {
    const label = result.target === "books" ? "Books" : "Media";
    await storeLastResult(`Added to Keep (${label})`, false);
    return;
  }
  if (result.status === "duplicate") {
    await storeLastResult("Already in your Keep list.", false);
    return;
  }
  if (result.status === "failed") {
    await storeLastResult(result.error ?? "Could not add to Keep.", true);
  }
  if (result.status === "missing_config") {
    await storeLastResult(
      result.error ?? "Link your Keep note in Settings.",
      true
    );
  }
}

export async function getLastKeepResult(): Promise<{
  message: string;
  isError: boolean;
  at: number;
} | null> {
  const data = await chrome.storage.local.get(LAST_RESULT_KEY);
  const raw = data[LAST_RESULT_KEY] as
    | { message: string; isError: boolean; at: number }
    | undefined;
  return raw ?? null;
}

export async function syncItemToKeep(
  item: SavedItem
): Promise<KeepSyncResult> {
  const settings = await getKeepSettings();
  if (!settings.enabled) {
    return { status: "disabled" };
  }

  const target = getKeepTargetForItem(item, settings);
  if (!target) {
    const keepTarget: KeepTarget = item.type === "book" ? "books" : "media";
    return {
      status: "missing_config",
      target: keepTarget,
      error: missingKeepConfigMessage(keepTarget),
    };
  }

  const text = formatItemLine(item);
  const result = await appendToKeepList({
    noteId: target.noteId,
    noteUrl: target.noteUrl,
    text,
  });

  let keepResult: KeepSyncResult;
  if (result.ok && result.duplicate) {
    keepResult = { status: "duplicate", target: target.target, text };
  } else if (result.ok) {
    keepResult = { status: "synced", target: target.target, text };
  } else {
    keepResult = {
      status: "failed",
      target: target.target,
      text,
      noteUrl: target.noteUrl,
      error: result.error ?? "Could not append to Keep.",
    };
  }

  await publishKeepResult(keepResult);
  return keepResult;
}

export async function testKeepAppend(
  target: KeepTarget
): Promise<KeepSyncResult> {
  const settings = await getKeepSettings();
  const noteTarget =
    target === "books"
      ? getKeepTargetForItem({ type: "book" }, settings)
      : getKeepTargetForItem({ type: "movie" }, settings);

  if (!noteTarget) {
    return {
      status: "missing_config",
      target,
      error: missingKeepConfigMessage(target),
    };
  }

  const sample =
    target === "books"
      ? "KeepShelf test | Sample Book | Author | 2026"
      : "KeepShelf test | Sample Movie (2026) | Drama | IMDb 8.0";

  await storeLastResult("Adding test line to Keep…", false);

  const result = await appendToKeepList({
    noteId: noteTarget.noteId,
    noteUrl: noteTarget.noteUrl,
    text: sample,
  });

  let keepResult: KeepSyncResult;
  if (result.ok && result.duplicate) {
    keepResult = { status: "duplicate", target, text: sample };
  } else if (result.ok) {
    keepResult = { status: "synced", target, text: sample };
  } else {
    keepResult = {
      status: "failed",
      target,
      text: sample,
      noteUrl: noteTarget.noteUrl,
      error: result.error ?? "Could not append to Keep.",
    };
  }

  await publishKeepResult(keepResult);
  return keepResult;
}
