import {
  letterboxdSlugFromUrl,
  parseLetterboxdPage,
} from "../shared/letterboxd.js";
import type { ParsedMedia } from "../shared/types.js";

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentParsed: ParsedMedia | null = null;

function check(): void {
  currentParsed = parseLetterboxdPage(document);
}

export function getReadyToSave() {
  if (!currentParsed) return null;
  return {
    ...currentParsed,
    googleQuery: letterboxdSlugFromUrl(location.href) ?? currentParsed.title,
    sourceUrl: location.href.split("?")[0],
  };
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
}
