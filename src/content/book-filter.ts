import {
  bookFilterSlugFromUrl,
  parseBookFilterPage,
} from "../shared/book-filter.js";
import type { ParsedMedia } from "../shared/types.js";

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentParsed: ParsedMedia | null = null;

function check(): void {
  currentParsed = parseBookFilterPage(document);
}

export function getReadyToSave() {
  if (!currentParsed) return null;
  return {
    ...currentParsed,
    googleQuery: bookFilterSlugFromUrl(location.href) ?? currentParsed.title,
    sourceUrl: location.href.split("?")[0],
  };
}

export function initBookFilter(): void {
  check();

  observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(check, 400);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function teardownBookFilter(): void {
  observer?.disconnect();
  observer = null;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  currentParsed = null;
}
