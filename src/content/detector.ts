import {
  findKnowledgePanelRoot,
  parseKnowledgePanel,
} from "../shared/parser.js";
import type { ParsedMedia } from "../shared/types.js";

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function startDetector(onDetected: (parsed: ParsedMedia | null) => void): void {
  stopDetector();
  check(onDetected);

  observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => check(onDetected), 400);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

export function stopDetector(): void {
  observer?.disconnect();
  observer = null;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
}

function check(onDetected: (parsed: ParsedMedia | null) => void): void {
  const panel = findKnowledgePanelRoot(document);
  if (!panel) {
    onDetected(null);
    return;
  }
  const parsed = parseKnowledgePanel(panel, document);
  onDetected(parsed);
}
