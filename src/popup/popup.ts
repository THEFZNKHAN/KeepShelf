import { formatBookTitlePart, formatDurationOrSeasons, formatItemLine, formatItemsList, formatRatingLabel } from "../shared/format.js";
import { buildBackup, parseImportFile } from "../shared/import.js";
import { isHttpUrl, linkItem, noteItem } from "../shared/items.js";
import type { KeepSettings, KeepSyncResult } from "../shared/keep-settings.js";
import { isLikelyValidKeepNoteId } from "../shared/keep-settings.js";
import { sendToBackground } from "../shared/messaging.js";
import { requestPageData } from "../shared/page-data.js";
import type { EditableFields, ItemStatus, MediaType, SavedItem, UserFields } from "../shared/types.js";
import { findDuplicateGroups, pickKeeper } from "../shared/fuzzy.js";
import { normalizeTags, statusOf } from "../shared/user-data.js";

type StatusFilter = "all" | "todo" | "progress" | "done" | "dropped";
type SortBy = "newest" | "oldest" | "title" | "year" | "rating" | "myrating";

const STATUS_FILTERS: StatusFilter[] = ["all", "todo", "progress", "done", "dropped"];
const SORTS: SortBy[] = ["newest", "oldest", "title", "year", "rating", "myrating"];
const FILTER_STATUS: Record<Exclude<StatusFilter, "all">, ItemStatus> = {
  todo: "plan",
  progress: "in_progress",
  done: "done",
  dropped: "dropped",
};

function storedChoice<T extends string>(key: string, allowed: T[], fallback: T): T {
  const value = localStorage.getItem(key) as T | null;
  return value && allowed.includes(value) ? value : fallback;
}

let allItems: SavedItem[] = [];
let activeFilter: MediaType | "all" = "all";
let activeTab: "media" | "books" | "tabs" = "media";
let searchQuery = "";
let tagFilter = "";
let listFilter = "";
let statusFilter = storedChoice<StatusFilter>("keepshelf.status", STATUS_FILTERS, "all");
let sortBy = storedChoice<SortBy>("keepshelf.sort", SORTS, "newest");
let keepSettings: KeepSettings = { mediaEnabled: false, booksEnabled: false, tabsEnabled: false };
let statusTimer: ReturnType<typeof setTimeout> | undefined;
const isTabView = new URLSearchParams(location.search).get("view") === "settings";

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
const savePageBtnEl = document.getElementById("save-page") as HTMLButtonElement;
const searchEl = document.getElementById("search") as HTMLInputElement;
const statusFilterEl = document.getElementById("status-filter") as HTMLSelectElement;
const sortEl = document.getElementById("sort") as HTMLSelectElement;
const organiseRowEl = document.getElementById("organise-row")!;
const tagFilterEl = document.getElementById("tag-filter") as HTMLSelectElement;
const listFilterEl = document.getElementById("list-filter") as HTMLSelectElement;
const syncSelectedEl = document.getElementById("sync-selected") as HTMLButtonElement;
const editDialogEl = document.getElementById("edit-dialog")!;
const editFormEl = document.getElementById("edit-form") as HTMLFormElement;
const editFieldsEl = document.getElementById("edit-fields")!;
const editErrorEl = document.getElementById("edit-error")!;
const importFileEl = document.getElementById("import-file") as HTMLInputElement;
const backupSettingsStatusEl = document.getElementById("backup-settings-status")!;
const backupSettingsStatusTextEl = document.getElementById("backup-settings-status-text")!;
const backupSettingsStatusIconEl = document.getElementById("backup-settings-status-icon")!;
const animeIconUrl = chrome.runtime.getURL("icons/anime_logo.png");

let confirmResolve: ((value: boolean) => void) | undefined;
let editingId: string | undefined;

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

