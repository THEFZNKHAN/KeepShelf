import { startDetector, stopDetector } from "./detector.js";
import { handleKeepSyncResult, showSavedToast } from "./keep-feedback.js";
import { sendToBackground } from "../shared/messaging.js";
import { previewLabel, removeSaveButton, showSaveButton, showToast } from "./ui.js";
import type { ParsedMedia } from "../shared/types.js";

let currentParsed: ParsedMedia | null = null;

function getGoogleQuery(): string {
  return new URL(location.href).searchParams.get("q") ?? "";
}

function handleDetected(parsed: ParsedMedia | null): void {
  currentParsed = parsed;
  if (!parsed) {
    removeSaveButton();
    return;
  }
  showSaveButton(handleSave);
}

async function handleSave(): Promise<void> {
  if (!currentParsed) {
    showToast("No media panel found. Try a more specific search.", "error");
    return;
  }

  let response;
  try {
    response = await sendToBackground({
      action: "save",
      item: {
        ...currentParsed,
        googleQuery: getGoogleQuery(),
        sourceUrl: location.href,
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

export function initGoogle(): void {
  startDetector(handleDetected);

  window.addEventListener("popstate", () => {
    currentParsed = null;
    removeSaveButton();
    stopDetector();
    startDetector(handleDetected);
  });
}

export function teardownGoogle(): void {
  stopDetector();
  currentParsed = null;
  removeSaveButton();
}
