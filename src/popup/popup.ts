import { formatBookTitlePart, formatItemLine, formatItemsList, formatRatingLabel } from "../shared/format.js";
import type { KeepSettings } from "../shared/keep-settings.js";
import { isLikelyValidKeepNoteId } from "../shared/keep-settings.js";
import { sendToBackground } from "../shared/messaging.js";
import type { MediaType, SavedItem } from "../shared/types.js";

let allItems: SavedItem[] = [];
let activeFilter: MediaType | "all" = "all";
let keepSettings: KeepSettings = { enabled: false };
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let settingsStatusTimer: ReturnType<typeof setTimeout> | undefined;

const appView = document.getElementById("app-view")!;
const settingsView = document.getElementById("settings-view")!;
const listEl = document.getElementById("list")!;
const emptyEl = document.getElementById("empty")!;
const filterEmptyEl = document.getElementById("filter-empty")!;
const emptyFooterEl = document.getElementById("empty-footer")!;
const countEl = document.getElementById("count")!;
const statusEl = document.getElementById("status")!;
const statusTextEl = document.getElementById("status-text")!;
const filtersEl = document.getElementById("filters")!;
const keepEnabledEl = document.getElementById("keep-enabled") as HTMLInputElement;
const keepMediaUrlEl = document.getElementById("keep-media-url") as HTMLInputElement;
const keepBooksUrlEl = document.getElementById("keep-books-url") as HTMLInputElement;
const keepMediaStatusEl = document.getElementById("keep-media-status")!;
const keepBooksStatusEl = document.getElementById("keep-books-status")!;
const settingsStatusEl = document.getElementById("settings-status")!;
const settingsStatusTextEl = document.getElementById("settings-status-text")!;
const settingsStatusIconEl = document.getElementById("settings-status-icon")!;
const confirmDialogEl = document.getElementById("confirm-dialog")!;
const confirmTitleEl = document.getElementById("confirm-title")!;
const confirmMessageEl = document.getElementById("confirm-message")!;
const confirmOkEl = document.getElementById("confirm-ok") as HTMLButtonElement;
const confirmCancelEl = document.getElementById("confirm-cancel") as HTMLButtonElement;
const itemTooltipEl = document.getElementById("item-tooltip")!;
const mainEl = document.getElementById("main")!;
const animeIconUrl = chrome.runtime.getURL("icons/anime_logo.png");

let confirmResolve: ((value: boolean) => void) | undefined;

function isTextTruncated(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth;
}

function showItemTooltip(text: string, anchor: HTMLElement): void {
  itemTooltipEl.textContent = text;
  itemTooltipEl.hidden = false;
  itemTooltipEl.classList.add("visible");

  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = itemTooltipEl.getBoundingClientRect();

  let top = anchorRect.bottom + 6;
  let left = anchorRect.left;

  if (top + tooltipRect.height > window.innerHeight - 8) {
    top = anchorRect.top - tooltipRect.height - 6;
  }
  if (left + tooltipRect.width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - tooltipRect.width - 8);
  }
  if (left < 8) left = 8;

  itemTooltipEl.style.top = `${Math.round(top)}px`;
  itemTooltipEl.style.left = `${Math.round(left)}px`;
}

function hideItemTooltip(): void {
  itemTooltipEl.classList.remove("visible");
  itemTooltipEl.hidden = true;
}

mainEl.addEventListener("scroll", hideItemTooltip, { passive: true });

function filteredItems(): SavedItem[] {
  if (activeFilter === "all") return allItems;
  return allItems.filter((i) => i.type === activeFilter);
}

function typeIcon(type: MediaType): string {
  switch (type) {
    case "book":
      return "menu_book";
    case "series":
      return "live_tv";
    default:
      return "movie";
  }
}

function createTypeIconEl(type: MediaType): HTMLElement {
  const label = typeLabel(type);

  if (type === "anime") {
    const img = document.createElement("img");
    img.className = "type-icon type-icon-img";
    img.src = animeIconUrl;
    img.alt = "";
    img.setAttribute("aria-label", label);
    return img;
  }

  const icon = document.createElement("span");
  icon.className = "type-icon material-symbols-outlined";
  icon.textContent = typeIcon(type);
  icon.setAttribute("aria-label", label);
  return icon;
}

