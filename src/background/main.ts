import { saveItem, getAllItems, deleteItems, clearAll } from "../shared/storage.js";
import {
  getKeepSettings,
  setKeepSettings,
} from "../shared/keep-settings.js";
import { syncItemToKeep, testKeepAppend, getLastKeepResult } from "../shared/keep-sync.js";
import type { MessageAction, MessageResponse } from "../shared/types.js";

chrome.runtime.onMessage.addListener(
  (
    message: MessageAction,
    _sender,
    sendResponse: (response: MessageResponse) => void
  ) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err: Error) =>
        sendResponse({ ok: false, error: err.message ?? "Unknown error" })
      );
    return true;
  }
);

async function handleMessage(message: MessageAction): Promise<MessageResponse> {
  switch (message.action) {
    case "save": {
      const { item, duplicate } = await saveItem(message.item);
      const keep = await syncItemToKeep(item);
      return { ok: true, item, duplicate, keep };
    }
    case "saveTab": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (
        !tab?.url ||
        tab.url.startsWith("chrome://") ||
        tab.url.startsWith("chrome-extension://") ||
        tab.url.startsWith("edge://") ||
        tab.url.startsWith("about:")
      ) {
        return { ok: false, error: "Cannot save this page. Open a regular website first." };
      }
      const title = tab.title?.trim() || "Untitled tab";
      const { item, duplicate } = await saveItem({
        type: "tab",
        title,
        url: tab.url,
        sourceUrl: tab.url,
        googleQuery: tab.url,
        subtitle: tab.url,
      });
      const keep = await syncItemToKeep(item);
      return { ok: true, item, duplicate, keep };
    }
    case "getAll": {
      const items = await getAllItems();
      return { ok: true, items };
    }
    case "delete": {
      const items = await deleteItems(message.ids);
      return { ok: true, items };
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
      return { ok: true, lastKeepResult };
    }
    default:
      return { ok: false, error: "Unknown action" };
  }
}
