import {
  parseSeriesGraphPage,
  isSeriesGraphChartReady,
  seriesGraphQueryFromUrl,
} from "../shared/seriesgraph.js";
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
    return;
  }

  const chartReady =
    Boolean(parsed.durationOrSeasons) || isSeriesGraphChartReady(document);

  if (!chartReady) {
    if (chartWaitStartedAt === null) chartWaitStartedAt = Date.now();
    if (Date.now() - chartWaitStartedAt < CHART_WAIT_MS) {
      return;
    }
  } else {
    chartWaitStartedAt = null;
  }

  currentParsed = parsed;
}

export function getReadyToSave() {
  if (!currentParsed) return null;
  return {
    ...currentParsed,
    googleQuery: seriesGraphQueryFromUrl(location.href) || currentParsed.title,
    sourceUrl: location.href,
  };
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
}