function typeLabel(type: MediaType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatSeason(value: string): string {
  const seasonMatch = value.match(/^(\d+)\s*seasons?$/i);
  if (seasonMatch) {
    return `S${seasonMatch[1].padStart(2, "0")}`;
  }
  return value;
}

function itemTitle(item: SavedItem): string {
  if (item.type === "book") return formatBookTitlePart(item);
  return item.year ? `${item.title} (${item.year})` : item.title;
}

function itemSubtitle(item: SavedItem): string {
  if (item.type === "book") {
    const parts: string[] = [];
    const year = item.publishedYear ?? item.year;
    if (year) parts.push(year);
    const rating = formatRatingLabel(item);
    if (rating) parts.push(rating);
    return parts.join(" | ");
  }

  const parts: string[] = [];
  if (item.durationOrSeasons) {
    parts.push(formatSeason(item.durationOrSeasons));
  }
  const rating = formatRatingLabel(item);
  if (rating) parts.push(rating);
  return parts.join(" | ");
}

function showStatus(message: string, isError = false, durationMs = 2500): void {
  if (statusTimer) clearTimeout(statusTimer);
  statusTextEl.textContent = message;
  statusEl.hidden = false;
  statusEl.classList.toggle("error", isError);
  statusTimer = setTimeout(() => {
    statusEl.hidden = true;
  }, durationMs);
}

function closeConfirmDialog(result: boolean): void {
  confirmDialogEl.hidden = true;
  confirmResolve?.(result);
  confirmResolve = undefined;
}

function showConfirm(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<boolean> {
  if (confirmResolve) {
    closeConfirmDialog(false);
  }

  confirmTitleEl.textContent = options.title;
  confirmMessageEl.textContent = options.message;
  confirmOkEl.textContent = options.confirmLabel ?? "Confirm";
  confirmCancelEl.textContent = options.cancelLabel ?? "Cancel";

  confirmDialogEl.hidden = false;
  confirmCancelEl.focus();

  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

function showSettingsStatus(
  message: string,
  isError = false,
  durationMs = 3500
): void {
  if (settingsStatusTimer) clearTimeout(settingsStatusTimer);
  settingsStatusTextEl.textContent = message;
  settingsStatusIconEl.textContent = isError ? "error" : "check_circle";
  settingsStatusEl.hidden = false;
  settingsStatusEl.classList.toggle("error", isError);
  settingsStatusTimer = setTimeout(() => {
    settingsStatusEl.hidden = true;
  }, durationMs);
}

function openSettings(): void {
  settingsStatusEl.hidden = true;
  if (settingsStatusTimer) clearTimeout(settingsStatusTimer);
  appView.hidden = true;
  settingsView.hidden = false;
}

function closeSettings(): void {
  settingsView.hidden = true;
  appView.hidden = false;
}

function render(): void {
  const items = filteredItems();
  const total = allItems.length;
  countEl.textContent = `${total} saved`;
  listEl.innerHTML = "";

  const showGlobalEmpty = total === 0;
  const showFilterEmpty = total > 0 && items.length === 0;

  emptyEl.hidden = !showGlobalEmpty;
  emptyFooterEl.hidden = !showGlobalEmpty;
  filterEmptyEl.hidden = !showFilterEmpty;
  listEl.hidden = items.length === 0;

  if (items.length === 0) {
    return;
  }

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "list-item";
    li.dataset.id = item.id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.id = item.id;

    const typeIconEl = createTypeIconEl(item.type);

    typeIconEl.addEventListener("mouseenter", () => {
      showItemTooltip(typeLabel(item.type), typeIconEl);
    });
    typeIconEl.addEventListener("mouseleave", hideItemTooltip);

    const body = document.createElement("div");
    body.className = "item-body";

    const title = document.createElement("h3");
    title.className = "item-title";
    title.textContent = itemTitle(item);

    const subtitle = document.createElement("p");
    subtitle.className = "item-subtitle";
    subtitle.textContent = itemSubtitle(item);

    body.append(title, subtitle);
    li.append(typeIconEl, body, checkbox);

    const fullLine = formatItemLine(item);

    const showFullLineTooltip = (): void => {
      if (!isTextTruncated(title) && !isTextTruncated(subtitle)) return;
      showItemTooltip(fullLine, li);
    };

    title.addEventListener("mouseenter", showFullLineTooltip);
    subtitle.addEventListener("mouseenter", showFullLineTooltip);
    title.addEventListener("mouseleave", hideItemTooltip);
    subtitle.addEventListener("mouseleave", hideItemTooltip);

    li.addEventListener("mouseleave", hideItemTooltip);

    li.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest('input[type="checkbox"]')) return;
      checkbox.checked = !checkbox.checked;
    });

    listEl.append(li);
  }
}

