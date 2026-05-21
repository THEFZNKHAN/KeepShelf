import type { KeepSyncResult } from "../shared/keep-settings.js";
import { missingKeepConfigMessage } from "../shared/keep-settings.js";
import type { ParsedMedia } from "../shared/types.js";
import { showToast } from "./ui.js";

function typeLabel(type: ParsedMedia["type"]): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export async function handleKeepSyncResult(
  keep: KeepSyncResult | undefined
): Promise<void> {
  if (!keep || keep.status === "disabled") {
    return;
  }

  if (keep.status === "duplicate") {
    return;
  }

  if (keep.status === "missing_config") {
    showToast({
      title: keep.error ?? missingKeepConfigMessage(keep.target!),
      variant: "info",
    });
    return;
  }

  if (keep.status === "synced") {
    const label = keep.target === "books" ? "Books list" : "Media list";
    showToast({
      title: `Added to Keep (${label})`,
      subtitle: "Synced to Google Keep",
      variant: "success",
    });
    return;
  }

  if (keep.status === "failed" && keep.text) {
    try {
      await navigator.clipboard.writeText(keep.text);
      showToast({
        title: keep.error ? `Keep: ${keep.error}` : "Could not add to Keep.",
        subtitle: "Line copied. Paste it manually.",
        variant: "info",
        durationMs: 6000,
      });
    } catch {
      showToast({
        title: keep.error ?? "Could not add to Keep.",
        variant: "error",
      });
    }

    if (keep.noteUrl) {
      window.open(keep.noteUrl, "_blank", "noopener");
    }
  }
}

export function showSavedToast(
  parsed: ParsedMedia,
  duplicate: boolean,
  preview: string
): void {
  if (duplicate) {
    showToast({
      title: `Already saved: ${preview}`,
      subtitle: typeLabel(parsed.type),
      variant: "info",
    });
    return;
  }

  if (parsed.type === "book" && !parsed.author) {
    showToast({
      title: `Saved: ${preview}`,
      subtitle: "Author missing. Scroll the panel, then save again.",
      variant: "info",
      durationMs: 6000,
    });
    return;
  }

  showToast({
    title: `Saved: ${preview}`,
    subtitle: typeLabel(parsed.type),
    variant: "success",
  });
}
