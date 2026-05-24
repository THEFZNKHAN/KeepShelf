import { formatBookTitlePart, formatDurationOrSeasons, formatItemLine, formatItemsList, formatRatingLabel } from "../shared/format.js";
import type { KeepSettings } from "../shared/keep-settings.js";
import { isLikelyValidKeepNoteId } from "../shared/keep-settings.js";
import { sendToBackground } from "../shared/messaging.js";
import type { MediaType, SavedItem } from "../shared/types.js";

let allItems: SavedItem[] = [];
let activeFilter: MediaType | "all" = "all";
let activeTab: "media" | "books" | "tabs" = "media";
let keepSettings: KeepSettings = { mediaEnabled: false, booksEnabled: false, tabsEnabled: false };
let statusTimer: ReturnType<typeof setTimeout> | undefined;

const appView = document.getElementById("app-view")!;
const settingsView = document.getElementById("settings-view")!;
const listEl = document.getElementById("list")!;
const emptyEl = document.getElementById("empty")!;
const emptyHeadingEl = document.getElementById("empty-heading")!;
const emptyBodyEl = document.getElementById("empty-body")!;
const emptyHintsEl = document.getElementById("empty-hints")!;
const filterEmptyEl = document.getElementById("filter-empty")!;
const countEl = document.getElementById("count")!;
const statusEl = document.getElementById("status")!;
const statusTextEl = document.getElementById("status-text")!;
const filtersEl = document.getElementById("filters")!;
const tabsInputRowEl = document.getElementById("tabs-input-row")!;
const tabInputEl = document.getElementById("tab-input") as HTMLInputElement;
const keepMediaEnabledEl = document.getElementById("keep-media-enabled") as HTMLInputElement;
const keepBooksEnabledEl = document.getElementById("keep-books-enabled") as HTMLInputElement;
const keepTabsEnabledEl = document.getElementById("keep-tabs-enabled") as HTMLInputElement;
const keepMediaUrlEl = document.getElementById("keep-media-url") as HTMLInputElement;
const keepBooksUrlEl = document.getElementById("keep-books-url") as HTMLInputElement;
const keepTabsUrlEl = document.getElementById("keep-tabs-url") as HTMLInputElement;
const keepMediaStatusEl = document.getElementById("keep-media-status")!;
const keepBooksStatusEl = document.getElementById("keep-books-status")!;
const keepTabsStatusEl = document.getElementById("keep-tabs-status")!;
const mediaSettingsStatusEl = document.getElementById("media-settings-status")!;
const mediaSettingsStatusTextEl = document.getElementById("media-settings-status-text")!;
const mediaSettingsStatusIconEl = document.getElementById("media-settings-status-icon")!;
const booksSettingsStatusEl = document.getElementById("books-settings-status")!;
const booksSettingsStatusTextEl = document.getElementById("books-settings-status-text")!;
const booksSettingsStatusIconEl = document.getElementById("books-settings-status-icon")!;
const tabsSettingsStatusEl = document.getElementById("tabs-settings-status")!;
const tabsSettingsStatusTextEl = document.getElementById("tabs-settings-status-text")!;
const tabsSettingsStatusIconEl = document.getElementById("tabs-settings-status-icon")!;
const confirmDialogEl = document.getElementById("confirm-dialog")!;
const confirmTitleEl = document.getElementById("confirm-title")!;
const confirmMessageEl = document.getElementById("confirm-message")!;
const confirmOkEl = document.getElementById("confirm-ok") as HTMLButtonElement;
const confirmCancelEl = document.getElementById("confirm-cancel") as HTMLButtonElement;
const itemTooltipEl = document.getElementById("item-tooltip")!;
const mainEl = document.getElementById("main")!;
const shelfTabsEl = document.getElementById("shelf-tabs")!;
const animeIconUrl = chrome.runtime.getURL("icons/anime_logo.png");

let confirmResolve: ((value: boolean) => void) | undefined;