function searchText(item: SavedItem): string {
  return [formatItemLine(item), item.subtitle, item.genre, item.author, item.url, item.body, item.review, item.list, ...(item.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Ratings out of 10 so IMDb, Letterboxd (/5), Goodreads (/5) and Rotten Tomatoes (%) sort together. */
function ratingScore(item: SavedItem): number {
  const value = parseFloat(item.imdbRating ?? "");
  if (Number.isNaN(value)) return -1;
  const url = item.sourceUrl ?? "";
  if (/letterboxd\.com|goodreads\.com|book-filter\.com/.test(url)) return value * 2;
  if (url.includes("rottentomatoes.com")) return value / 10;
  return value;
}

function yearOf(item: SavedItem): number {
  const year = parseInt(item.year ?? item.publishedYear ?? "", 10);
  return Number.isNaN(year) ? -1 : year;
}

function sortItems(items: SavedItem[]): SavedItem[] {
  const sorted = [...items];
  switch (sortBy) {
    case "oldest":
      return sorted.sort((a, b) => a.savedAt - b.savedAt);
    case "title":
      return sorted.sort((a, b) => itemTitle(a).localeCompare(itemTitle(b), undefined, { sensitivity: "base" }));
    case "year":
      return sorted.sort((a, b) => yearOf(b) - yearOf(a));
    case "rating":
      return sorted.sort((a, b) => ratingScore(b) - ratingScore(a));
    case "myrating":
      return sorted.sort((a, b) => (b.myRating ?? 0) - (a.myRating ?? 0));
    default:
      return sorted.sort((a, b) => b.savedAt - a.savedAt);
  }
}

function filteredItems(): SavedItem[] {
  let items = tabItems();
  if (activeTab === "media" && activeFilter !== "all") {
    items = items.filter((i) => i.type === activeFilter);
  }
  if (statusFilter !== "all") {
    const wanted = FILTER_STATUS[statusFilter];
    items = items.filter((i) => statusOf(i) === wanted);
  }
  if (tagFilter) items = items.filter((i) => i.tags?.includes(tagFilter));
  if (listFilter) items = items.filter((i) => i.list === listFilter);
  const query = searchQuery.trim().toLowerCase();
  if (query) items = items.filter((i) => searchText(i).includes(query));
  return sortItems(items);
}

function statusLabel(status: ItemStatus): string {
  const labels = doneLabels();
  switch (status) {
    case "done": return labels.done;
    case "in_progress": return "In progress";
    case "dropped": return "Dropped";
    default: return labels.todo;
  }
}

function doneLabels(): { todo: string; done: string; markDone: string; markTodo: string } {
  if (activeTab === "books") {
    return { todo: "To read", done: "Read", markDone: "Mark as read", markTodo: "Mark as not read" };
  }
  if (activeTab === "tabs") {
    return { todo: "To do", done: "Done", markDone: "Mark as done", markTodo: "Mark as not done" };
  }
  return { todo: "To watch", done: "Watched", markDone: "Mark as watched", markTodo: "Mark as not watched" };
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
      <div class="source-chip">
        <span class="material-symbols-outlined">local_florist</span>
        Rotten Tomatoes
      </div>
      <div class="source-chip">
        <span class="material-symbols-outlined">track_changes</span>
        Trakt
      </div>
    `;
  }
}

function createLeadingEl(item: SavedItem): HTMLElement {
  if (!item.imageUrl) return createTypeIconEl(item.type);
  const img = document.createElement("img");
  img.className = "item-thumb";
  img.src = item.imageUrl;
  img.alt = "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.setAttribute("aria-label", typeLabel(item.type));
  img.addEventListener("error", () => img.replaceWith(createTypeIconEl(item.type)), { once: true });
  return img;
}

function createRowAction(
  icon: string,
  label: string,
  onClick: () => void,
  extraClass = ""
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `row-action ${extraClass}`.trim();
  btn.title = label;
  btn.setAttribute("aria-label", label);
  const glyph = document.createElement("span");
  glyph.className = "material-symbols-outlined";
  glyph.textContent = icon;
  btn.append(glyph);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function createRowActions(item: SavedItem): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "row-actions";
  const labels = doneLabels();

  if (item.keepStatus === "failed" || item.keepStatus === "missing_config") {
    actions.append(
      createRowAction(
        "sync_problem",
        `Not in Keep: ${(item.keepError ?? "sync failed").replace(/\.+$/, "")}. Click to retry.`,
        () => void syncToKeep([item.id]),
        "keep-problem pinned"
      )
    );
  }

  actions.append(
    createRowAction(
      "check_circle",
      item.done ? labels.markTodo : labels.markDone,
      () => void updateItemFields(item.id, { done: !item.done }),
      item.done ? "is-done pinned" : ""
    )
  );

  const isTabLike = item.type === "tab" || item.type === "link" || item.type === "note";
  if (!isTabLike && isHttpUrl(item.sourceUrl ?? "")) {
    actions.append(createRowAction("open_in_new", "Open source page", () => void chrome.tabs.create({ url: item.sourceUrl })));
  }

  actions.append(createRowAction("edit", "Edit", () => openEditDialog(item)));
  return actions;
}

function isTrackable(item: SavedItem): boolean {
  return item.type !== "tab" && item.type !== "link" && item.type !== "note";
}

function progressText(item: SavedItem): string {
  if (item.progressCurrent === undefined && item.progressTotal === undefined) return "";
  const unit = item.type === "book" ? "p." : item.type === "movie" ? "" : "ep.";
  const current = item.progressCurrent ?? 0;
  const text = item.progressTotal !== undefined ? `${current}/${item.progressTotal}` : `${current}`;
  return unit ? `${unit} ${text}` : text;
}

function createItemMeta(item: SavedItem): HTMLElement | undefined {
  const status = statusOf(item);
  const parts: string[] = [];
  if (isTrackable(item) && (status === "in_progress" || status === "dropped")) parts.push(statusLabel(status));
  const progress = progressText(item);
  if (progress && isTrackable(item)) parts.push(progress);
  if (item.myRating) parts.push(`★ ${item.myRating}/10`);
  if (item.list) parts.push(item.list);
  const tags = item.tags ?? [];
  if (parts.length === 0 && tags.length === 0) return undefined;

  const meta = document.createElement("div");
  meta.className = "item-meta";
  if (parts.length) {
    const text = document.createElement("span");
    text.className = "item-meta-text";
    text.textContent = parts.join(" · ");
    if (item.review) text.title = item.review;
    meta.append(text);
  }
  for (const tag of tags) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-chip";
    chip.textContent = `#${tag}`;
    chip.title = `Filter by #${tag}`;
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      tagFilter = tagFilter === tag ? "" : tag;
      render();
    });
    meta.append(chip);
  }
  return meta;
}

