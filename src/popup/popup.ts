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
const mainEl = document.getElementById("main")!;
const toolbarPanelEl = document.getElementById("toolbar-panel")!;
const emptyEl = document.getElementById("empty")!;
const filterEmptyEl = document.getElementById("filter-empty")!;
const actionStripEl = document.getElementById("action-strip")!;
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

let confirmResolve: ((value: boolean) => void) | undefined;

const TYPE_ICONS: Record<MediaType, string> = {
  movie: "movie",
  series: "tv",
  anime: "live_tv",
  book: "menu_book",
};

function filteredItems(): SavedItem[] {
  if (activeFilter === "all") return allItems;
  return allItems.filter((i) => i.type === activeFilter);
}

function typeLabel(type: MediaType): string {
  if (type === "movie") return "MOVIE";
  if (type === "series") return "SERIES";
  if (type === "anime") return "ANIME";
  return "BOOK";
}

function formatSeason(value: string): string {
  const seasonMatch = value.match(/^(\d+)\s*seasons?$/i);
  if (seasonMatch) {
    return `S${seasonMatch[1].padStart(2, "0")}`;
  }
  return value;
}

function itemTitle(item: SavedItem): string {
  if (item.type === "book") return formatBookTitlePart(item).toUpperCase();
  const title = item.title.toUpperCase();
  return item.year ? `${title} (${item.year})` : title;
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

function relativeSavedTime(savedAt: number): string {
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  const now = new Date();
  const saved = new Date(savedAt);
  const dayDiff = Math.floor(
    (startOfDay(now) - startOfDay(saved)) / (24 * 60 * 60 * 1000)
  );

  if (dayDiff <= 0) return "Saved today";
  if (dayDiff === 1) return "Saved yesterday";
  if (dayDiff < 7) return `Saved ${dayDiff} days ago`;
  return `Saved ${saved.toLocaleDateString(undefined, { dateStyle: "medium" })}`;
}

function showStatus(message: string, isError = false, durationMs = 2500): void {
  if (statusTimer) clearTimeout(statusTimer);
  statusTextEl.textContent = message.toUpperCase();
  statusEl.hidden = false;
  statusEl.classList.toggle("error", isError);

  const rotate = (Math.random() - 0.5) * 8;
  statusEl.style.transform = `translate(-50%, -50%) rotate(${rotate}deg)`;

  statusTimer = setTimeout(() => {
    statusEl.hidden = true;
    statusEl.style.transform = "translate(-50%, -50%) rotate(-2deg)";
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

  confirmTitleEl.textContent = options.title.toUpperCase();
  confirmMessageEl.textContent = options.message;
  confirmOkEl.textContent = options.confirmLabel?.toUpperCase() ?? "CONFIRM";
  confirmCancelEl.textContent = options.cancelLabel?.toUpperCase() ?? "CANCEL";

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

function syncCardSelection(card: HTMLElement, checked: boolean): void {
  card.classList.toggle("selected", checked);
}

function render(): void {
  const items = filteredItems();
  const total = allItems.length;
  countEl.textContent = `${total} SAVED`;
  listEl.innerHTML = "";

  const showGlobalEmpty = total === 0;
  const showFilterEmpty = total > 0 && items.length === 0;

  emptyEl.hidden = !showGlobalEmpty;
  filterEmptyEl.hidden = !showFilterEmpty;
  listEl.hidden = items.length === 0;
  actionStripEl.hidden = showGlobalEmpty;
  mainEl.classList.toggle("is-empty", showGlobalEmpty);
  toolbarPanelEl.classList.toggle("is-compact", showGlobalEmpty);

  if (items.length === 0) {
    return;
  }

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "brutal-card";
    li.dataset.type = item.type;
    li.dataset.id = item.id;

    const tag = document.createElement("span");
    tag.className = "type-tag";
    tag.textContent = typeLabel(item.type);

    const inner = document.createElement("div");
    inner.className = "card-inner";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "card-select";
    checkbox.dataset.id = item.id;
    checkbox.addEventListener("change", () => {
      syncCardSelection(li, checkbox.checked);
    });

    const iconWrap = document.createElement("div");
    iconWrap.className = "card-icon";
    iconWrap.innerHTML = `<span class="material-symbols-outlined">${TYPE_ICONS[item.type]}</span>`;

    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("h3");
    title.className = "item-title";
    title.textContent = itemTitle(item);
    title.title = formatItemLine(item);

    const subtitle = document.createElement("p");
    subtitle.className = "item-subtitle";
    subtitle.textContent = itemSubtitle(item);
    subtitle.title = itemSubtitle(item);

    const time = document.createElement("p");
    time.className = "item-time";
    time.innerHTML = `<span class="material-symbols-outlined">schedule</span>${relativeSavedTime(item.savedAt)}`;

    body.append(title, subtitle, time);
    inner.append(checkbox, iconWrap, body);
    li.append(tag, inner);

    li.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest(".card-select")) return;
      checkbox.checked = !checkbox.checked;
      syncCardSelection(li, checkbox.checked);
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
    listEl.querySelectorAll<HTMLInputElement>(".card-select:checked")
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

document.getElementById("empty-google")!.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.google.com" });
});

document.getElementById("empty-seriesgraph")!.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://seriesgraph.com" });
});

void loadItems();
void loadKeepSettings();