async function loadItems(): Promise<void> {
  try {
    const response = await sendToBackground({ action: "getAll" });
    if (response?.ok && "items" in response) {
      allItems = response.items;
    }
  } catch (err) {
    showStatus(
      err instanceof Error ? err.message : "Could not load saved items.",
      true
    );
  }
  render();
}

function renderKeepStatus(): void {
  keepEnabledEl.checked = keepSettings.enabled;
  keepMediaUrlEl.value = keepSettings.mediaNoteUrl ?? "";
  keepBooksUrlEl.value = keepSettings.booksNoteUrl ?? "";

  keepMediaStatusEl.textContent = isLikelyValidKeepNoteId(keepSettings.mediaNoteId)
    ? "Linked"
    : keepSettings.mediaNoteUrl
      ? "URL looks incomplete. Paste the full Keep link."
      : "Not linked";
  keepMediaStatusEl.classList.toggle(
    "linked",
    isLikelyValidKeepNoteId(keepSettings.mediaNoteId)
  );

  keepBooksStatusEl.textContent = isLikelyValidKeepNoteId(keepSettings.booksNoteId)
    ? "Linked"
    : keepSettings.booksNoteUrl
      ? "URL looks incomplete. Paste the full Keep link."
      : "Not linked";
  keepBooksStatusEl.classList.toggle(
    "linked",
    isLikelyValidKeepNoteId(keepSettings.booksNoteId)
  );
}

async function loadKeepSettings(): Promise<void> {
  try {
    const response = await sendToBackground({ action: "getKeepSettings" });
    if (response?.ok && "settings" in response) {
      keepSettings = response.settings;
      renderKeepStatus();
    }

    const last = await sendToBackground({ action: "getLastKeepResult" });
    if (last?.ok && "lastKeepResult" in last && last.lastKeepResult) {
      const age = Date.now() - last.lastKeepResult.at;
      if (age < 5 * 60 * 1000) {
        showStatus(last.lastKeepResult.message, last.lastKeepResult.isError, 8000);
      }
    }
  } catch (err) {
    showStatus(
      err instanceof Error ? err.message : "Could not load Keep settings.",
      true
    );
  }
}

async function persistKeepSettings(): Promise<boolean> {
  try {
    const response = await sendToBackground({
      action: "setKeepSettings",
      settings: {
        enabled: keepEnabledEl.checked,
        mediaNoteUrl: keepMediaUrlEl.value,
        booksNoteUrl: keepBooksUrlEl.value,
      },
    });
    if (response?.ok && "settings" in response) {
      keepSettings = response.settings;
      renderKeepStatus();
      return true;
    }
    showSettingsStatus(
      response?.error ?? "Could not save Keep settings.",
      true
    );
    return false;
  } catch (err) {
    showSettingsStatus(
      err instanceof Error ? err.message : "Could not save Keep settings.",
      true
    );
    return false;
  }
}

async function saveKeepSettings(): Promise<void> {
  const saved = await persistKeepSettings();
  if (!saved) return;

  closeSettings();
  showStatus("Keep settings saved.");
}

