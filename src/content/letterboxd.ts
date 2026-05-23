import {
  letterboxdSlugFromUrl,
  parseLetterboxdPage,
} from "../shared/letterboxd.js";
import { handleKeepSyncResult, showSavedToast } from "./keep-feedback.js";
import { sendToBackground } from "../shared/messaging.js";
import { previewLabel, removeSaveButton, showSaveButton, showToast } from "./ui.js";
import type { ParsedMedia } from "../shared/types.js";

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentParsed: ParsedMedia | null = null;

function check(): void {
  const parsed = parseLetterboxdPage(document);
  currentParsed = parsed;
  if (!parsed) {
    removeSaveButton();
    return;
  }
  showSaveButton(handleSave);
}

async function handleSave(): Promise<void> {
  if (!currentParsed) {
    showToast("Film details not loaded yet. Wait for the page.", "error");
    return;
  }

  const slug = letterboxdSlugFromUrl(location.href);
  let response;
  try {
    response = await sendToBackground({
      action: "save",
      item: {
        ...currentParsed,
        googleQuery: slug ?? currentParsed.title,
        sourceUrl: location.href.split("?")[0],
      },
    });
  } catch (err) {
    showToast(
      err instanceof Error ? err.message : "KeepShelf is not connected.",
      "error"
    );
    return;
  }

  if (!response?.ok) {
    showToast(response?.error ?? "Failed to save.", "error");
    return;
  }

  showSavedToast(currentParsed, Boolean(response.duplicate), previewLabel(currentParsed));
  await handleKeepSyncResult(response.keep);
}

export function initLetterboxd(): void {
  check();

  observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(check, 400);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function teardownLetterboxd(): void {
  observer?.disconnect();
  observer = null;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  currentParsed = null;
  removeSaveButton();
}