function fillSelect(el: HTMLSelectElement, allLabel: string, values: string[], selected: string, prefix = ""): void {
  el.innerHTML = "";
  el.append(new Option(allLabel, ""));
  for (const value of values) el.append(new Option(`${prefix}${value}`, value));
  el.value = selected;
}

/** Tag and list filters only list what exists on the current shelf tab, and hide when there is nothing to pick. */
function renderOrganiseFilters(): void {
  const items = tabItems();
  const tags = [...new Set(items.flatMap((i) => i.tags ?? []))].sort();
  const lists = [...new Set(items.map((i) => i.list).filter((l): l is string => Boolean(l)))].sort();
  if (!tags.includes(tagFilter)) tagFilter = "";
  if (!lists.includes(listFilter)) listFilter = "";
  fillSelect(tagFilterEl, "All tags", tags, tagFilter, "#");
  fillSelect(listFilterEl, "All lists", lists, listFilter);
  tagFilterEl.hidden = tags.length === 0;
  listFilterEl.hidden = lists.length === 0;
  organiseRowEl.hidden = tags.length === 0 && lists.length === 0;
}

function render(): void {
  const items = filteredItems();
  const tabCount = tabItems().length;

  countEl.textContent = `${tabCount} saved`;
  listEl.innerHTML = "";

  filtersEl.hidden = activeTab !== "media";
  tabsInputRowEl.hidden = activeTab !== "tabs";

  const labels = doneLabels();
  statusFilterEl.options[1].textContent = labels.todo;
  statusFilterEl.options[3].textContent = labels.done;
  statusFilterEl.value = statusFilter;
  renderOrganiseFilters();
  sortEl.value = sortBy;

  savePageBtnEl.textContent =
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
    li.classList.toggle("done", Boolean(item.done));
    li.dataset.id = item.id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.id = item.id;

    const typeIconEl = createLeadingEl(item);

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

    const meta = createItemMeta(item);
    if (meta) body.append(meta);

    li.append(typeIconEl, body, createRowActions(item), checkbox);

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
        showStatus(last.lastKeepResult.message, last.lastKeepResult.isError, 2000);
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

function showSaveResult(
  base: string,
  keep: KeepSyncResult | undefined
): void {
  // Reading the stored result clears it, so the next popup open doesn't repeat this message.
  void sendToBackground({ action: "getLastKeepResult" }).catch(() => undefined);
  if (!keep || keep.status === "disabled") {
    showStatus(`${base}.`);
  } else if (keep.status === "synced") {
    showStatus(`${base}, added to Keep.`);
  } else if (keep.status === "duplicate") {
    showStatus(`${base}, already in Keep.`);
  } else {
    showStatus(`${base}, but not added to Keep: ${keep.error ?? "unknown error"}`, true, 6000);
  }
}

function setSaveButtonBusy(busy: boolean): void {
  savePageBtnEl.disabled = busy;
  savePageBtnEl.textContent = busy
    ? "Saving…"
    : activeTab === "books" ? "Save book"
    : activeTab === "tabs" ? "Save tab"
    : "Save media";
}

async function saveCurrentPage(): Promise<void> {
  setSaveButtonBusy(true);
  try {
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
      pageResponse = await requestPageData(tab.id);
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

    const keep = "keep" in saveResponse ? saveResponse.keep : undefined;
    if ("duplicate" in saveResponse && saveResponse.duplicate) {
      showSaveResult("Already saved", keep);
    } else {
      await loadItems();
      const similar = "similar" in saveResponse ? saveResponse.similar?.[0] : undefined;
      showSaveResult(similar ? `Saved (similar to "${similar}", see Settings > Duplicates)` : "Saved", keep);
    }
  } finally {
    setSaveButtonBusy(false);
  }
}

async function saveTabInput(): Promise<void> {
  const value = tabInputEl.value.trim();
  if (!value) {
    showStatus("Type a URL or note first.", true);
    tabInputEl.focus();
    return;
  }

  const item = isHttpUrl(value) ? linkItem(value) : noteItem(value);

  try {
    const response = await sendToBackground({ action: "save", item });
    if (!response?.ok) {
      showStatus(response?.error ?? "Failed to save.", true);
      return;
    }
    const keep = "keep" in response ? response.keep : undefined;
    if ("duplicate" in response && response.duplicate) {
      showSaveResult("Already saved", keep);
    } else {
      tabInputEl.value = "";
      await loadItems();
      showSaveResult("Saved", keep);
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
    const keep = "keep" in response ? response.keep : undefined;
    if ("duplicate" in response && response.duplicate) {
      showSaveResult("Tab already saved", keep);
    } else {
      await loadItems();
      showSaveResult("Tab saved", keep);
    }
  } catch (err) {
    showStatus(err instanceof Error ? err.message : "Failed to save tab.", true);
  }
}

async function updateItemFields(
  id: string,
  changes: EditableFields & UserFields & { done?: boolean }
): Promise<string | undefined> {
  try {
    const response = await sendToBackground({ action: "update", id, changes });
    if (!response.ok) return response.error;
    if ("items" in response) {
      allItems = response.items;
      render();
    }
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : "Could not update item.";
  }
}

async function syncToKeep(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    showStatus("Select items to sync to Keep.", true);
    return;
  }
  syncSelectedEl.disabled = true;
  showStatus(`Adding ${ids.length} item${ids.length === 1 ? "" : "s"} to Keep…`, false, 120000);
  try {
    const response = await sendToBackground({ action: "syncKeep", ids });
    // Reading the stored result clears it, so the next popup open doesn't repeat this message.
    void sendToBackground({ action: "getLastKeepResult" }).catch(() => undefined);
    if (!response.ok) {
      showStatus(response.error, true);
      return;
    }
    if (!("items" in response)) return;
    allItems = response.items;
    render();
    const failed = response.failed ?? 0;
    const synced = response.synced ?? 0;
    if (failed === 0) {
      showStatus(`${synced} item${synced === 1 ? "" : "s"} in Keep.`);
    } else {
      const reason = allItems.find((i) => ids.includes(i.id) && i.keepError)?.keepError;
      showStatus(`${synced} in Keep, ${failed} failed${reason ? `: ${reason}` : "."}`, true, 6000);
    }
  } catch (err) {
    showStatus(err instanceof Error ? err.message : "Keep sync failed.", true);
  } finally {
    syncSelectedEl.disabled = false;
  }
}

/* ── Edit dialog ─────────────────────────────────────────── */

type EditFieldSpec = { key: keyof EditableFields; label: string; multiline?: boolean; half?: boolean };

function editFieldsFor(item: SavedItem): EditFieldSpec[] {
  switch (item.type) {
    case "note":
      return [{ key: "body", label: "Note", multiline: true }];
    case "tab":
    case "link":
      return [
        { key: "title", label: "Title" },
        { key: "url", label: "URL" },
      ];
    case "book":
      return [
        { key: "title", label: "Title" },
        { key: "author", label: "Author" },
        { key: "publishedYear", label: "Year", half: true },
        { key: "imdbRating", label: "Rating", half: true },
      ];
    default:
      return [
        { key: "title", label: "Title" },
        { key: "year", label: "Year", half: true },
        { key: "imdbRating", label: "Rating", half: true },
        { key: "durationOrSeasons", label: "Runtime or seasons (e.g. 2h 28m, 3 seasons)" },
      ];
  }
}

function buildEditField(spec: EditFieldSpec, value: string): HTMLElement {
  const label = document.createElement("label");
  label.className = "edit-field";
  label.textContent = spec.label;
  const input = document.createElement(spec.multiline ? "textarea" : "input");
  input.name = spec.key;
  input.value = value;
  if (input instanceof HTMLTextAreaElement) input.rows = 4;
  else input.type = spec.key === "url" ? "url" : "text";
  label.append(input);
  return label;
}

function openEditDialog(item: SavedItem): void {
  editingId = item.id;
  editErrorEl.hidden = true;
  editFieldsEl.innerHTML = "";

  let pendingRow: HTMLElement | null = null;
  for (const spec of editFieldsFor(item)) {
    const value = spec.key === "body" ? (item.body ?? item.title) : (item[spec.key] ?? "");
    const field = buildEditField(spec, value);
    if (!spec.half) {
      editFieldsEl.append(field);
      continue;
    }
    if (!pendingRow) {
      pendingRow = document.createElement("div");
      pendingRow.className = "edit-row";
      editFieldsEl.append(pendingRow);
    }
    pendingRow.append(field);
    if (pendingRow.childElementCount === 2) pendingRow = null;
  }

  appendPersonalFields(item);

  editDialogEl.hidden = false;
  editFieldsEl.querySelector<HTMLElement>("input, textarea")?.focus();
}

function buildSelectField(name: string, label: string, options: Array<[string, string]>, value: string): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "edit-field";
  wrap.textContent = label;
  const select = document.createElement("select");
  select.name = name;
  for (const [optionValue, text] of options) select.append(new Option(text, optionValue));
  select.value = value;
  wrap.append(select);
  return wrap;
}