async function testKeep(target: "media" | "books"): Promise<void> {
  const saved = await persistKeepSettings();
  if (!saved) return;

  const noteId =
    target === "books" ? keepSettings.booksNoteId : keepSettings.mediaNoteId;
  if (!isLikelyValidKeepNoteId(noteId)) {
    showSettingsStatus(
      "Paste the full Keep list URL from your browser (the long #LIST/… link).",
      true,
      8000
    );
    return;
  }

  showSettingsStatus("Adding test line to Keep…", false, 8000);
  try {
    const response = await sendToBackground({ action: "testKeepAppend", target });
    if (!response?.ok || !("keep" in response)) {
      showSettingsStatus(response?.error ?? "Keep test failed.", true, 8000);
      return;
    }

    const keep = response.keep;
    if (keep.status === "missing_config") {
      showSettingsStatus(keep.error ?? "Link the Keep note URL first.", true, 8000);
      return;
    }
    if (keep.status === "synced") {
      showSettingsStatus(`Test line added to Keep (${target}).`, false, 8000);
      return;
    }
    if (keep.status === "duplicate") {
      showSettingsStatus(`Test line already exists in Keep (${target}).`, false, 8000);
      return;
    }
    showSettingsStatus(keep.error ?? "Keep test failed.", true, 8000);
  } catch (err) {
    showSettingsStatus(err instanceof Error ? err.message : "Keep test failed.", true, 8000);
  }
}

function getSelectedIds(): string[] {
  return Array.from(
    listEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')
  ).map((el) => el.dataset.id!);
}

async function copyToClipboard(items: SavedItem[]): Promise<void> {
  if (items.length === 0) {
    showStatus("Nothing to copy.", true);
    return;
  }
  await navigator.clipboard.writeText(formatItemsList(items));
  showStatus(`Copied ${items.length} item${items.length === 1 ? "" : "s"}.`);
}

filtersEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".filter");
  if (!btn) return;
  activeFilter = (btn.dataset.filter as MediaType | "all") ?? "all";
  filtersEl.querySelectorAll(".filter").forEach((f) => {
    f.classList.toggle("active", f === btn);
  });
  render();
});

document.getElementById("copy-all")!.addEventListener("click", () => {
  void copyToClipboard(filteredItems());
});

document.getElementById("copy-selected")!.addEventListener("click", () => {
  const ids = new Set(getSelectedIds());
  const selected = filteredItems().filter((i) => ids.has(i.id));
  void copyToClipboard(selected);
});

document.getElementById("delete-selected")!.addEventListener("click", async () => {
  const ids = getSelectedIds();
  if (ids.length === 0) {
    showStatus("Select items to delete.", true);
    return;
  }
  try {
    const response = await sendToBackground({ action: "delete", ids });
    if (response?.ok && "items" in response) {
      allItems = response.items;
      render();
      showStatus(`Deleted ${ids.length} item${ids.length === 1 ? "" : "s"}.`);
    }
  } catch (err) {
    showStatus(err instanceof Error ? err.message : "Delete failed.", true);
  }
});

document.getElementById("clear-all")!.addEventListener("click", async () => {
  const confirmed = await showConfirm({
    title: "Clear all saved items?",
    message:
      "This removes every item from KeepShelf. Your Google Keep lists are not affected.",
    confirmLabel: "Clear all",
    cancelLabel: "Cancel",
  });
  if (!confirmed) return;

  try {
    const response = await sendToBackground({ action: "clear" });
    if (response?.ok) {
      allItems = [];
      render();
      showStatus("Cleared all items.");
    }
  } catch (err) {
    showStatus(err instanceof Error ? err.message : "Clear failed.", true);
  }
});

confirmOkEl.addEventListener("click", () => closeConfirmDialog(true));
confirmCancelEl.addEventListener("click", () => closeConfirmDialog(false));
confirmDialogEl.querySelectorAll("[data-confirm-dismiss]").forEach((el) => {
  el.addEventListener("click", () => closeConfirmDialog(false));
});

document.addEventListener("keydown", (event) => {
  if (confirmDialogEl.hidden) return;
  if (event.key === "Escape") {
    closeConfirmDialog(false);
  }
});

document.getElementById("open-settings")!.addEventListener("click", openSettings);
document.getElementById("close-settings")!.addEventListener("click", closeSettings);

document.getElementById("status-close")!.addEventListener("click", () => {
  statusEl.hidden = true;
  if (statusTimer) clearTimeout(statusTimer);
});

document.getElementById("keep-save-settings")!.addEventListener("click", () => {
  void saveKeepSettings();
});

document.getElementById("keep-test-media")!.addEventListener("click", () => {
  void testKeep("media");
});

document.getElementById("keep-test-books")!.addEventListener("click", () => {
  void testKeep("books");
});

void loadItems();
void loadKeepSettings();