function isValidUrl(value: string): boolean {
  try {
    const p = new URL(value.trim());
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

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

function tabItems(): SavedItem[] {
  if (activeTab === "books") return allItems.filter((i) => i.type === "book");
  if (activeTab === "tabs") return allItems.filter((i) => i.type === "tab" || i.type === "link" || i.type === "note");
  return allItems.filter((i) => i.type !== "book" && i.type !== "tab" && i.type !== "link" && i.type !== "note");
}

function filteredItems(): SavedItem[] {
  const base = tabItems();
  if (activeTab !== "media") return base;
  if (activeFilter === "all") return base;
  return base.filter((i) => i.type === activeFilter);
}

function typeIcon(type: MediaType): string {
  switch (type) {
    case "book": return "menu_book";
    case "series": return "live_tv";
    case "tab": return "tab";
    case "link": return "link";
    case "note": return "sticky_note_2";
    default: return "movie";
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
  if (type === "tab") return "Tab";
  if (type === "link") return "Link";
  if (type === "note") return "Note";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function itemTitle(item: SavedItem): string {
  if (item.type === "book") return formatBookTitlePart(item);
  if (item.type === "note") return (item.body ?? item.title).trim();
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

  if (item.type === "tab" || item.type === "link") {
    return item.url ?? "";
  }

  if (item.type === "note") {
    return "";
  }

  const parts: string[] = [];
  if (item.durationOrSeasons) {
    parts.push(formatDurationOrSeasons(item.durationOrSeasons));
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

function showSectionStatus(
  el: HTMLElement,
  textEl: HTMLElement,
  iconEl: HTMLElement,
  timerRef: { value: ReturnType<typeof setTimeout> | undefined },
  message: string,
  isError = false,
  durationMs = 3500
): void {
  if (timerRef.value) clearTimeout(timerRef.value);
  textEl.textContent = message;
  iconEl.textContent = isError ? "error" : "check_circle";
  el.hidden = false;
  el.classList.toggle("error", isError);
  timerRef.value = setTimeout(() => { el.hidden = true; }, durationMs);
}

const mediaStatusTimer: { value: ReturnType<typeof setTimeout> | undefined } = { value: undefined };
const booksStatusTimer: { value: ReturnType<typeof setTimeout> | undefined } = { value: undefined };
const tabsStatusTimerRef: { value: ReturnType<typeof setTimeout> | undefined } = { value: undefined };

function showMediaStatus(msg: string, err = false, ms = 3500): void {
  showSectionStatus(mediaSettingsStatusEl, mediaSettingsStatusTextEl, mediaSettingsStatusIconEl, mediaStatusTimer, msg, err, ms);
}
function showBooksStatus(msg: string, err = false, ms = 3500): void {
  showSectionStatus(booksSettingsStatusEl, booksSettingsStatusTextEl, booksSettingsStatusIconEl, booksStatusTimer, msg, err, ms);
}
function showTabsSectionStatus(msg: string, err = false, ms = 3500): void {
  showSectionStatus(tabsSettingsStatusEl, tabsSettingsStatusTextEl, tabsSettingsStatusIconEl, tabsStatusTimerRef, msg, err, ms);
}

function openSettings(): void {
  mediaSettingsStatusEl.hidden = true;
  booksSettingsStatusEl.hidden = true;
  tabsSettingsStatusEl.hidden = true;
  if (mediaStatusTimer.value) clearTimeout(mediaStatusTimer.value);
  if (booksStatusTimer.value) clearTimeout(booksStatusTimer.value);
  if (tabsStatusTimerRef.value) clearTimeout(tabsStatusTimerRef.value);
  appView.hidden = true;
  settingsView.hidden = false;
}

function closeSettings(): void {
  settingsView.hidden = true;
  appView.hidden = false;
}

function updateEmptyState(): void {
  if (activeTab === "books") {
    emptyHeadingEl.textContent = "No books saved yet";
    emptyBodyEl.innerHTML =
      "Open a Goodreads or BookFilter page, then click <strong>Save page</strong> in the toolbar above.";
    emptyHintsEl.innerHTML = `
      <div class="source-chip">
        <span class="material-symbols-outlined">menu_book</span>
        Goodreads
      </div>
      <div class="source-chip">
        <span class="material-symbols-outlined">filter_alt</span>
        BookFilter
      </div>
      <div class="source-chip">
        <span class="material-symbols-outlined">travel_explore</span>
        Google Search
      </div>
    `;
  } else if (activeTab === "tabs") {
    emptyHeadingEl.textContent = "No tabs saved yet";
    emptyBodyEl.innerHTML =
      "Paste a URL or write a note in the box above, or click <strong>Save this tab</strong> to save the current page.";
    emptyHintsEl.innerHTML = `
      <div class="source-chip">
        <span class="material-symbols-outlined">tab</span>
        Save this tab
      </div>
      <div class="source-chip">
        <span class="material-symbols-outlined">link</span>
        Paste a link
      </div>
      <div class="source-chip">
        <span class="material-symbols-outlined">sticky_note_2</span>
        Write a note
      </div>
    `;
  } else {
    emptyHeadingEl.textContent = "Nothing saved yet";
    emptyBodyEl.innerHTML =
      "Open a supported page, then click <strong>Save page</strong> in the toolbar above.";
    emptyHintsEl.innerHTML = `
      <div class="source-chip">
        <span class="material-symbols-outlined">travel_explore</span>
        Google Search
      </div>
      <div class="source-chip">
        <span class="material-symbols-outlined">star</span>
        IMDb
      </div>
      <div class="source-chip">
        <span class="material-symbols-outlined">movie</span>
        Letterboxd
      </div>
      <div class="source-chip">
        <span class="material-symbols-outlined">animation</span>
        MyAnimeList
      </div>
      <div class="source-chip">
        <span class="material-symbols-outlined">show_chart</span>
        Series Graph
      </div>
    `;
  }
}

function render(): void {
  const items = filteredItems();
  const tabCount = tabItems().length;

  countEl.textContent = `${tabCount} saved`;
  listEl.innerHTML = "";

  filtersEl.hidden = activeTab !== "media";
  tabsInputRowEl.hidden = activeTab !== "tabs";

  const savePageBtn = document.getElementById("save-page")!;
  savePageBtn.textContent =
    activeTab === "books" ? "Save book" :
    activeTab === "tabs" ? "Save tab" :
    "Save media";

  const showGlobalEmpty = tabCount === 0;
  const showFilterEmpty = tabCount > 0 && items.length === 0;

  updateEmptyState();
  emptyEl.hidden = !showGlobalEmpty;
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

    body.append(title);

    const subtitleText = itemSubtitle(item);
    if (subtitleText) {
      const subtitle = document.createElement("p");
      subtitle.className = "item-subtitle";
      subtitle.textContent = subtitleText;

      subtitle.addEventListener("mouseenter", () => {
        if (!isTextTruncated(subtitle)) return;
        showItemTooltip(formatItemLine(item), li);
      });
      subtitle.addEventListener("mouseleave", hideItemTooltip);

      body.append(subtitle);
    }

    li.append(typeIconEl, body, checkbox);

    const fullLine = formatItemLine(item);

    title.addEventListener("mouseenter", () => {
      if (!isTextTruncated(title)) return;
      showItemTooltip(fullLine, li);
    });
    title.addEventListener("mouseleave", hideItemTooltip);
    li.addEventListener("mouseleave", hideItemTooltip);

    const isOpenable = (item.type === "tab" || item.type === "link") && !!item.url;

    if (isOpenable) {
      body.classList.add("item-body-link");
      body.title = item.url!;
    }

    li.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('input[type="checkbox"]')) return;

      if (isOpenable && target.closest(".item-body")) {
        void chrome.tabs.create({ url: item.url });
        return;
      }

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

function linkedText(noteId: string | undefined, noteUrl: string | undefined): string {
  if (isLikelyValidKeepNoteId(noteId)) return "Linked";
  if (noteUrl) return "URL looks incomplete. Paste the full Keep link.";
  return "Not linked";
}

function renderKeepStatus(): void {
  keepMediaEnabledEl.checked = keepSettings.mediaEnabled;
  keepBooksEnabledEl.checked = keepSettings.booksEnabled;
  keepTabsEnabledEl.checked = keepSettings.tabsEnabled;
  keepMediaUrlEl.value = keepSettings.mediaNoteUrl ?? "";
  keepBooksUrlEl.value = keepSettings.booksNoteUrl ?? "";
  keepTabsUrlEl.value = keepSettings.tabsNoteUrl ?? "";

  keepMediaStatusEl.textContent = linkedText(keepSettings.mediaNoteId, keepSettings.mediaNoteUrl);
  keepMediaStatusEl.classList.toggle("linked", isLikelyValidKeepNoteId(keepSettings.mediaNoteId));

  keepBooksStatusEl.textContent = linkedText(keepSettings.booksNoteId, keepSettings.booksNoteUrl);
  keepBooksStatusEl.classList.toggle("linked", isLikelyValidKeepNoteId(keepSettings.booksNoteId));

  keepTabsStatusEl.textContent = linkedText(keepSettings.tabsNoteId, keepSettings.tabsNoteUrl);
  keepTabsStatusEl.classList.toggle("linked", isLikelyValidKeepNoteId(keepSettings.tabsNoteId));
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
    showStatus(err instanceof Error ? err.message : "Could not load Keep settings.", true);
  }
}

type KeepSection = "media" | "books" | "tabs";

function sectionShowFn(section: KeepSection) {
  if (section === "media") return showMediaStatus;
  if (section === "books") return showBooksStatus;
  return showTabsSectionStatus;
}

async function persistSection(section: KeepSection): Promise<boolean> {
  const show = sectionShowFn(section);
  const settings =
    section === "media"
      ? { mediaEnabled: keepMediaEnabledEl.checked, mediaNoteUrl: keepMediaUrlEl.value }
      : section === "books"
        ? { booksEnabled: keepBooksEnabledEl.checked, booksNoteUrl: keepBooksUrlEl.value }
        : { tabsEnabled: keepTabsEnabledEl.checked, tabsNoteUrl: keepTabsUrlEl.value };
  try {
    const response = await sendToBackground({ action: "setKeepSettings", settings });
    if (response.ok && "settings" in response) {
      keepSettings = response.settings;
      renderKeepStatus();
      return true;
    }
    show(!response.ok ? response.error : "Could not save settings.", true);
    return false;
  } catch (err) {
    show(err instanceof Error ? err.message : "Could not save settings.", true);
    return false;
  }
}

async function saveSection(section: KeepSection): Promise<void> {
  const saved = await persistSection(section);
  if (saved) showStatus(`${section.charAt(0).toUpperCase() + section.slice(1)} Keep settings saved.`);
}

async function testKeep(target: KeepSection): Promise<void> {
  const show = sectionShowFn(target);
  const saved = await persistSection(target);
  if (!saved) return;

  const noteId =
    target === "books" ? keepSettings.booksNoteId
    : target === "tabs" ? keepSettings.tabsNoteId
    : keepSettings.mediaNoteId;

  if (!isLikelyValidKeepNoteId(noteId)) {
    show("Paste the full Keep list URL from your browser (the long #LIST/… link).", true, 8000);
    return;
  }

  show("Adding test line to Keep…", false, 8000);
  try {
    const response = await sendToBackground({ action: "testKeepAppend", target });
    if (!response.ok || !("keep" in response)) {
      show(!response.ok ? response.error : "Keep test failed.", true, 8000);
      return;
    }
    const keep = response.keep;
    if (!keep) { show("Keep test failed.", true, 8000); return; }
    if (keep.status === "missing_config") { show(keep.error ?? "Link the Keep note URL first.", true, 8000); return; }
    if (keep.status === "synced") { show(`Test line added to Keep (${target}).`, false, 8000); return; }
    if (keep.status === "duplicate") { show(`Test line already in Keep (${target}).`, false, 8000); return; }
    show(keep.error ?? "Keep test failed.", true, 8000);
  } catch (err) {
    show(err instanceof Error ? err.message : "Keep test failed.", true, 8000);
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

async function saveCurrentPage(): Promise<void> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    showStatus("Cannot access the current tab.", true);
    return;
  }

  if (!tab?.id) {
    showStatus("Cannot access the current tab.", true);
    return;
  }

  let pageResponse: { item: Omit<SavedItem, "id" | "savedAt"> | null } | undefined;
  try {
    pageResponse = await chrome.tabs.sendMessage(tab.id, { action: "getPageData" });
  } catch {
    showStatus("This page is not supported.", true);
    return;
  }

  if (!pageResponse?.item) {
    showStatus("Nothing detected on this page.", true);
    return;
  }

  let saveResponse;
  try {
    saveResponse = await sendToBackground({ action: "save", item: pageResponse.item });
  } catch (err) {
    showStatus(err instanceof Error ? err.message : "Failed to save.", true);
    return;
  }

  if (!saveResponse?.ok) {
    showStatus(saveResponse?.error ?? "Failed to save.", true);
    return;
  }

  if ("duplicate" in saveResponse && saveResponse.duplicate) {
    showStatus("Already saved.");
  } else {
    showStatus("Saved!");
    await loadItems();
  }
}

async function saveTabInput(): Promise<void> {
  const value = tabInputEl.value.trim();
  if (!value) {
    showStatus("Type a URL or note first.", true);
    tabInputEl.focus();
    return;
  }

  const item: Omit<SavedItem, "id" | "savedAt"> = isValidUrl(value)
    ? {
        type: "link",
        title: new URL(value).hostname.replace(/^www\./, ""),
        url: value,
        sourceUrl: value,
        googleQuery: value,
        subtitle: value,
      }
    : {
        type: "note",
        title: value.length > 60 ? value.slice(0, 59) + "…" : value,
        body: value,
        sourceUrl: "",
        googleQuery: value,
        subtitle: value,
      };

  try {
    const response = await sendToBackground({ action: "save", item });
    if (!response?.ok) {
      showStatus(response?.error ?? "Failed to save.", true);
      return;
    }
    if ("duplicate" in response && response.duplicate) {
      showStatus("Already saved.");
    } else {
      showStatus("Saved!");
      tabInputEl.value = "";
      await loadItems();
    }
  } catch (err) {
    showStatus(err instanceof Error ? err.message : "Failed to save.", true);
  }
}

async function saveCurrentTab(): Promise<void> {
  try {
    const response = await sendToBackground({ action: "saveTab" });
    if (!response?.ok) {
      showStatus(response?.error ?? "Failed to save tab.", true);
      return;
    }
    if ("duplicate" in response && response.duplicate) {
      showStatus("Tab already saved.");
    } else {
      showStatus("Tab saved!");
      await loadItems();
    }
  } catch (err) {
    showStatus(err instanceof Error ? err.message : "Failed to save tab.", true);
  }
}

shelfTabsEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".shelf-tab");
  if (!btn) return;
  const tab = btn.dataset.tab as "media" | "books" | "tabs" | undefined;
  if (!tab || tab === activeTab) return;
  activeTab = tab;
  activeFilter = "all";
  shelfTabsEl.querySelectorAll(".shelf-tab").forEach((t) => {
    t.classList.toggle("active", t === btn);
  });
  filtersEl.querySelectorAll(".filter").forEach((f) => {
    f.classList.toggle("active", (f as HTMLElement).dataset.filter === "all");
  });
  tabInputEl.value = "";
  render();
});

filtersEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".filter");
  if (!btn) return;
  activeFilter = (btn.dataset.filter as MediaType | "all") ?? "all";
  filtersEl.querySelectorAll(".filter").forEach((f) => {
    f.classList.toggle("active", f === btn);
  });
  render();
});

document.getElementById("save-page")!.addEventListener("click", () => {
  void saveCurrentPage();
});

document.getElementById("tab-input-save")!.addEventListener("click", () => {
  void saveTabInput();
});

tabInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void saveTabInput();
});

document.getElementById("tab-save-tab")!.addEventListener("click", () => {
  void saveCurrentTab();
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

document.getElementById("keep-save-media")!.addEventListener("click", () => { void saveSection("media"); });
document.getElementById("keep-save-books")!.addEventListener("click", () => { void saveSection("books"); });
document.getElementById("keep-save-tabs")!.addEventListener("click", () => { void saveSection("tabs"); });
document.getElementById("keep-test-media")!.addEventListener("click", () => { void testKeep("media"); });
document.getElementById("keep-test-books")!.addEventListener("click", () => { void testKeep("books"); });
document.getElementById("keep-test-tabs")!.addEventListener("click", () => { void testKeep("tabs"); });

void loadItems();
void loadKeepSettings();