function buildTextField(name: string, label: string, value: string, type = "text", placeholder = ""): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "edit-field";
  wrap.textContent = label;
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.value = value;
  if (type === "number") input.min = "0";
  if (placeholder) input.placeholder = placeholder;
  wrap.append(input);
  return wrap;
}

function row(...fields: HTMLElement[]): HTMLElement {
  const el = document.createElement("div");
  el.className = "edit-row";
  el.append(...fields);
  return el;
}

function appendPersonalFields(item: SavedItem): void {
  const heading = document.createElement("h3");
  heading.className = "edit-section";
  heading.textContent = "Your shelf";
  editFieldsEl.append(heading);

  if (isTrackable(item)) {
    const statuses: ItemStatus[] = ["plan", "in_progress", "done", "dropped"];
    const ratings: Array<[string, string]> = [["", "No rating"]];
    for (let n = 10; n >= 1; n--) ratings.push([String(n), `${n}/10`]);
    editFieldsEl.append(
      row(
        buildSelectField("status", "Status", statuses.map((s) => [s, statusLabel(s)]), statusOf(item)),
        buildSelectField("myRating", "My rating", ratings, item.myRating ? String(item.myRating) : "")
      ),
      row(
        buildTextField("progressCurrent", item.type === "book" ? "Pages read" : "Episodes done", String(item.progressCurrent ?? ""), "number"),
        buildTextField("progressTotal", item.type === "book" ? "Total pages" : "Total episodes", String(item.progressTotal ?? ""), "number")
      )
    );
  }

  editFieldsEl.append(
    buildTextField("tags", "Tags (comma separated)", (item.tags ?? []).join(", "), "text", "sci-fi, weekend"),
    buildTextField("list", "List", item.list ?? "", "text", "e.g. Weekend watch")
  );

  if (isTrackable(item)) {
    const label = document.createElement("label");
    label.className = "edit-field";
    label.textContent = "Review";
    const area = document.createElement("textarea");
    area.name = "review";
    area.rows = 3;
    area.value = item.review ?? "";
    label.append(area);
    editFieldsEl.append(label);
  }
}

