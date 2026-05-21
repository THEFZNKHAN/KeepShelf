import {
  parseSeriesGraphPage,
  isSeriesGraphChartReady,
  seriesGraphQueryFromUrl,
} from "../shared/seriesgraph.js";
import { handleKeepSyncResult, showSavedToast } from "./keep-feedback.js";
import { sendToBackground } from "../shared/messaging.js";
import { previewLabel, removeSaveButton, showSaveButton, showToast } from "./ui.js";
import type { ParsedMedia } from "../shared/types.js";

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentParsed: ParsedMedia | null = null;
let chartWaitStartedAt: number | null = null;

const CHART_WAIT_MS = 15000;

function check(): void {
  const parsed = parseSeriesGraphPage(document);
  if (!parsed) {
    chartWaitStartedAt = null;
    currentParsed = null;
    removeSaveButton();
    return;
  }

  const chartReady =
    Boolean(parsed.durationOrSeasons) || isSeriesGraphChartReady(document);

  if (!chartReady) {
    if (chartWaitStartedAt === null) chartWaitStartedAt = Date.now();
    if (Date.now() - chartWaitStartedAt < CHART_WAIT_MS) {
      removeSaveButton();
      return;
    }
  } else {
    chartWaitStartedAt = null;
  }

  currentParsed = parsed;
  showSaveButton(handleSave);
}

async function handleSave(): Promise<void> {
  if (!currentParsed) {
    showToast("Show details not loaded yet. Wait for the chart.", "error");
    return;
  }

  let response;
  try {
    response = await sendToBackground({
      action: "save",
      item: {
        ...currentParsed,
        googleQuery:
          seriesGraphQueryFromUrl(location.href) || currentParsed.title,
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

export function initSeriesGraph(): void {
  check();

  observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(check, 400);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function teardownSeriesGraph(): void {
  observer?.disconnect();
  observer = null;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  currentParsed = null;
  chartWaitStartedAt = null;
  removeSaveButton();
}
