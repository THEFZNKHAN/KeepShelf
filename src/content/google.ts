import { startDetector, stopDetector } from "./detector.js";
import type { ParsedMedia } from "../shared/types.js";

let currentParsed: ParsedMedia | null = null;

function getGoogleQuery(): string {
  return new URL(location.href).searchParams.get("q") ?? "";
}

function handleDetected(parsed: ParsedMedia | null): void {
  currentParsed = parsed;
}

export function getReadyToSave() {
  if (!currentParsed) return null;
  return {
    ...currentParsed,
    googleQuery: getGoogleQuery(),
    sourceUrl: location.href,
  };
}

export function initGoogle(): void {
  startDetector(handleDetected);

  window.addEventListener("popstate", () => {
    currentParsed = null;
    stopDetector();
    startDetector(handleDetected);
  });
}

export function teardownGoogle(): void {
  stopDetector();
  currentParsed = null;
}