function closeEditDialog(): void {
  editDialogEl.hidden = true;
  editingId = undefined;
}

editFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingId) return;
  const changes: EditableFields & UserFields = {};
  for (const el of editFieldsEl.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")) {
    switch (el.name) {
      case "tags":
        changes.tags = normalizeTags(el.value);
        break;
      case "list":
      case "review":
        changes[el.name] = el.value;
        break;
      case "status":
        changes.status = el.value as ItemStatus;
        break;
      case "myRating":
      case "progressCurrent":
      case "progressTotal":
        changes[el.name] = el.value === "" ? null : Number(el.value);
        break;
      default:
        changes[el.name as keyof EditableFields] = el.value;
    }
  }
  const error = await updateItemFields(editingId, changes);
  if (error) {
    editErrorEl.textContent = error;
    editErrorEl.hidden = false;
    return;
  }
  closeEditDialog();
  showStatus("Updated on your shelf. Your Keep list is unchanged.");
});

document.getElementById("edit-cancel")!.addEventListener("click", closeEditDialog);
editDialogEl.querySelector("[data-edit-dismiss]")!.addEventListener("click", closeEditDialog);

/* ── Duplicates ──────────────────────────────────────────── */

const duplicatesResultEl = document.getElementById("duplicates-result")!;
const DISMISSED_KEY = "keepshelf.dismissedDuplicates";

function groupKey(group: SavedItem[]): string {
  return group.map((i) => i.id).sort().join("|");
}

function dismissedGroups(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function dismissGroup(group: SavedItem[]): void {
  const dismissed = dismissedGroups();
  dismissed.add(groupKey(group));
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
}

function describeDuplicate(item: SavedItem): string {
  const bits = [typeLabel(item.type), item.year ?? item.publishedYear, item.author, statusLabel(statusOf(item))];
  if (item.myRating) bits.push(`★ ${item.myRating}/10`);
  if (item.tags?.length) bits.push(item.tags.map((t) => `#${t}`).join(" "));
  return bits.filter(Boolean).join(" · ");
}

function renderDuplicates(): void {
  const dismissed = dismissedGroups();
  const groups = findDuplicateGroups(allItems).filter((g) => !dismissed.has(groupKey(g)));
  duplicatesResultEl.innerHTML = "";

  if (groups.length === 0) {
    const none = document.createElement("p");
    none.className = "settings-hint";
    none.textContent = "No likely duplicates found.";
    duplicatesResultEl.append(none);
    return;
  }

  for (const group of groups) {
    const card = document.createElement("div");
    card.className = "dup-group";
    const radioName = `keep-${group[0].id}`;
    const keeperId = pickKeeper(group).id;

    for (const item of group) {
      const label = document.createElement("label");
      label.className = "dup-option";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = radioName;
      radio.value = item.id;
      radio.checked = item.id === keeperId;
      const text = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = item.title;
      const detail = document.createElement("small");
      detail.textContent = describeDuplicate(item);
      text.append(title, detail);
      label.append(radio, text);
      card.append(label);
    }

    const actions = document.createElement("div");
    actions.className = "settings-button-row";
    const merge = document.createElement("button");
    merge.type = "button";
    merge.className = "btn btn-primary";
    merge.textContent = "Keep selected, merge rest";
    merge.addEventListener("click", () => {
      const chosen = card.querySelector<HTMLInputElement>(`input[name="${radioName}"]:checked`)?.value ?? keeperId;
      void mergeGroup(chosen, group.filter((i) => i.id !== chosen).map((i) => i.id));
    });
    const keepBoth = document.createElement("button");
    keepBoth.type = "button";
    keepBoth.className = "btn btn-outline";
    keepBoth.textContent = "Not duplicates";
    keepBoth.addEventListener("click", () => {
      dismissGroup(group);
      renderDuplicates();
    });
    actions.append(merge, keepBoth);
    card.append(actions);
    duplicatesResultEl.append(card);
  }
}

async function mergeGroup(keepId: string, removeIds: string[]): Promise<void> {
  try {
    const response = await sendToBackground({ action: "merge", keepId, removeIds });
    if (!response.ok) throw new Error(response.error);
    if ("items" in response) allItems = response.items;
    render();
    renderDuplicates();
    showBackupStatus(`Merged ${removeIds.length + 1} items into one.`);
  } catch (err) {
    showBackupStatus(err instanceof Error ? err.message : "Merge failed.", true);
  }
}

document.getElementById("find-duplicates")!.addEventListener("click", renderDuplicates);

/* ── Backup & import ─────────────────────────────────────── */

const backupStatusTimer: { value: ReturnType<typeof setTimeout> | undefined } = { value: undefined };

function showBackupStatus(msg: string, err = false, ms = 6000): void {
  showSectionStatus(backupSettingsStatusEl, backupSettingsStatusTextEl, backupSettingsStatusIconEl, backupStatusTimer, msg, err, ms);
}

async function exportBackup(): Promise<void> {
  try {
    const response = await sendToBackground({ action: "getAll" });
    if (!response.ok || !("items" in response)) throw new Error("Could not read your shelf.");
    const blob = new Blob([buildBackup(response.items)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keepshelf-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showBackupStatus(`Exported ${response.items.length} item${response.items.length === 1 ? "" : "s"}.`);
  } catch (err) {
    showBackupStatus(err instanceof Error ? err.message : "Export failed.", true);
  }
}

async function importFile(file: File): Promise<void> {
  try {
    const { source, items } = parseImportFile(await file.text(), file.name);
    if (items.length === 0) {
      showBackupStatus(`No items found in this ${source} file.`, true);
      return;
    }
    const response = await sendToBackground({ action: "import", items });
    if (!response.ok) throw new Error(response.error);
    if ("items" in response) {
      allItems = response.items;
      render();
    }
    const added = "added" in response ? response.added ?? 0 : 0;
    const skipped = "skipped" in response ? response.skipped ?? 0 : 0;
    showBackupStatus(
      `Imported ${added} item${added === 1 ? "" : "s"} from ${source}` +
        (skipped ? `; ${skipped} already on your shelf.` : ".")
    );
  } catch (err) {
    showBackupStatus(err instanceof Error ? err.message : "Import failed.", true);
  }
}

document.getElementById("export-backup")!.addEventListener("click", () => void exportBackup());

document.getElementById("import-file-btn")!.addEventListener("click", () => {
  if (isTabView) {
    importFileEl.click();
    return;
  }
  // The popup closes when a file picker opens, so import from a full tab instead.
  void chrome.tabs.create({ url: chrome.runtime.getURL("dist/popup.html?view=settings") });
  window.close();
});

importFileEl.addEventListener("change", () => {
  const file = importFileEl.files?.[0];
  importFileEl.value = "";
  if (file) void importFile(file);
});

/* ── Search, status filter, sort ─────────────────────────── */

searchEl.addEventListener("input", () => {
  searchQuery = searchEl.value;
  render();
});

statusFilterEl.addEventListener("change", () => {
  statusFilter = statusFilterEl.value as StatusFilter;
  localStorage.setItem("keepshelf.status", statusFilter);
  render();
});

tagFilterEl.addEventListener("change", () => {
  tagFilter = tagFilterEl.value;
  render();
});

listFilterEl.addEventListener("change", () => {
  listFilter = listFilterEl.value;
  render();
});

sortEl.addEventListener("change", () => {
  sortBy = sortEl.value as SortBy;
  localStorage.setItem("keepshelf.sort", sortBy);
  render();
});

syncSelectedEl.addEventListener("click", () => void syncToKeep(getSelectedIds()));

shelfTabsEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".shelf-tab");
  if (!btn) return;
  const tab = btn.dataset.tab as "media" | "books" | "tabs" | undefined;
  if (!tab || tab === activeTab) return;
  activeTab = tab;
  activeFilter = "all";
  tagFilter = "";
  listFilter = "";
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
  if (event.key !== "Escape") return;
  if (!confirmDialogEl.hidden) closeConfirmDialog(false);
  else if (!editDialogEl.hidden) closeEditDialog();
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

if (isTabView) {
  document.body.classList.add("in-tab");
  openSettings();
}

void loadItems();
void loadKeepSettings();
