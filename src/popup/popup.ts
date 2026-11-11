import { clipText, ratingScore, formatBookTitlePart, formatDurationOrSeasons, formatItemLine, formatItemsList, formatRatingLabel } from "../shared/format.js";
import { buildBackup, parseImportFile, settingsFromBackupJson } from "../shared/import.js";
import { PREF_CHOICES, collectSettings, describeSettings, type SettingsBackup } from "../shared/settings-backup.js";
import { BOOK_INFO_KEY } from "../shared/book-info-settings.js";
import { REMINDERS_KEY } from "../shared/reminders-settings.js";
import { TMDB_TOKEN_KEY } from "../shared/tmdb-settings.js";

import { listToItems, parseList, planListImport } from "../shared/list-import.js";
import { isHttpUrl, linkItem, noteItem } from "../shared/items.js";
import type { KeepSettings, KeepSyncResult } from "../shared/keep-settings.js";
import { isKeepOn, isLikelyValidKeepNoteId } from "../shared/keep-settings.js";
import { sendToBackground } from "../shared/messaging.js";
import { requestPageData } from "../shared/page-data.js";
import type { EditableFields, ItemStatus, MediaType, SavedItem, UserFields } from "../shared/types.js";
import { allTags, durationText, genreTags, genreText, isEnrichable, needsTmdbInfo, tmdbPosterUrl, totalEpisodes, TMDB_NOTICE } from "../shared/tmdb.js";
import {
  WATCH_MEDIA_TYPES,
  addExampleToSite,
  appliesTo,
  defaultTypesFor,
  patternLines,
  getWatchSites,
  isEnabled,
  isSearchSite,
  learnPattern,
  missingKind,
  normalizeTypes,
  removeWatchSite,
  saveWatchSite,
  WATCH_SITES_KEY,
  siteFromLearned,
  supportedKinds,
  titleFacts,
  watchLinks,
  type Learned,
  type WatchSite,
} from "../shared/watch-sites.js";
import { groupTags } from "../shared/tag-filter.js";
import { createTagPicker } from "./tag-picker.js";
import { OPENLIBRARY_NOTICE, bookCoverUrl, bookRating, isBookItem, needsBookInfo, totalPages } from "../shared/openlibrary.js";
import { renderStats } from "./stats-view.js";
import { findDuplicateGroups, pickKeeper } from "../shared/fuzzy.js";
import { pickCandidates, pickRandom } from "../shared/random-pick.js";
import {
  NO_PICK_FILTERS,
  PICK_LENGTHS,
  activeFilterCount,
  applyPickFilters,
  pickGenres,
  sanitizePickFilters,
  type PickFilters,
  type PickType,
} from "../shared/pick-filters.js";
import { normalizeTags, shouldAskForRating, statusOf } from "../shared/user-data.js";
import { snapshotItems } from "../shared/undo.js";
import {
  DEFAULT_VIEWS,
  START_MODES,
  STATUS_FILTERS,
  defaultStatusFilter,
  effectiveStatusFilter,
  hiddenNote,
  matchesStatusFilter,
  type DefaultView,
  type StartMode,
  type StatusFilter,
} from "../shared/status-view.js";
import { distributeProgress, lastWatched, markSeasonDone, nextToWatch, seasonTotals, statusFromSeasons, stepEpisode, sumProgress, type EpisodeStep } from "../shared/seasons.js";
import {
  COMING_UP_WINDOWS,
  airingWithoutDate,
  comingUp,
  groupByDay,
  regionsFor,
  sanitizeWindow,
  shortDate,
  streamingNote,
  streamingStatuses,
} from "../shared/coming-up.js";

type SortBy = "newest" | "oldest" | "title" | "year" | "rating" | "myrating";

const SORTS: SortBy[] = ["newest", "oldest", "title", "year", "rating", "myrating"];
const SORT_LABELS: Record<SortBy, string> = {
  newest: "Newest",
  oldest: "Oldest",
  title: "Title A–Z",
  year: "Year",
  rating: "Rating",
  myrating: "My rating",
};
// Saved tabs, links and notes have no year, rating or progress, so they only offer what applies to them.
const TAB_SORTS: SortBy[] = ["newest", "oldest", "title"];
const TAB_STATUSES: StatusFilter[] = ["all", "todo", "done"];
function storedChoice<T extends string>(key: string, allowed: T[], fallback: T): T {
  const value = localStorage.getItem(key) as T | null;
  return value && allowed.includes(value) ? value : fallback;
}

/** Whether to open on the default view or where you left off, and what the default view is. Both are kept in this browser. */
let startMode = storedChoice<StartMode>("keepshelf.startMode", START_MODES, "fresh");
let defaultView = storedChoice<DefaultView>("keepshelf.defaultView", DEFAULT_VIEWS, "hide");
const remembering = startMode === "remember";
const TYPE_CHIPS: Array<MediaType | "all"> = ["all", "movie", "series", "anime"];

let allItems: SavedItem[] = [];
/** False until the first load of the shelf finishes. */
let shelfLoaded = false;
let activeTab: "media" | "books" | "tabs" = remembering ? storedChoice("keepshelf.tab", ["media", "books", "tabs"], "media") : "media";
let activeFilter: MediaType | "all" = remembering && activeTab === "media" ? storedChoice("keepshelf.type", TYPE_CHIPS, "all") : "all";
let searchQuery = "";
let tmdbConfigured = false;
/** Sites the user added in Settings; each gets a "Watch" button on titles it can link to. */
let watchSites: WatchSite[] = [];
let bookInfoEnabled = false;
let tagFilter = "";
let listFilter = remembering ? (localStorage.getItem("keepshelf.list") ?? "") : "";
let statusFilter = remembering
  ? storedChoice<StatusFilter>("keepshelf.status", STATUS_FILTERS, defaultStatusFilter(defaultView))
  : defaultStatusFilter(defaultView);
let sortBy = storedChoice<SortBy>("keepshelf.sort", SORTS, "newest");
let keepSettings: KeepSettings = { mediaEnabled: false, booksEnabled: false, tabsEnabled: false };
let statusTimer: ReturnType<typeof setTimeout> | undefined;
const isTabView = new URLSearchParams(location.search).get("view") === "settings";

const appView = document.getElementById("app-view")!;
const settingsView = document.getElementById("settings-view")!;
const statsView = document.getElementById("stats-view")!;
const upcomingView = document.getElementById("upcoming-view")!;
const upcomingBodyEl = document.getElementById("upcoming-body")!;
const upcomingWindowEl = document.getElementById("upcoming-window")!;
const upcomingFooterEl = document.getElementById("upcoming-footer")!;
const listEl = document.getElementById("list")!;
const emptyEl = document.getElementById("empty")!;
const emptyHeadingEl = document.getElementById("empty-heading")!;
const emptyBodyEl = document.getElementById("empty-body")!;
const emptyHintsEl = document.getElementById("empty-hints")!;
const filterEmptyEl = document.getElementById("filter-empty")!;
const filterEmptyTextEl = filterEmptyEl.querySelector("p")!;
const hiddenNoteEl = document.getElementById("hidden-note")!;
const hiddenNoteTextEl = document.getElementById("hidden-note-text")!;
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
const pickRandomBtnEl = document.getElementById("pick-random") as HTMLButtonElement;
const organiseRowEl = document.getElementById("organise-row")!;
const moreFiltersEl = document.getElementById("more-filters")!;
const toggleFiltersEl = document.getElementById("toggle-filters") as HTMLButtonElement;
const copySelectedEl = document.getElementById("copy-selected") as HTMLButtonElement;
const deleteSelectedEl = document.getElementById("delete-selected") as HTMLButtonElement;
const tagFilterEl = document.getElementById("tag-filter") as HTMLButtonElement;
const tagPicker = createTagPicker(tagFilterEl, (tag) => {
  tagFilter = tag;
  render();
});
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
const keepSummaryEl = document.getElementById("keep-summary")!;
const tmdbSummaryEl = document.getElementById("tmdb-summary")!;
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

  // Measure at natural size first, then fit it into whichever side of the anchor has more room.
  itemTooltipEl.style.maxHeight = "";
  itemTooltipEl.style.paddingBottom = "";
  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = itemTooltipEl.getBoundingClientRect();

  const gap = 6;
  const margin = 8;
  const spaceBelow = window.innerHeight - anchorRect.bottom - gap - margin;
  const spaceAbove = anchorRect.top - gap - margin;
  const below = tooltipRect.height <= spaceBelow || spaceBelow >= spaceAbove;
  let room = Math.max(40, below ? spaceBelow : spaceAbove);
  if (tooltipRect.height > room) {
    // Cut on a whole line so no text is sliced in half: 16px lines, 2px border and 8px top padding.
    // Overflow clips at the padding edge, so the bottom padding goes too or it would show half a line.
    const lines = Math.floor((room - 10) / 16);
    if (lines >= 1) room = 10 + lines * 16;
  }
  const height = Math.min(tooltipRect.height, room);
  if (tooltipRect.height > room) {
    itemTooltipEl.style.maxHeight = `${Math.floor(room)}px`;
    itemTooltipEl.style.paddingBottom = "0";
  }

  let top = below ? anchorRect.bottom + gap : anchorRect.top - height - gap;
  top = Math.max(margin, top);
  let left = anchorRect.left;

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

mainEl.addEventListener("scroll", () => cancelRowHover(), { passive: true });
document.addEventListener("pointerdown", () => cancelRowHover(), true);

function tabItems(): SavedItem[] {
  if (activeTab === "books") return allItems.filter((i) => i.type === "book");
  if (activeTab === "tabs") return allItems.filter((i) => i.type === "tab" || i.type === "link" || i.type === "note");
  return allItems.filter((i) => i.type !== "book" && i.type !== "tab" && i.type !== "link" && i.type !== "note");
}

function searchText(item: SavedItem): string {
  return [formatItemLine(item), item.subtitle, item.genre, item.author, item.url, item.body, item.review, item.list, genreText(item), ...genreTags(item), ...(item.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function yearOf(item: SavedItem): number {
  const year = parseInt(item.year ?? item.publishedYear ?? "", 10);
  return Number.isNaN(year) ? -1 : year;
}

function availableSorts(): SortBy[] {
  return activeTab === "tabs" ? TAB_SORTS : SORTS;
}

function availableStatuses(): StatusFilter[] {
  return activeTab === "tabs" ? TAB_STATUSES : STATUS_FILTERS;
}

/** What is actually applied: a choice made on another shelf that doesn't exist here falls back, without being forgotten. */
function effectiveSort(): SortBy {
  return availableSorts().includes(sortBy) ? sortBy : "newest";
}

function effectiveStatus(): StatusFilter {
  return effectiveStatusFilter(statusFilter, availableStatuses());
}

function sortItems(items: SavedItem[]): SavedItem[] {
  const sorted = [...items];
  switch (effectiveSort()) {
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

function filteredItems(options: { ignoreStatus?: boolean } = {}): SavedItem[] {
  let items = tabItems();
  if (activeTab === "media" && activeFilter !== "all") {
    items = items.filter((i) => i.type === activeFilter);
  }
  const status = effectiveStatus();
  if (!options.ignoreStatus) items = items.filter((i) => matchesStatusFilter(statusOf(i), status));
  if (tagFilter) items = items.filter((i) => allTags(i).includes(tagFilter));
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

function doneLabels(): { todo: string; notDone: string; done: string; markDone: string; markTodo: string } {
  if (activeTab === "books") {
    return { todo: "To read", notDone: "Not read", done: "Read", markDone: "Mark as read", markTodo: "Mark as not read" };
  }
  if (activeTab === "tabs") {
    return { todo: "To do", notDone: "Not done", done: "Done", markDone: "Mark as done", markTodo: "Mark as not done" };
  }
  return { todo: "To watch", notDone: "Not watched", done: "Watched", markDone: "Mark as watched", markTodo: "Mark as not watched" };
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
  const duration = durationText(item);
  if (duration) {
    parts.push(formatDurationOrSeasons(duration));
  }
  const rating = formatRatingLabel(item);
  if (rating) parts.push(rating);
  return parts.join(" | ");
}

const UNDO_MS = 8000;

/** Adds (or clears) the Undo button next to a toast's text. Only one Undo exists per toast at a time. */
function setToastUndo(textEl: HTMLElement, onUndo?: () => void | Promise<void>): void {
  const holder = textEl.parentElement!;
  holder.querySelector(".toast-action")?.remove();
  if (!onUndo) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "toast-action";
  button.textContent = "Undo";
  button.addEventListener("click", () => {
    button.disabled = true;
    void onUndo();
  });
  holder.append(button);
}

/** Puts back what a delete or merge removed, then reports the result. */
async function undoRemoval(restored: SavedItem[], label: string, report: (msg: string, err?: boolean) => void): Promise<void> {
  try {
    const response = await sendToBackground({ action: "restore", items: restored });
    if (!response.ok) throw new Error(response.error);
    if ("items" in response) allItems = response.items;
    render();
    renderDuplicates();
    report(label);
  } catch (err) {
    report(err instanceof Error ? err.message : "Undo failed.", true);
  }
}

function showStatus(message: string, isError = false, durationMs = 2500, onUndo?: () => void | Promise<void>): void {
  if (statusTimer) clearTimeout(statusTimer);
  statusTextEl.textContent = message;
  setToastUndo(statusTextEl, onUndo);
  statusEl.hidden = false;
  statusEl.classList.toggle("error", isError);
  statusTimer = setTimeout(() => {
    statusEl.hidden = true;
    setToastUndo(statusTextEl);
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
  durationMs = 3500,
  onUndo?: () => void | Promise<void>
): void {
  if (timerRef.value) clearTimeout(timerRef.value);
  textEl.textContent = message;
  setToastUndo(textEl, onUndo);
  iconEl.textContent = isError ? "error" : "check_circle";
  el.hidden = false;
  el.classList.toggle("error", isError);
  timerRef.value = setTimeout(() => {
    el.hidden = true;
    setToastUndo(textEl);
  }, durationMs);
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

function openStats(): void {
  renderStats(document.getElementById("stats-body")!, allItems, {
    showTooltip: showItemTooltip,
    hideTooltip: hideItemTooltip,
  });
  appView.hidden = true;
  statsView.hidden = false;
}

function closeStats(): void {
  hideItemTooltip();
  statsView.hidden = true;
  appView.hidden = false;
}

/* ── Coming up ───────────────────────────────────────────── */

/** What the line under the list says; set after a manual check. */
let upcomingNote = "";

/** Where to look for a movie's streaming date: the browser's own country first, then the US. */
const userRegions = regionsFor(navigator.language);

/** How many days ahead Coming up looks. A streaming date is often further away than two weeks, so it can be widened. */
const UPCOMING_DAYS_KEY = "keepshelf.upcomingDays";
let upcomingDays = (() => {
  try {
    return sanitizeWindow(localStorage.getItem(UPCOMING_DAYS_KEY));
  } catch {
    return sanitizeWindow(undefined);
  }
})();

/** A shelf row without the details and actions: just the title, an optional note and the date on the right. */
function upcomingRow(item: SavedItem, label: string, extra?: string, tip?: string, faint = false): HTMLLIElement {
  const { li, typeIconEl, body } = createRowShell(item, false);
  const note = document.createElement("div");
  note.className = "item-facts";
  note.textContent = [typeLabel(item.type), extra].filter(Boolean).join(" · ");
  body.append(note);
  const when = document.createElement("span");
  when.className = faint ? "up-label is-faint" : "up-label";
  when.textContent = label;
  if (tip) when.title = tip;
  li.append(typeIconEl, body, when);
  li.tabIndex = 0;
  li.addEventListener("click", () => showDetails(item, "info"));
  li.addEventListener("keydown", (e) => {
    if (e.target === li && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      showDetails(item, "info");
    }
  });
  return li;
}

/** A section heading with its count in a smaller, lighter number right after the name. */
function setSummary(summary: HTMLElement, label: string, count: number): void {
  const number = document.createElement("span");
  number.className = "up-count";
  number.textContent = String(count);
  summary.replaceChildren(label, number);
}

/** An empty list the rows of one group go into. */
function upcomingList(): HTMLUListElement {
  const ul = document.createElement("ul");
  ul.className = "list";
  return ul;
}

/** Draws what is airing or releasing soon, by day, and the shows that have no date yet. `checking` says dates are being looked up. */
function renderUpcoming(checking = false): void {
  const now = Date.now();
  const groups = groupByDay(comingUp(allItems, now, upcomingDays, userRegions));
  const missing = tmdbConfigured ? airingWithoutDate(allItems, now) : [];
  upcomingBodyEl.replaceChildren();

  const windowRow = document.createElement("div");
  windowRow.className = "filters";
  windowRow.setAttribute("role", "group");
  windowRow.setAttribute("aria-label", "How far ahead to look");

  for (const option of COMING_UP_WINDOWS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `filter${option.days === upcomingDays ? " active" : ""}`;
    chip.textContent = option.label;
    chip.setAttribute("aria-pressed", String(option.days === upcomingDays));
    chip.addEventListener("click", () => {
      upcomingDays = option.days;
      try {
        localStorage.setItem(UPCOMING_DAYS_KEY, String(upcomingDays));
      } catch {
        /* the choice just won't be remembered */
      }
      renderUpcoming(false);
    });
    windowRow.append(chip);
  }
  // Outside the scrolling list, so it stays put like the footer.
  upcomingWindowEl.replaceChildren(windowRow);

  if (groups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "up-empty";
    const heading = document.createElement("strong");
    const detail = document.createElement("span");
    if (!tmdbConfigured) {
      heading.textContent = "Add a TMDB token to see dates";
      detail.textContent = "Air and release dates come from TMDB. Add your token in Settings, then fetch info for your shelf.";
    } else if (checking) {
      heading.textContent = "Checking for dates…";
    } else if (missing.length > 0) {
      heading.textContent = `Nothing dated in the next ${upcomingDays} days`;
      detail.textContent = `${missing.length} airing title${missing.length === 1 ? " has" : "s have"} no date on TMDB yet. They are listed below.`;
    } else {
      heading.textContent = `Nothing in the next ${upcomingDays} days`;
      detail.textContent = "Only titles you haven't finished are listed, and only when TMDB has a date for them.";
    }
    empty.append(heading, detail);
    upcomingBodyEl.append(empty);
  }

  for (const group of groups) {
    const heading = document.createElement("h2");
    heading.className = `up-group${group.days <= 1 ? " is-soon" : ""}`;
    heading.textContent = group.heading;
    if (group.days > 1) {
      const away = document.createElement("span");
      away.className = "up-away";
      away.textContent = `in ${group.days} days`;
      heading.append(away);
    }
    const list = upcomingList();
    upcomingBodyEl.append(heading, list);
    for (const { item, label, region } of group.entries) {
      if (label === "streaming") {
        list.append(upcomingRow(item, "Streaming", undefined, `Streaming and online release${region ? ` (${region})` : ""}`));
      } else if (label === "release") {
        // A movie still to reach streaming says when, right under its title.
        list.append(upcomingRow(item, "Release", streamingNote(item, now, userRegions)));
      } else {
        list.append(upcomingRow(item, label));
      }
    }
  }

  if (missing.length > 0) {
    const details = document.createElement("details");
    details.className = "up-nodate";
    // When nothing is dated, this is the whole answer, so it starts open.
    details.open = groups.length === 0;
    const summary = document.createElement("summary");
    setSummary(summary, "No date yet", missing.length);
    summary.title = "Still airing, but TMDB has no next episode date yet. A long-running show often has none until the episode is close.";
    details.append(summary);
    const missingList = upcomingList();
    for (const item of missing) missingList.append(upcomingRow(item, "No date", undefined, undefined, true));
    details.append(missingList);
    upcomingBodyEl.append(details);
  }

  // A movie already in the dated list above doesn't need a second row here.
  const listed = new Set(groups.flatMap((g) => g.entries.map((e) => e.item.id)));
  const movies = tmdbConfigured ? streamingStatuses(allItems, now, userRegions, upcomingDays).filter((m) => !listed.has(m.item.id)) : [];
  if (movies.length > 0) {
    const details = document.createElement("details");
    details.className = "up-nodate";
    // With no streaming dates in the list above, this is the explanation, so it starts open.
    details.open = !groups.some((g) => g.entries.some((e) => e.label === "streaming"));
    const summary = document.createElement("summary");
    setSummary(summary, "Movies", movies.length);
    summary.title = "Where each movie you haven't watched stands on streaming. It reaches the list above when its date is inside the window.";
    details.append(summary);
    const movieList = upcomingList();
    details.append(movieList);
    for (const { item, state, date, region } of movies) {
      const tip = region ? `Streaming and online release (${region})` : undefined;
      if (state === "since") movieList.append(upcomingRow(item, date ? `Since ${shortDate(date)}` : "Streaming", undefined, tip));
      else if (state === "later") movieList.append(upcomingRow(item, date ? shortDate(date) : "Later", undefined, tip));
      else if (state === "none") movieList.append(upcomingRow(item, "No date", undefined, undefined, true));
      else movieList.append(upcomingRow(item, "Not checked", undefined, undefined, true));
    }
    upcomingBodyEl.append(details);
  }

  // The footer stays put at the bottom, however short the list is.
  upcomingFooterEl.replaceChildren();
  upcomingFooterEl.hidden = !tmdbConfigured;
  if (tmdbConfigured) {
    const note = document.createElement("span");
    note.className = "up-note";
    note.textContent = upcomingNote;
    const check = document.createElement("button");
    check.type = "button";
    check.className = "up-check";
    check.disabled = checking;
    check.textContent = checking ? "Checking…" : "Check for new dates";
    check.addEventListener("click", () => void checkUpcomingDates());
    upcomingFooterEl.append(note, check);
  }
}

/** Looks up dates right now for titles that could have a new one, ignoring the once-a-week limit. */
async function checkUpcomingDates(): Promise<void> {
  upcomingNote = "";
  renderUpcoming(true);
  try {
    const response = await sendToBackground({ action: "refreshDates", force: true });
    if (!response.ok) throw new Error(response.error);
    if ("items" in response) allItems = response.items;
    const left = airingWithoutDate(allItems, Date.now()).length;
    upcomingNote = `Checked just now.${left ? ` ${left} still ${left === 1 ? "has" : "have"} no date on TMDB.` : ""}`;
  } catch (err) {
    upcomingNote = `Couldn't check: ${err instanceof Error ? err.message.replace(/\.$/, "") : "something went wrong"}.`;
  }
  if (!upcomingView.hidden) renderUpcoming(false);
  render();
}

function openUpcoming(): void {
  appView.hidden = true;
  upcomingView.hidden = false;
  upcomingNote = "";
  renderUpcoming(tmdbConfigured);
  if (!tmdbConfigured) return;
  // Titles you haven't watched for a while may have new dates: look them up quietly, then redraw.
  void sendToBackground({ action: "refreshDates" })
    .then((response) => {
      if (response.ok && "items" in response) allItems = response.items;
    })
    .catch(() => undefined)
    .finally(() => {
      if (!upcomingView.hidden) renderUpcoming(false);
      render();
    });
}

function closeUpcoming(): void {
  upcomingView.hidden = true;
  appView.hidden = false;
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
      "Paste a URL or write a note in the box above, or click <strong>Save tab</strong> at the top to save the current page.";
    emptyHintsEl.innerHTML = `
      <div class="source-chip">
        <span class="material-symbols-outlined">tab</span>
        Save tab
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

function createLeadingEl(item: SavedItem, coverSize: "S" | "M" = "S"): HTMLElement {
  const imageUrl = item.imageUrl ?? tmdbPosterUrl(item) ?? bookCoverUrl(item, coverSize);
  if (!imageUrl) return createTypeIconEl(item.type);
  const img = document.createElement("img");
  img.className = "item-thumb";
  img.src = imageUrl;
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

/** More watch links than this on one row would crowd it, so the row shows a single button for the card instead. */
const MAX_ROW_WATCH_BUTTONS = 2;

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
      () => void toggleDone(item),
      item.done ? "is-done pinned" : ""
    )
  );

  // For movies and series the Watch buttons and the detail card (which has "Open page") replace this.
  if (item.type === "book" && isHttpUrl(item.sourceUrl ?? "")) {
    actions.append(createRowAction("open_in_new", "Open source page", () => void chrome.tabs.create({ url: item.sourceUrl })));
  }

  const step = episodeStep(item);
  if (step) {
    actions.append(createRowAction("exposure_plus_1", `Mark ${step.label} as watched`, () => void watchedNextEpisode(item)));
  }

  const links = watchLinks(item, watchSites);
  if (links.length <= MAX_ROW_WATCH_BUTTONS) {
    for (const link of links) {
      actions.append(
        createRowAction(link.search ? "search" : "play_circle", `${link.search ? "Search" : "Watch"} on ${link.host}`, () => void chrome.tabs.create({ url: link.url }))
      );
    }
  } else {
    // Too many to fit in a row: one button opens the card, which lists them all.
    actions.append(createRowAction("play_circle", `Watch or search on ${links.length} sites`, () => showDetails(item, "info")));
  }

  actions.append(createRowAction("edit", "Edit", () => openEditDialog(item)));
  return actions;
}

function isTrackable(item: SavedItem): boolean {
  return item.type !== "tab" && item.type !== "link" && item.type !== "note";
}

/** Movies are watched in one go, so only series, anime and books have progress. */
function tracksProgress(item: SavedItem): boolean {
  return item.type === "series" || item.type === "anime" || item.type === "book";
}

function progressText(item: SavedItem): string {
  if (!tracksProgress(item)) return "";
  // Only once you start tracking, so a fresh row isn't cluttered with "0/62".
  if (item.progressCurrent === undefined && statusOf(item) !== "in_progress") return "";
  const total = item.type === "book" ? totalPages(item) : totalEpisodes(item);
  const current = item.progressCurrent ?? 0;
  const overall = `${item.type === "book" ? "p." : "ep."} ${total !== undefined ? `${current}/${total}` : current}`;
  // With seasons tracked, say where you are first: "S2 E5 (12/37)".
  const where = item.type === "book" ? undefined : lastWatched(item.seasonProgress);
  return where ? `${where} (${total !== undefined ? `${current}/${total}` : current})` : overall;
}

const MAX_CHIPS = 3;
const HOVER_DELAY_MS = 350;

/**
 * The row tooltip is anchored to a row, so it must go away whenever that row can disappear or the user moves
 * on: a redraw replaces the rows, a click can open a dialog, and the old row's mouseleave never fires once
 * it has been replaced. One shared timer lets all of those cancel it.
 */
let rowHoverTimer: ReturnType<typeof setTimeout> | undefined;

function cancelRowHover(): void {
  clearTimeout(rowHoverTimer);
  rowHoverTimer = undefined;
  hideItemTooltip();
}

function anyDialogOpen(): boolean {
  return [confirmDialogEl, editDialogEl, pickDialogEl, rateDialogEl].some((dialog) => !dialog.hidden);
}
const TOOLTIP_OVERVIEW_MAX = 320;
const TOOLTIP_REVIEW_MAX = 200;

/** What the row tooltip says: the full line if anything is cut off, then the description, then your review. */
function hoverText(item: SavedItem, li: HTMLElement): string {
  const parts: string[] = [];
  const cutOff = [".item-title", ".item-facts"].some((sel) => {
    const el = li.querySelector<HTMLElement>(sel);
    return el ? isTextTruncated(el) : false;
  });
  if (cutOff) parts.push(formatItemLine(item));
  // Long descriptions are clipped so the tooltip stays small enough to fit inside the popup.
  const description = item.tmdb?.overview ?? item.bookInfo?.description;
  if (description) parts.push(clipText(description, TOOLTIP_OVERVIEW_MAX));
  if (item.review) parts.push(`Your review: ${clipText(item.review, TOOLTIP_REVIEW_MAX)}`);
  return parts.join("\n\n");
}

/** The small Movie / Series / Anime tag next to the title. A poster hides the type icon, so say what it is. */
function createTypeBadge(item: SavedItem): HTMLElement | undefined {
  if (activeTab !== "media" || !isTrackable(item)) return undefined;
  const badge = document.createElement("span");
  badge.className = `type-badge type-${item.type}`;
  badge.textContent = typeLabel(item.type);
  return badge;
}

/** Line 2: the facts about the title itself, such as "2h 28m | IMDb 8.8 · TMDB 8.4 · PG-13". Short, so it never needs cropping. */
function factsText(item: SavedItem): string {
  const parts = [itemSubtitle(item)];
  if (isTrackable(item)) {
    if (item.tmdb?.rating) parts.push(`TMDB ${item.tmdb.rating}`);
    if (item.tmdb?.certification) parts.push(item.tmdb.certification);
    if (item.bookInfo?.pages) parts.push(`${item.bookInfo.pages} pages`);
    const olRating = bookRating(item.bookInfo);
    if (olRating) parts.push(`OL ${olRating.toFixed(1)}`);
  }
  return parts.filter(Boolean).join(" · ");
}

/** Line 3, first half: genres. A short line reads better than a chip each; the full set still works as tags in the filter. */
function genreParts(item: SavedItem): string[] {
  if (!isTrackable(item)) return [];
  const genres = genreText(item).split(/[,/|]/).map((g) => g.trim()).filter(Boolean).slice(0, 3);
  return genres.length ? [genres.join(" / ")] : [];
}

/** Line 3, second half: your own data, such as "In progress · ep. 12/37 · ★ 9 · Weekend list". */
function personalParts(item: SavedItem): string[] {
  const status = statusOf(item);
  const parts: string[] = [];
  if (isTrackable(item) && (status === "in_progress" || status === "dropped")) parts.push(statusLabel(status));
  const progress = progressText(item);
  if (progress) parts.push(progress);
  if (item.myRating) parts.push(`★ ${item.myRating}`);
  if (item.list) parts.push(item.list);
  return parts;
}

function textPart(text: string, className: string, title?: string): HTMLElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  if (title) span.title = title;
  return span;
}

/**
 * Up to two lines under the title. The facts line is short and truncates only in extreme cases (a long URL).
 * The details line wraps instead of cropping, so nothing is ever cut off.
 */
/**
 * The row every list uses: type icon or poster, then the title with its type badge. The shelf adds its details,
 * actions and tick box to it; other screens add only what they need, so a title looks the same everywhere.
 */
function createRowShell(item: SavedItem, withBadge = true): { li: HTMLLIElement; typeIconEl: HTMLElement; body: HTMLDivElement } {
  const li = document.createElement("li");
  li.className = "list-item";
  li.classList.toggle("done", Boolean(item.done));
  li.dataset.id = item.id;

  const typeIconEl = createLeadingEl(item);
  typeIconEl.addEventListener("mouseenter", () => {
    showItemTooltip(typeLabel(item.type), typeIconEl);
  });
  typeIconEl.addEventListener("mouseleave", hideItemTooltip);

  const body = document.createElement("div");
  body.className = "item-body";

  const titleRow = document.createElement("div");
  titleRow.className = "item-title-row";
  const title = document.createElement("h3");
  title.className = "item-title";
  title.textContent = itemTitle(item);
  titleRow.append(title);
  const badge = withBadge ? createTypeBadge(item) : undefined;
  if (badge) titleRow.append(badge);
  body.append(titleRow);

  return { li, typeIconEl, body };
}

function createItemLines(item: SavedItem): HTMLElement[] {
  const lines: HTMLElement[] = [];

  const facts = factsText(item);
  if (facts) {
    const line = document.createElement("div");
    line.className = "item-facts";
    line.textContent = facts;
    lines.push(line);
  }

  const genres = genreParts(item);
  const personal = personalParts(item);
  const tags = item.tags ?? [];
  if (genres.length || personal.length || tags.length) {
    const line = document.createElement("div");
    line.className = "item-details";
    // The "·" between parts belongs to the end of the part before it, joined by a non-breaking space, so a
    // wrapped line can never start with a stray dot.
    const detailParts = [
      ...genres.map((text) => ({ text, className: "item-part item-genres" })),
      ...personal.map((text) => ({ text, className: "item-part item-personal" })),
    ];
    detailParts.forEach(({ text, className }, i) => {
      const part = textPart(text, className);
      if (i < detailParts.length - 1) part.append(textPart("\u00A0·", "item-dot"));
      line.append(part);
    });
    for (const tag of tags.slice(0, MAX_CHIPS)) {
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
      line.append(chip);
    }
    if (tags.length > MAX_CHIPS) {
      line.append(textPart(`+${tags.length - MAX_CHIPS}`, "item-part-more", tags.slice(MAX_CHIPS).map((t) => `#${t}`).join(" ")));
    }
    lines.push(line);
  }
  return lines;
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
  const everyTag = new Set(items.flatMap((i) => allTags(i)));
  const lists = [...new Set(items.map((i) => i.list).filter((l): l is string => Boolean(l)))].sort();
  // Before the shelf has loaded there is nothing to check against, and a remembered list would be wiped by mistake.
  if (shelfLoaded) {
    if (!everyTag.has(tagFilter)) tagFilter = "";
    if (!lists.includes(listFilter)) listFilter = "";
  }
  // The picker lists every tag, scrolls, and can be searched, so nothing is hidden or capped.
  tagPicker.setOptions(groupTags(items), tagFilter);
  fillSelect(listFilterEl, "All lists", lists, listFilter);
  const tags = everyTag;
  tagFilterEl.hidden = tags.size === 0;
  listFilterEl.hidden = lists.length === 0;
  organiseRowEl.hidden = tags.size === 0 && lists.length === 0;
}

function fillOptions(select: HTMLSelectElement, entries: Array<[string, string]>, value: string): void {
  const same =
    select.options.length === entries.length &&
    entries.every(([v, text], i) => select.options[i].value === v && select.options[i].textContent === text);
  if (!same) select.replaceChildren(...entries.map(([v, text]) => new Option(text, v)));
  select.value = value;
}

function render(): void {
  cancelRowHover();
  const items = filteredItems();
  const tabCount = tabItems().length;

  // The count lives on each tab, so the header stays free for the actions.
  const isBook = (i: SavedItem) => i.type === "book";
  const isTabLike = (i: SavedItem) => i.type === "tab" || i.type === "link" || i.type === "note";
  const counts = {
    media: allItems.filter((i) => !isBook(i) && !isTabLike(i)).length,
    books: allItems.filter(isBook).length,
    tabs: allItems.filter(isTabLike).length,
  };
  for (const [tab, n] of Object.entries(counts)) {
    const el = shelfTabsEl.querySelector<HTMLElement>(`[data-count="${tab}"]`);
    if (el) el.textContent = n ? String(n) : "";
  }
  listEl.innerHTML = "";

  filtersEl.hidden = activeTab !== "media";
  tabsInputRowEl.hidden = activeTab !== "tabs";

  const labels = doneLabels();
  const statusText: Record<StatusFilter, string> = {
    all: "All",
    pending: labels.notDone,
    todo: labels.todo,
    progress: "In progress",
    done: labels.done,
    dropped: "Dropped",
  };
  fillOptions(statusFilterEl, availableStatuses().map((v) => [v, statusText[v]]), effectiveStatus());
  renderOrganiseFilters();
  fillOptions(sortEl, availableSorts().map((v) => [v, SORT_LABELS[v]]), effectiveSort());
  // Picking something to watch or read doesn't apply to bookmarks.
  pickRandomBtnEl.hidden = activeTab === "tabs";
  updateFiltersToggle();
  updateSelectionUi();

  savePageBtnEl.textContent =
    activeTab === "books" ? "Save book" :
    activeTab === "tabs" ? "Save tab" :
    "Save media";

  // The default view hides watched items; say how many, and offer the way back.
  const hiddenCount = statusFilter === "pending" ? filteredItems({ ignoreStatus: true }).length - items.length : 0;
  hiddenNoteEl.hidden = hiddenCount <= 0;
  hiddenNoteTextEl.textContent = hiddenNote(hiddenCount, activeTab);
  filterEmptyTextEl.textContent =
    items.length === 0 && hiddenCount > 0
      ? `Nothing left to ${activeTab === "books" ? "read" : activeTab === "tabs" ? "do" : "watch"}. Tap "Show all" to see the rest.`
      : "No items for this filter.";

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
    const { li, typeIconEl, body } = createRowShell(item);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.id = item.id;

    body.append(...createItemLines(item));

    li.append(typeIconEl, body, createRowActions(item), checkbox);

    // Rest the pointer on a row and it describes itself, so you don't have to open the item.
    li.addEventListener("mouseenter", () => {
      clearTimeout(rowHoverTimer);
      rowHoverTimer = setTimeout(() => {
        if (anyDialogOpen()) return;
        const text = hoverText(item, li);
        if (text) showItemTooltip(text, li);
      }, HOVER_DELAY_MS);
    });
    li.addEventListener("mouseleave", cancelRowHover);

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

      // Tapping a row shows everything about it. Only the tick box selects.
      if (!isOpenable) showDetails(item, "info");
    });
    li.tabIndex = 0;
    li.addEventListener("keydown", (e) => {
      if (e.target === li && (e.key === "Enter" || e.key === " ") && !isOpenable) {
        e.preventDefault();
        showDetails(item, "info");
      }
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
  shelfLoaded = true;
  render();
}

function linkedText(noteId: string | undefined, noteUrl: string | undefined): string {
  if (isLikelyValidKeepNoteId(noteId)) return "Linked";
  if (noteUrl) return "URL looks incomplete. Paste the full Keep link.";
  return "Not linked";
}

/** The sync button only appears when the Keep list for the tab you are on is switched on, and something is ticked. */
function updateSyncButton(): void {
  syncSelectedEl.hidden = !isKeepOn(activeTab, keepSettings) || getSelectedIds().length === 0;
}

/** The buttons that act on ticked rows only appear while something is ticked, which keeps the header quiet. */
function updateSelectionUi(): void {
  const any = getSelectedIds().length > 0;
  copySelectedEl.hidden = !any;
  deleteSelectedEl.hidden = !any;
  updateSyncButton();
}

/** The filter button shows a dot while the list is narrowed or re-sorted, since the controls are tucked away. */
function updateFiltersToggle(): void {
  const active = effectiveStatus() !== "all" || effectiveSort() !== "newest" || Boolean(tagFilter) || Boolean(listFilter);
  toggleFiltersEl.classList.toggle("has-dot", active);
  toggleFiltersEl.title = active ? "Filters and sorting (in use)" : "Filters and sorting";
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

  // The card header says at a glance how many lists are linked and on.
  const active = [
    [keepSettings.mediaEnabled, keepSettings.mediaNoteId],
    [keepSettings.booksEnabled, keepSettings.booksNoteId],
    [keepSettings.tabsEnabled, keepSettings.tabsNoteId],
  ].filter(([on, id]) => on && isLikelyValidKeepNoteId(id as string | undefined)).length;
  keepSummaryEl.textContent = active ? `${active} of 3 on` : "Not set up";
  keepSummaryEl.classList.toggle("is-ok", active > 0);
  updateSyncButton();
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
  setSaveButtonBusy(true);
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
  } finally {
    setSaveButtonBusy(false);
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

/** Fields with the same `group` share a row; `wide` ones take more of it. */
type EditFieldSpec = { key: keyof EditableFields; label: string; multiline?: boolean; group?: string; wide?: boolean };

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
        { key: "publishedYear", label: "Year", group: "facts" },
        { key: "imdbRating", label: "Rating", group: "facts" },
      ];
    default:
      return [
        { key: "title", label: "Title" },
        { key: "year", label: "Year", group: "facts" },
        { key: "imdbRating", label: "Rating", group: "facts" },
        { key: "durationOrSeasons", label: "Runtime / seasons", group: "facts", wide: true },
      ];
  }
}

function buildEditField(spec: EditFieldSpec, value: string): HTMLElement {
  const label = document.createElement("label");
  label.className = spec.wide ? "edit-field edit-field-wide" : "edit-field";
  label.textContent = spec.label;
  const input = document.createElement(spec.multiline ? "textarea" : "input");
  input.name = spec.key;
  if (spec.key === "durationOrSeasons") input.placeholder = "2h 28m or 3 seasons";
  input.value = value;
  if (input instanceof HTMLTextAreaElement) input.rows = 4;
  else input.type = spec.key === "url" ? "url" : "text";
  label.append(input);
  return label;
}

function openEditDialog(item: SavedItem): void {
  cancelRowHover();
  editingId = item.id;
  editErrorEl.hidden = true;
  editFieldsEl.innerHTML = "";

  const groups = new Map<string, HTMLElement>();
  for (const spec of editFieldsFor(item)) {
    const value = spec.key === "body" ? (item.body ?? item.title) : (item[spec.key] ?? "");
    const field = buildEditField(spec, value);
    if (!spec.group) {
      editFieldsEl.append(field);
      continue;
    }
    let groupRow = groups.get(spec.group);
    if (!groupRow) {
      groupRow = document.createElement("div");
      groupRow.className = "edit-row";
      groups.set(spec.group, groupRow);
      editFieldsEl.append(groupRow);
    }
    groupRow.append(field);
  }

  appendPersonalFields(item);

  editDialogEl.hidden = false;
  editFieldsEl.scrollTop = 0;
  updateEditScrollHint();
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

function buildHint(text: string): HTMLElement {
  const hint = document.createElement("p");
  hint.className = "edit-hint";
  hint.textContent = text;
  return hint;
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

  // With seasons tracked, "Total episodes" shares a row with List further down, to save a line.
  let totalField: HTMLElement | undefined;
  if (isTrackable(item)) {
    const statuses: ItemStatus[] = ["plan", "in_progress", "done", "dropped"];
    const ratings: Array<[string, string]> = [["", "No rating"]];
    for (let n = 10; n >= 1; n--) ratings.push([String(n), `${n}/10`]);
    editFieldsEl.append(
      row(
        buildSelectField("status", "Status", statuses.map((s) => [s, statusLabel(s)]), statusOf(item)),
        buildSelectField("myRating", "My rating", ratings, item.myRating ? String(item.myRating) : "")
      )
    );
    if (tracksProgress(item) && item.type !== "book" && seasonTotals(item)) {
      editFieldsEl.append(buildSeasonBlock(item));
      totalField = buildTextField("progressTotal", "Total episodes", String(item.progressTotal ?? ""), "number", autoTotalLabel(item));
    } else if (tracksProgress(item)) {
      editFieldsEl.append(
        row(
          buildTextField("progressCurrent", item.type === "book" ? "Pages read" : "Episodes done", String(item.progressCurrent ?? ""), "number"),
          buildTextField(
            "progressTotal",
            item.type === "book" ? "Total pages" : "Total episodes",
            String(item.progressTotal ?? ""),
            "number",
            // Left empty, the total comes from TMDB or the page automatically.
            autoTotalLabel(item)
          )
        )
      );
    }
  }

  editFieldsEl.append(buildTextField("tags", "Tags (comma separated)", (item.tags ?? []).join(", "), "text", "weekend, rewatch"));
  const genres = genreTags(item);
  if (genres.length) editFieldsEl.append(buildHint(`Genres already work as tags: ${genres.join(", ")}`));
  const listField = buildTextField("list", "List", item.list ?? "", "text", "e.g. Weekend watch");
  editFieldsEl.append(totalField ? row(totalField, listField) : listField);

  if (isTrackable(item)) {
    const label = document.createElement("label");
    label.className = "edit-field";
    label.textContent = "Review";
    const area = document.createElement("textarea");
    area.name = "review";
    area.rows = 2;
    area.placeholder = "What did you think?";
    area.value = item.review ?? "";
    label.append(area);
    editFieldsEl.append(label);
    editFieldsEl.append(buildTmdbBlock(item.id));
    editFieldsEl.append(buildBookBlock(item.id));
  }
}

/** One number box per season, with a button that fills a season in. Changing any box updates the status to match. */
function buildSeasonBlock(item: SavedItem): HTMLElement {
  const totals = seasonTotals(item)!;
  const start =
    item.seasonProgress ?? ((item.progressCurrent ?? 0) > 0 ? distributeProgress(item.progressCurrent ?? 0, totals) : []);
  const block = document.createElement("div");
  block.className = "season-block";
  const title = document.createElement("span");
  title.className = "season-title";
  title.textContent = "Episodes watched per season";
  const grid = document.createElement("div");
  grid.className = "season-grid";
  const hint = buildHint("");
  const inputs: HTMLInputElement[] = [];

  const values = () => inputs.map((el) => (el.value === "" ? 0 : Number(el.value)));
  const refresh = (changed: boolean) => {
    const progress = values();
    const next = nextToWatch(progress, totals);
    hint.textContent = next ? `Next up: S${next.season} E${next.episode}` : "All episodes watched.";
    if (!changed) return;
    grid.dataset.dirty = "1";
    const statusEl = editFieldsEl.querySelector<HTMLSelectElement>("select[name=status]");
    if (statusEl && progress.every((n) => Number.isFinite(n))) {
      statusEl.value = statusFromSeasons(progress, totals, statusEl.value as ItemStatus);
    }
  };

  totals.forEach((total, i) => {
    const cell = document.createElement("div");
    cell.className = "season-cell";
    cell.title = `Season ${i + 1}: ${total} episode${total === 1 ? "" : "s"}`;
    const label = document.createElement("label");
    const name = document.createElement("span");
    name.className = "season-name";
    name.textContent = `S${i + 1}`;
    const input = document.createElement("input");
    input.type = "number";
    input.name = `season-${i + 1}`;
    input.min = "0";
    input.max = String(total);
    input.value = start[i] ? String(start[i]) : "";
    input.placeholder = "0";
    input.setAttribute("aria-label", `Episodes watched in season ${i + 1} of ${total}`);
    input.addEventListener("input", () => refresh(true));
    const of = document.createElement("span");
    of.className = "season-total";
    of.textContent = `/${total}`;
    label.append(name, input, of);
    const done = document.createElement("button");
    done.type = "button";
    done.className = "season-done";
    done.textContent = "✓";
    done.title = `Mark season ${i + 1} as watched`;
    done.setAttribute("aria-label", done.title);
    done.addEventListener("click", () => {
      const filled = markSeasonDone(values(), totals, i + 1);
      inputs.forEach((el, n) => { el.value = filled[n] ? String(filled[n]) : ""; });
      refresh(true);
    });
    cell.append(label, done);
    inputs.push(input);
    grid.append(cell);
  });
  refresh(false);
  block.append(title, grid, hint);
  return block;
}

/** The placeholder in the Total field when you leave it empty: what Open Library, TMDB or the page says. */
function autoTotalLabel(item: SavedItem): string {
  const auto = item.type === "book" ? item.bookInfo?.pages : totalEpisodes({ ...item, progressTotal: undefined });
  return auto === undefined ? "" : `${auto} (auto)`;
}

function bookSummary(item: SavedItem): string {
  const info = item.bookInfo;
  if (!info) return "";
  const bits = [
    info.subjects.slice(0, 3).join(", "),
    info.pages ? `${info.pages} pages` : "",
    bookRating(info) ? `OL ${bookRating(info)!.toFixed(1)}/5 (${(info.ratingsCount ?? 0).toLocaleString()} ratings)` : "",
    info.firstPublishYear ? `first published ${info.firstPublishYear}` : "",
  ];
  return bits.filter(Boolean).join(" · ");
}

/** Read-only Open Library details with Refresh and Remove match, for books. Re-rendered in place like the TMDB block. */
function buildBookBlock(itemId: string): HTMLElement {
  const block = document.createElement("div");
  block.className = "edit-tmdb";

  const paint = (): void => {
    const item = allItems.find((i) => i.id === itemId);
    block.replaceChildren();
    if (!item || !isBookItem(item)) return;

    const heading = document.createElement("h3");
    heading.className = "edit-section";
    heading.textContent = "From Open Library";
    block.append(heading);

    const text = document.createElement("p");
    text.className = "edit-tmdb-text";
    text.textContent = item.bookInfo
      ? bookSummary(item) || "Matched on Open Library."
      : !bookInfoEnabled
        ? "Turn on book info in Settings to fetch pages, genres, a cover and more."
        : item.bookInfoOptOut
          ? "Match removed. Fetch again to look it up."
          : "No match found yet.";
    block.append(text);
    if (item.bookInfo?.description) {
      const description = document.createElement("p");
      description.className = "edit-tmdb-overview";
      description.textContent = item.bookInfo.description;
      block.append(description);
    }

    const actions = document.createElement("div");
    actions.className = "edit-tmdb-actions";
    const fetchBtn = document.createElement("button");
    fetchBtn.type = "button";
    fetchBtn.className = "btn btn-outline";
    fetchBtn.textContent = item.bookInfo ? "Refresh" : "Fetch info";
    fetchBtn.disabled = !bookInfoEnabled;
    fetchBtn.addEventListener("click", async () => {
      fetchBtn.disabled = true;
      fetchBtn.textContent = "Fetching…";
      try {
        const response = await sendToBackground({ action: "enrichBooks", ids: [itemId], force: true });
        if (!response.ok) showStatus(response.error, true, 5000);
        else if ("items" in response) {
          allItems = response.items;
          render();
          if (!response.enriched) showStatus("No match found on Open Library.", true);
        }
      } catch (err) {
        showStatus(err instanceof Error ? err.message : "Could not reach Open Library.", true);
      }
      paint();
    });
    actions.append(fetchBtn);

    if (item.bookInfo) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-outline btn-sm";
      removeBtn.textContent = "Wrong match? Remove";
      removeBtn.addEventListener("click", async () => {
        const response = await sendToBackground({ action: "removeBookMatch", id: itemId });
        if (response.ok && "items" in response) {
          allItems = response.items;
          render();
        }
        paint();
      });
      actions.append(removeBtn);
    }
    block.append(actions);
  };

  paint();
  return block;
}

function tmdbSummary(item: SavedItem): string {
  const info = item.tmdb;
  if (!info) return "";
  const bits = [
    info.genres.join(", "),
    info.rating ? `TMDB ${info.rating}/10 (${(info.votes ?? 0).toLocaleString()} votes)` : "",
    info.certification,
    info.runtimeMinutes ? `${info.runtimeMinutes} min` : "",
    info.seasons ? `${info.seasons} season${info.seasons === 1 ? "" : "s"}` : "",
    info.status,
  ];
  return bits.filter(Boolean).join(" · ");
}

/** Read-only TMDB details with Refresh and Remove match. Re-rendered in place so unsaved edits above are kept. */
function buildTmdbBlock(itemId: string): HTMLElement {
  const block = document.createElement("div");
  block.className = "edit-tmdb";

  const paint = (): void => {
    const item = allItems.find((i) => i.id === itemId);
    block.replaceChildren();
    if (!item || !isEnrichable(item)) return;

    const heading = document.createElement("h3");
    heading.className = "edit-section";
    heading.textContent = "From TMDB";
    block.append(heading);

    const text = document.createElement("p");
    text.className = "edit-tmdb-text";
    text.textContent = item.tmdb
      ? tmdbSummary(item) || "Matched on TMDB."
      : !tmdbConfigured
        ? "Add a TMDB token in Settings to fetch genres, ratings and more."
        : item.tmdbOptOut
          ? "Match removed. Fetch again to look it up."
          : "No match found yet.";
    block.append(text);

    const actions = document.createElement("div");
    actions.className = "edit-tmdb-actions";
    const fetchBtn = document.createElement("button");
    fetchBtn.type = "button";
    fetchBtn.className = "btn btn-outline btn-sm";
    fetchBtn.textContent = item.tmdb ? "Refresh" : "Fetch info";
    fetchBtn.disabled = !tmdbConfigured;
    fetchBtn.addEventListener("click", async () => {
      fetchBtn.disabled = true;
      fetchBtn.textContent = "Fetching…";
      try {
        const response = await sendToBackground({ action: "enrich", ids: [itemId], force: true });
        if (!response.ok) showStatus(response.error, true, 5000);
        else if ("items" in response) {
          allItems = response.items;
          render();
          if (!response.enriched) showStatus("No match found on TMDB.", true);
        }
      } catch (err) {
        showStatus(err instanceof Error ? err.message : "Could not reach TMDB.", true);
      }
      paint();
    });
    actions.append(fetchBtn);

    if (item.tmdb) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-outline";
      removeBtn.textContent = "Wrong match? Remove";
      removeBtn.addEventListener("click", async () => {
        const response = await sendToBackground({ action: "removeTmdbMatch", id: itemId });
        if (response.ok && "items" in response) {
          allItems = response.items;
          render();
        }
        paint();
      });
      actions.append(removeBtn);
    }
    block.append(actions);
  };

  paint();
  return block;
}

/** A soft fade at the bottom while more of the form is hidden below, so the missing scrollbar isn't missed. */
function updateEditScrollHint(): void {
  const more = editFieldsEl.scrollTop + editFieldsEl.clientHeight < editFieldsEl.scrollHeight - 2;
  editFieldsEl.classList.toggle("has-more", more);
}
editFieldsEl.addEventListener("scroll", updateEditScrollHint);

function closeEditDialog(): void {
  editDialogEl.hidden = true;
  editingId = undefined;
}

editFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingId) return;
  const changes: EditableFields & UserFields = {};
  for (const el of editFieldsEl.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")) {
    if (el.name.startsWith("season-")) continue;
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
  // Season numbers are sent only if you touched them, so saving an unrelated edit never converts an item.
  const seasonGrid = editFieldsEl.querySelector<HTMLElement>(".season-grid");
  if (seasonGrid?.dataset.dirty === "1") {
    const boxes = [...seasonGrid.querySelectorAll<HTMLInputElement>("input")];
    changes.seasonProgress = boxes.every((el) => el.value === "") ? null : boxes.map((el) => (el.value === "" ? 0 : Number(el.value)));
    if (changes.seasonProgress === null) changes.progressCurrent = null;
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

/* ── Rate when finished ──────────────────────────────────── */

const ASK_RATING_KEY = "keepshelf.askRating";
const rateDialogEl = document.getElementById("rate-dialog")!;
const rateFormEl = document.getElementById("rate-form") as HTMLFormElement;
const rateKickerEl = document.getElementById("rate-kicker")!;
const rateTitleEl = document.getElementById("rate-title")!;
const rateScaleEl = document.getElementById("rate-scale")!;
const rateCaptionEl = document.getElementById("rate-caption")!;
const rateReviewEl = document.getElementById("rate-review") as HTMLTextAreaElement;
const prefAskRatingEl = document.getElementById("pref-ask-rating") as HTMLInputElement;
const generalSummaryEl = document.getElementById("general-summary")!;
let ratingForId: string | undefined;
let ratingValue: number | undefined;

/** On unless the user switched it off in Settings. */
function askRatingEnabled(): boolean {
  try {
    return localStorage.getItem(ASK_RATING_KEY) !== "off";
  } catch {
    return true;
  }
}

function renderPrefs(): void {
  const on = askRatingEnabled();
  prefAskRatingEl.checked = on;
  generalSummaryEl.textContent = on ? "Rating prompt on" : "Rating prompt off";
  generalSummaryEl.classList.toggle("is-ok", on);
}

const prefStartEl = document.getElementById("pref-start") as HTMLSelectElement;
const prefDefaultViewEl = document.getElementById("pref-default-view") as HTMLSelectElement;
prefStartEl.value = startMode;
prefDefaultViewEl.value = defaultView;

prefStartEl.addEventListener("change", () => {
  startMode = prefStartEl.value as StartMode;
  try {
    localStorage.setItem("keepshelf.startMode", startMode);
  } catch {
    /* the choice just won't be remembered */
  }
  // Switching to "remember" starts from exactly what you are looking at now.
  rememberView();
});

prefDefaultViewEl.addEventListener("change", () => {
  defaultView = prefDefaultViewEl.value as DefaultView;
  try {
    localStorage.setItem("keepshelf.defaultView", defaultView);
  } catch {
    /* the choice just won't be remembered */
  }
});

prefAskRatingEl.addEventListener("change", () => {
  try {
    localStorage.setItem(ASK_RATING_KEY, prefAskRatingEl.checked ? "on" : "off");
  } catch {
    /* the choice just won't be remembered */
  }
  renderPrefs();
});

function paintRatingScale(): void {
  rateScaleEl.querySelectorAll<HTMLButtonElement>(".rate-btn").forEach((btn) => {
    const selected = Number(btn.dataset.value) === ratingValue;
    btn.classList.toggle("selected", selected);
    btn.setAttribute("aria-checked", String(selected));
  });
  rateCaptionEl.textContent = ratingValue ? `★ ${ratingValue} / 10` : "Tap a number to rate it";
}

function selectRating(value: number): void {
  // Tapping the chosen number again clears it, so a rating can be taken back.
  ratingValue = ratingValue === value ? undefined : value;
  paintRatingScale();
}

for (let n = 1; n <= 10; n++) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "rate-btn";
  btn.dataset.value = String(n);
  btn.textContent = String(n);
  btn.setAttribute("role", "radio");
  btn.setAttribute("aria-label", `${n} out of 10`);
  btn.addEventListener("click", () => selectRating(n));
  rateScaleEl.append(btn);
}

function openRateDialog(item: SavedItem): void {
  cancelRowHover();
  ratingForId = item.id;
  ratingValue = item.myRating;
  rateKickerEl.textContent = item.type === "book" ? "Finished reading" : "Finished watching";
  rateTitleEl.textContent = itemTitle(item);
  rateReviewEl.value = item.review ?? "";
  paintRatingScale();
  rateDialogEl.hidden = false;
  // Focus the dialog, not a number: a ringed "1" would look like a rating already chosen.
  // Number keys still work from here, and Tab moves on to the buttons.
  (rateScaleEl.querySelector<HTMLElement>(".rate-btn.selected") ?? rateFormEl).focus();
}

function closeRateDialog(): void {
  rateDialogEl.hidden = true;
  ratingForId = undefined;
  ratingValue = undefined;
}

/** Offers the rating box for an item that was just finished, unless the setting is off. */
function maybeAskRating(id: string): void {
  const item = allItems.find((i) => i.id === id);
  if (item && shouldAskForRating(item, askRatingEnabled())) openRateDialog(item);
}

/** The next episode a +1 would mark as watched, for series and anime that aren't finished. */
function episodeStep(item: SavedItem): EpisodeStep | undefined {
  if (item.type !== "series" && item.type !== "anime") return undefined;
  return stepEpisode(item, totalEpisodes(item));
}

/** One tap: marks the next episode as watched, starts the show if needed, finishes it on the last episode. */
async function watchedNextEpisode(item: SavedItem): Promise<void> {
  const step = episodeStep(item);
  if (!step) return;
  const before = {
    progressCurrent: item.progressCurrent ?? null,
    seasonProgress: item.seasonProgress ?? null,
    status: statusOf(item),
  };
  const error = await updateItemFields(item.id, step.changes);
  if (error) {
    showStatus(error, true);
    return;
  }
  showStatus(`${item.title}: ${step.label} watched`, false, 6000, async () => {
    const undoError = await updateItemFields(item.id, before);
    showStatus(undoError ?? "Undone.", Boolean(undoError));
    refreshOpenCard(item.id);
  });
  refreshOpenCard(item.id);
  if (step.finishes) maybeAskRating(item.id);
}

/** If the item's own card is open, redraws it so its progress and the next episode are current. */
function refreshOpenCard(id: string): void {
  const fresh = allItems.find((i) => i.id === id);
  if (fresh && !pickDialogEl.hidden && pickedId === id && pickPanelEl.classList.contains("is-info")) showDetails(fresh, "info");
}

/** Marks an item finished (or not). Finishing is saved first, so closing the rating box never loses it. */
async function toggleDone(item: SavedItem): Promise<void> {
  const finishing = !item.done;
  const error = await updateItemFields(item.id, { done: finishing });
  if (error) {
    showStatus(error, true);
    return;
  }
  if (finishing) maybeAskRating(item.id);
}

rateFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = ratingForId;
  const item = allItems.find((i) => i.id === id);
  const rating = ratingValue;
  const review = rateReviewEl.value.trim();
  closeRateDialog();
  if (!id || !item) return;
  if (rating === item.myRating && review === (item.review ?? "")) return;
  const error = await updateItemFields(id, { myRating: rating ?? null, review });
  showStatus(error ?? "Saved your rating.", Boolean(error));
});

rateFormEl.addEventListener("keydown", (e) => {
  // 1 to 9 pick that rating and 0 picks 10, unless you are typing a review.
  if (e.target === rateReviewEl || e.ctrlKey || e.metaKey || e.altKey || !/^[0-9]$/.test(e.key)) return;
  e.preventDefault();
  selectRating(e.key === "0" ? 10 : Number(e.key));
});

document.getElementById("rate-skip")!.addEventListener("click", closeRateDialog);
rateDialogEl.querySelector("[data-rate-dismiss]")!.addEventListener("click", closeRateDialog);
renderPrefs();

/* ── TMDB settings ───────────────────────────────────────── */

const tmdbTokenEl = document.getElementById("tmdb-token") as HTMLInputElement;
const tmdbTokenStatusEl = document.getElementById("tmdb-token-status")!;
const tmdbSettingsStatusEl = document.getElementById("tmdb-settings-status")!;
const tmdbSettingsStatusTextEl = document.getElementById("tmdb-settings-status-text")!;
const tmdbSettingsStatusIconEl = document.getElementById("tmdb-settings-status-icon")!;
const tmdbEnrichAllEl = document.getElementById("tmdb-enrich-all") as HTMLButtonElement;
const tmdbStatusTimer: { value: ReturnType<typeof setTimeout> | undefined } = { value: undefined };
document.getElementById("tmdb-notice")!.textContent = TMDB_NOTICE;

function showTmdbStatus(msg: string, err = false, ms = 6000): void {
  showSectionStatus(tmdbSettingsStatusEl, tmdbSettingsStatusTextEl, tmdbSettingsStatusIconEl, tmdbStatusTimer, msg, err, ms);
}

let remindersEnabled = false;
const prefRemindersEl = document.getElementById("pref-reminders") as HTMLInputElement;
const remindersCheckEl = document.getElementById("reminders-check") as HTMLButtonElement;

function renderReminders(): void {
  prefRemindersEl.checked = remindersEnabled;
  // It needs the token to look up dates, but it can always be turned off.
  prefRemindersEl.disabled = !tmdbConfigured && !remindersEnabled;
  remindersCheckEl.disabled = !remindersEnabled;
}

async function loadReminderSettings(): Promise<void> {
  try {
    const response = await sendToBackground({ action: "getReminderSettings" });
    if (response.ok && "reminders" in response) remindersEnabled = response.reminders.enabled;
  } catch {
    /* leave it off */
  }
  renderReminders();
}

prefRemindersEl.addEventListener("change", async () => {
  try {
    const response = await sendToBackground({ action: "setRemindersEnabled", enabled: prefRemindersEl.checked });
    if (!response.ok) throw new Error(response.error);
    if ("reminders" in response) remindersEnabled = response.reminders.enabled;
    showTmdbStatus(remindersEnabled ? "Release reminders are on." : "Release reminders are off.");
  } catch (err) {
    showTmdbStatus(err instanceof Error ? err.message : "Could not change the setting.", true);
  }
  renderReminders();
});

remindersCheckEl.addEventListener("click", async () => {
  remindersCheckEl.disabled = true;
  try {
    const response = await sendToBackground({ action: "checkReminders" });
    if (!response.ok) throw new Error(response.error);
    showTmdbStatus("message" in response ? response.message : "Checked.");
    const refreshed = await sendToBackground({ action: "getAll" });
    if (refreshed.ok && "items" in refreshed) allItems = refreshed.items;
  } catch (err) {
    showTmdbStatus(err instanceof Error ? err.message : "Check failed.", true);
  }
  renderReminders();
});

function renderTmdbConfigured(): void {
  tmdbTokenStatusEl.textContent = tmdbConfigured ? "Token saved" : "Not set";
  tmdbTokenEl.placeholder = tmdbConfigured ? "Saved. Paste to replace" : "API Read Access Token";
  tmdbEnrichAllEl.disabled = !tmdbConfigured;
  tmdbSummaryEl.textContent = tmdbConfigured ? "Token saved" : "Not set";
  tmdbSummaryEl.classList.toggle("is-ok", tmdbConfigured);
  renderReminders();
}

async function loadTmdbSettings(): Promise<void> {
  try {
    const response = await sendToBackground({ action: "getTmdbSettings" });
    if (response.ok && "tmdb" in response) tmdbConfigured = response.tmdb.configured;
  } catch {
    /* leave as not configured */
  }
  renderTmdbConfigured();
}

async function saveTmdbToken(): Promise<void> {
  try {
    const response = await sendToBackground({ action: "setTmdbToken", token: tmdbTokenEl.value });
    if (!response.ok) throw new Error(response.error);
    if ("tmdb" in response) tmdbConfigured = response.tmdb.configured;
    const cleared = tmdbTokenEl.value.trim() === "";
    tmdbTokenEl.value = "";
    renderTmdbConfigured();
    showTmdbStatus(cleared ? "Token removed." : "Token saved. New saves will fetch TMDB info.");
  } catch (err) {
    showTmdbStatus(err instanceof Error ? err.message : "Could not save the token.", true);
  }
}

async function testTmdbToken(): Promise<void> {
  try {
    const typed = tmdbTokenEl.value.trim();
    const response = await sendToBackground({ action: "testTmdb", ...(typed ? { token: typed } : {}) });
    if (!response.ok) throw new Error(response.error);
    showTmdbStatus("message" in response ? response.message : "Connected to TMDB.");
  } catch (err) {
    showTmdbStatus(err instanceof Error ? err.message : "Test failed.", true);
  }
}

async function enrichShelf(): Promise<void> {
  const ids = allItems.filter(needsTmdbInfo).map((i) => i.id);
  if (ids.length === 0) {
    showTmdbStatus("Every movie, series and anime already has TMDB info.");
    return;
  }
  tmdbEnrichAllEl.disabled = true;
  let enriched = 0;
  let unmatched = 0;
  try {
    for (let i = 0; i < ids.length; i += 25) {
      showTmdbStatus(`Fetching info… ${i}/${ids.length}`, false, 120000);
      const response = await sendToBackground({ action: "enrich", ids: ids.slice(i, i + 25) });
      if (!response.ok) throw new Error(response.error);
      if ("items" in response) {
        allItems = response.items;
        enriched += response.enriched ?? 0;
        unmatched += response.unmatched ?? 0;
      }
    }
    render();
    showTmdbStatus(`Added info to ${enriched} item${enriched === 1 ? "" : "s"}` + (unmatched ? `; ${unmatched} had no match.` : "."));
  } catch (err) {
    render();
    showTmdbStatus(err instanceof Error ? err.message : "Fetching info failed.", true);
  } finally {
    tmdbEnrichAllEl.disabled = !tmdbConfigured;
  }
}

document.getElementById("tmdb-save")!.addEventListener("click", () => void saveTmdbToken());
document.getElementById("tmdb-test")!.addEventListener("click", () => void testTmdbToken());
tmdbEnrichAllEl.addEventListener("click", () => void enrichShelf());

/* ── Settings cards: one open at a time ──────────────────── */

const settingsCards = Array.from(document.querySelectorAll<HTMLDetailsElement>("#settings-view details.s-card"));
for (const card of settingsCards) {
  card.addEventListener("toggle", () => {
    if (!card.open) return;
    for (const other of settingsCards) if (other !== card) other.open = false;
    card.scrollIntoView({ block: "nearest" });
  });
}

/* ── Watch sites ─────────────────────────────────────────── */

const watchUrlEls = [document.getElementById("watch-url-1"), document.getElementById("watch-url-2")] as HTMLInputElement[];
const watchItemEls = [document.getElementById("watch-item-1"), document.getElementById("watch-item-2")] as HTMLSelectElement[];
const watchAddEl = document.getElementById("watch-add") as HTMLButtonElement;
const watchListEl = document.getElementById("watch-list")!;
const watchSummaryEl = document.getElementById("watch-summary")!;
const watchStatusEl = document.getElementById("watch-settings-status")!;
const watchStatusTextEl = document.getElementById("watch-settings-status-text")!;
const watchStatusIconEl = document.getElementById("watch-settings-status-icon")!;
const watchStatusTimer: { value: ReturnType<typeof setTimeout> | undefined } = { value: undefined };

function showWatchStatus(msg: string, err = false, ms = 8000): void {
  showSectionStatus(watchStatusEl, watchStatusTextEl, watchStatusIconEl, watchStatusTimer, msg, err, ms);
}

/** Movies, series and anime, with what KeepShelf already knows about each, so the user can say which one a page is for. */
function fillWatchItemPickers(): void {
  const eligible = allItems.filter((i) => titleFacts(i) !== undefined);
  for (const select of watchItemEls) {
    const chosen = select.value;
    select.replaceChildren(new Option("Which title is that page for?", ""));
    for (const item of eligible) {
      const known = item.tmdb ? "TMDB info" : item.sourceUrl.includes("/title/tt") ? "IMDb" : "";
      const label = `${item.title}${item.year ? ` (${item.year})` : ""}${known ? ` · ${known}` : ""}`;
      select.append(new Option(label, item.id));
    }
    select.value = eligible.some((i) => i.id === chosen) ? chosen : "";
  }
}

/** A small form under a site's row for adding a page of the kind it doesn't know yet (a series, say). */
function buildAddKindForm(site: WatchSite, kind: "movie" | "tv", close: () => void): HTMLElement {
  const word = kind === "tv" ? "series" : "movie";
  const form = document.createElement("div");
  form.className = "watch-extra";

  const label = document.createElement("span");
  label.className = "watch-example-label";
  label.textContent = `Paste a ${word} page from ${site.host}`;
  const url = document.createElement("input");
  url.type = "url";
  url.placeholder = "https://…";
  url.autocomplete = "off";
  url.spellcheck = false;
  const select = document.createElement("select");
  select.className = "view-select";
  select.setAttribute("aria-label", `Which ${word} is that page for?`);
  select.append(new Option(`Which ${word} is that page for?`, ""));
  for (const item of allItems) {
    if (titleFacts(item)?.kind !== kind) continue;
    select.append(new Option(`${item.title}${item.year ? ` (${item.year})` : ""}${item.tmdb ? " · TMDB info" : ""}`, item.id));
  }

  const add = document.createElement("button");
  add.type = "button";
  add.className = "btn btn-primary btn-sm";
  add.textContent = "Add";
  add.addEventListener("click", async () => {
    try {
      const facts = titleFacts(allItems.find((i) => i.id === select.value) ?? ({} as SavedItem));
      if (!url.value.trim()) throw new Error(`Paste the address of a ${word} page first.`);
      if (!facts) throw new Error(`Pick which ${word} that page is for.`);
      const learned = learnPattern(url.value, facts);
      if (!learned.ok) throw new Error(learned.error);
      const made = addExampleToSite(site, learned.learned);
      if (!made.ok) throw new Error(made.error);
      watchSites = await saveWatchSite(made.site);
      renderWatchSites();
      render();
      showWatchStatus(`Added ${word} pages for ${site.host}.`);
    } catch (err) {
      showWatchStatus(err instanceof Error ? err.message : "Could not add the page.", true);
    }
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn-outline btn-sm";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", close);

  const buttons = document.createElement("div");
  buttons.className = "watch-extra-buttons";
  buttons.append(add, cancel);
  form.append(label, url, select, buttons);
  return form;
}

function renderWatchSites(): void {
  const on = watchSites.filter(isEnabled).length;
  watchSummaryEl.textContent =
    watchSites.length === 0 ? "None" : on === watchSites.length ? `${watchSites.length} added` : `${on} of ${watchSites.length} on`;
  watchSummaryEl.classList.toggle("is-ok", on > 0);
  watchListEl.replaceChildren(
    ...watchSites.map((site) => {
      const row = document.createElement("li");
      row.className = "watch-row";
      row.classList.toggle("is-off", !isEnabled(site));
      const toggle = document.createElement("label");
      toggle.className = "switch";
      toggle.title = isEnabled(site) ? `Switch ${site.host} off` : `Switch ${site.host} on`;
      const toggleBox = document.createElement("input");
      toggleBox.type = "checkbox";
      toggleBox.checked = isEnabled(site);
      toggleBox.setAttribute("aria-label", `Show buttons for ${site.host}`);
      toggleBox.addEventListener("change", () => void saveSiteEnabled(site, toggleBox.checked));
      const toggleTrack = document.createElement("span");
      toggleTrack.className = "switch-track";
      toggle.append(toggleBox, toggleTrack);
      const text = document.createElement("div");
      text.className = "watch-row-text";
      const host = document.createElement("span");
      host.className = "watch-row-host";
      host.textContent = site.host;
      text.append(host);
      // One line per kind when movies and series use different patterns, so neither is cut off.
      for (const line of patternLines(site)) {
        const pattern = document.createElement("span");
        pattern.className = "watch-row-pattern";
        pattern.textContent = line;
        pattern.title = line;
        text.append(pattern);
      }
      if (isSearchSite(site)) {
        const note = document.createElement("span");
        note.className = "watch-row-note";
        note.textContent = "Opens this site's search for each title.";
        text.append(note);
      }

      const buttons = document.createElement("div");
      buttons.className = "watch-row-buttons";
      const missing = missingKind(site);
      if (missing) {
        const word = missing === "tv" ? "series" : "movie";
        const note = document.createElement("span");
        note.className = "watch-row-note";
        note.textContent = `${missing === "tv" ? "Movies" : "Series"} only so far.`;
        text.append(note);
        const addKind = document.createElement("button");
        addKind.type = "button";
        addKind.className = "btn btn-outline btn-sm";
        addKind.textContent = `Add a ${word} page`;
        addKind.addEventListener("click", () => {
          const existing = row.querySelector(".watch-extra");
          if (existing) {
            existing.remove();
            return;
          }
          row.append(buildAddKindForm(site, missing, () => row.querySelector(".watch-extra")?.remove()));
        });
        buttons.append(addKind);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-outline btn-sm";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => void removeSite(site.host));
      buttons.append(remove);

      // Which kinds of title get this site's button, so an anime site doesn't clutter movies.
      const kinds = document.createElement("div");
      kinds.className = "watch-row-types";
      const kindsLabel = document.createElement("span");
      kindsLabel.textContent = "Show on:";
      kinds.append(kindsLabel);
      const boxes: HTMLInputElement[] = [];
      for (const type of WATCH_MEDIA_TYPES) {
        const label = document.createElement("label");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = appliesTo(site, type);
        box.dataset.type = type;
        boxes.push(box);
        box.addEventListener("change", () => void saveSiteTypes(site, boxes));
        label.append(box, document.createTextNode(type === "anime" ? "Anime" : type === "movie" ? "Movies" : "Series"));
        kinds.append(label);
      }
      row.append(toggle, text, buttons, kinds);
      return row;
    })
  );
}

async function loadWatchSites(): Promise<void> {
  try {
    watchSites = await getWatchSites();
  } catch {
    watchSites = [];
  }
  renderWatchSites();
  render();
}

function learnFromRow(index: number): { ok: true; learned: Learned } | { ok: false; error: string } | undefined {
  const url = watchUrlEls[index].value.trim();
  if (!url) return undefined;
  const item = allItems.find((i) => i.id === watchItemEls[index].value);
  const facts = item ? titleFacts(item) : undefined;
  if (!facts) return { ok: false, error: `Pick which title page ${index + 1} is for.` };
  return learnPattern(url, facts);
}

async function addWatchSite(): Promise<void> {
  watchAddEl.disabled = true;
  try {
    const first = learnFromRow(0);
    if (!first) throw new Error("Paste the address of one title's page first.");
    if (!first.ok) throw new Error(first.error);
    const second = learnFromRow(1);
    if (second && !second.ok) throw new Error(second.error);
    // A site added with an anime as the example starts as anime only; the row's tick boxes change that.
    const exampleType = allItems.find((i) => i.id === watchItemEls[0].value)?.type;
    const made = siteFromLearned(first.learned, second?.ok ? second.learned : undefined, defaultTypesFor(exampleType));
    if (!made.ok) throw new Error(made.error);
    watchSites = await saveWatchSite(made.site);
    for (const el of watchUrlEls) el.value = "";
    for (const el of watchItemEls) el.value = "";
    renderWatchSites();
    render();
    const kinds = supportedKinds(made.site);
    showWatchStatus(
      `Added ${made.site.host}. ` +
        (kinds.length < 2 ? `It will link ${kinds[0] === "movie" ? "movies" : "series"} only, because you gave one kind of page. ` : "") +
        "Titles it can link to now have a play button."
    );
  } catch (err) {
    showWatchStatus(err instanceof Error ? err.message : "Could not add the site.", true);
  } finally {
    watchAddEl.disabled = false;
  }
}

async function saveSiteEnabled(site: WatchSite, enabled: boolean): Promise<void> {
  try {
    watchSites = await saveWatchSite({ ...site, enabled: enabled ? undefined : false });
    renderWatchSites();
    render();
  } catch (err) {
    renderWatchSites();
    showWatchStatus(err instanceof Error ? err.message : "Could not save that.", true);
  }
}

async function saveSiteTypes(site: WatchSite, boxes: HTMLInputElement[]): Promise<void> {
  const checked = boxes.filter((b) => b.checked).map((b) => b.dataset.type as (typeof WATCH_MEDIA_TYPES)[number]);
  if (checked.length === 0) {
    renderWatchSites();
    showWatchStatus("Keep at least one kind ticked, or remove the site.", true);
    return;
  }
  try {
    watchSites = await saveWatchSite({ ...site, types: normalizeTypes(checked) });
    renderWatchSites();
    render();
  } catch (err) {
    renderWatchSites();
    showWatchStatus(err instanceof Error ? err.message : "Could not save that.", true);
  }
}

async function removeSite(host: string): Promise<void> {
  try {
    watchSites = await removeWatchSite(host);
    renderWatchSites();
    render();
    showWatchStatus(`Removed ${host}.`);
  } catch (err) {
    showWatchStatus(err instanceof Error ? err.message : "Could not remove the site.", true);
  }
}

watchAddEl.addEventListener("click", () => void addWatchSite());
document.getElementById("card-watch")!.addEventListener("toggle", (e) => {
  if ((e.target as HTMLDetailsElement).open) fillWatchItemPickers();
});

/* ── Book info settings ──────────────────────────────────── */

const prefBookInfoEl = document.getElementById("pref-book-info") as HTMLInputElement;
const bookInfoSummaryEl = document.getElementById("bookinfo-summary")!;
const bookInfoEnrichAllEl = document.getElementById("bookinfo-enrich-all") as HTMLButtonElement;
const bookInfoSettingsStatusEl = document.getElementById("bookinfo-settings-status")!;
const bookInfoSettingsStatusTextEl = document.getElementById("bookinfo-settings-status-text")!;
const bookInfoSettingsStatusIconEl = document.getElementById("bookinfo-settings-status-icon")!;
const bookInfoStatusTimer: { value: ReturnType<typeof setTimeout> | undefined } = { value: undefined };
document.getElementById("bookinfo-notice")!.textContent = OPENLIBRARY_NOTICE;

function showBookInfoStatus(msg: string, err = false, ms = 6000): void {
  showSectionStatus(bookInfoSettingsStatusEl, bookInfoSettingsStatusTextEl, bookInfoSettingsStatusIconEl, bookInfoStatusTimer, msg, err, ms);
}

function renderBookInfoEnabled(): void {
  prefBookInfoEl.checked = bookInfoEnabled;
  bookInfoSummaryEl.textContent = bookInfoEnabled ? "On" : "Off";
  bookInfoSummaryEl.classList.toggle("is-ok", bookInfoEnabled);
  bookInfoEnrichAllEl.disabled = !bookInfoEnabled;
}

async function loadBookInfoSettings(): Promise<void> {
  try {
    const response = await sendToBackground({ action: "getBookInfoSettings" });
    if (response.ok && "bookInfo" in response) bookInfoEnabled = response.bookInfo.enabled;
  } catch {
    /* leave it off */
  }
  renderBookInfoEnabled();
}

prefBookInfoEl.addEventListener("change", async () => {
  const wanted = prefBookInfoEl.checked;
  try {
    const response = await sendToBackground({ action: "setBookInfoEnabled", enabled: wanted });
    if (!response.ok) throw new Error(response.error);
    if ("bookInfo" in response) bookInfoEnabled = response.bookInfo.enabled;
    showBookInfoStatus(bookInfoEnabled ? "Book info is on. New books will be looked up automatically." : "Book info is off.");
  } catch (err) {
    showBookInfoStatus(err instanceof Error ? err.message : "Could not change the setting.", true);
  }
  renderBookInfoEnabled();
});

/** Books are fetched a few at a time. Open Library allows about one request a second, and each book needs two. */
async function enrichBookShelf(): Promise<void> {
  const ids = allItems.filter((i) => isBookItem(i) && !i.bookInfo && !i.bookInfoOptOut).map((i) => i.id);
  if (ids.length === 0) {
    showBookInfoStatus("Every book already has its info.");
    return;
  }
  bookInfoEnrichAllEl.disabled = true;
  let enriched = 0;
  let unmatched = 0;
  try {
    for (let i = 0; i < ids.length; i += 4) {
      showBookInfoStatus(`Fetching book info… ${i}/${ids.length}`, false, 120000);
      const response = await sendToBackground({ action: "enrichBooks", ids: ids.slice(i, i + 4) });
      if (!response.ok) throw new Error(response.error);
      if ("items" in response) {
        allItems = response.items;
        enriched += response.enriched ?? 0;
        unmatched += response.unmatched ?? 0;
      }
    }
    render();
    showBookInfoStatus(`Added info to ${enriched} book${enriched === 1 ? "" : "s"}` + (unmatched ? `; ${unmatched} had no match.` : "."));
  } catch (err) {
    render();
    showBookInfoStatus(err instanceof Error ? err.message : "Fetching book info failed.", true);
  } finally {
    bookInfoEnrichAllEl.disabled = !bookInfoEnabled;
  }
}

bookInfoEnrichAllEl.addEventListener("click", () => void enrichBookShelf());

/* ── Random pick ─────────────────────────────────────────── */

const pickDialogEl = document.getElementById("pick-dialog")!;
const pickLeadingEl = document.getElementById("pick-leading")!;
const pickTitleEl = document.getElementById("pick-title")!;
const pickDetailEl = document.getElementById("pick-detail")!;
const pickOverviewEl = document.getElementById("pick-overview")!;
const pickStartEl = document.getElementById("pick-start") as HTMLButtonElement;
const pickOpenEl = document.getElementById("pick-open") as HTMLButtonElement;
let pickedId: string | undefined;

const pickChipsEl = document.getElementById("pick-chips")!;
const pickReviewEl = document.getElementById("pick-review")!;
const pickMoreEl = document.getElementById("pick-more") as HTMLButtonElement;
const pickWatchEl = document.getElementById("pick-watch")!;
const pickKickerEl = document.getElementById("pick-heading")!;
const pickTopEl = document.getElementById("pick-top")!;
const pickPanelEl = pickDialogEl.querySelector<HTMLElement>(".pick-panel")!;
const pickActionsEl = document.getElementById("pick-actions")!;
const pickFooterEl = document.getElementById("pick-footer")!;
const pickAgainEl = document.getElementById("pick-again") as HTMLButtonElement;
const pickEditEl = document.getElementById("pick-edit") as HTMLButtonElement;
const pickCloseEl = document.getElementById("pick-close") as HTMLButtonElement;

/** "pick" is the random suggestion; "info" is what opens when you tap a row. Same card, different layout. */
type DetailMode = "pick" | "info";

/** The small labels under an item's title on its card: kind, status, progress, your rating, list and tags. */
function detailChips(item: SavedItem): Array<{ text: string; className: string }> {
  const chips: Array<{ text: string; className: string }> = [];
  if (isTrackable(item)) chips.push({ text: typeLabel(item.type), className: `pick-chip type-${item.type}` });
  chips.push({ text: statusLabel(statusOf(item)), className: "pick-chip" });
  const progress = progressText(item);
  if (progress) chips.push({ text: progress, className: "pick-chip" });
  if (item.myRating) chips.push({ text: `★ ${item.myRating}/10`, className: "pick-chip" });
  if (item.list) chips.push({ text: item.list, className: "pick-chip" });
  for (const tag of item.tags ?? []) chips.push({ text: `#${tag}`, className: "pick-chip pick-chip-tag" });
  return chips;
}

function showDetails(item: SavedItem, mode: DetailMode): void {
  cancelRowHover();
  pickedId = item.id;
  const info = mode === "info";
  // Both cards share one layout (poster beside the facts); the buttons are what differ.
  pickPanelEl.classList.add("is-card");
  pickPanelEl.classList.toggle("is-info", info);
  pickPanelEl.classList.toggle("is-pick", !info);
  pickTopEl.hidden = info;
  pickKickerEl.textContent = "How about this?";
  pickLeadingEl.replaceChildren(createLeadingEl(item, "M"));
  pickTitleEl.textContent = itemTitle(item);
  pickTitleEl.title = itemTitle(item);
  pickDetailEl.textContent = [factsText(item), genreParts(item).join("")].filter(Boolean).join("\n");
  const overview = item.tmdb?.overview ?? item.bookInfo?.description;
  pickOverviewEl.textContent = overview ?? "";
  pickOverviewEl.hidden = !overview;

  // The suggestion doesn't need your tags and review; the item's own card shows everything.
  const chips = detailChips(item).filter((chip) => info || !chip.className.includes("pick-chip-tag"));
  const chipEls: HTMLElement[] = chips.map(({ text, className }) => textPart(text, className));
  // On the item's own card, a small "+ S2 E4" pill among the chips marks the next episode watched: no extra row.
  const step = info ? episodeStep(item) : undefined;
  if (step) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "pick-chip pick-chip-action";
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined";
    icon.textContent = "add";
    add.append(icon, document.createTextNode(step.label));
    add.title = `Mark ${step.label} as watched`;
    add.setAttribute("aria-label", `Mark ${step.label} as watched`);
    add.addEventListener("click", () => void watchedNextEpisode(item));
    // Right after the status and progress chips, before any tags, so it stays next to what it changes.
    const firstTag = chips.findIndex((chip) => chip.className.includes("pick-chip-tag"));
    chipEls.splice(firstTag === -1 ? chipEls.length : firstTag, 0, add);
  }
  pickChipsEl.replaceChildren(...chipEls);
  pickChipsEl.hidden = chipEls.length === 0;
  pickReviewEl.textContent = info && item.review ? item.review : "";
  pickReviewEl.hidden = !(info && item.review);

  const inProgress = statusOf(item) === "in_progress";
  pickStartEl.textContent = inProgress ? "Mark as done" : item.type === "book" ? "Start reading" : "Start watching";
  pickActionsEl.hidden = info;
  pickAgainEl.hidden = info;
  pickEditEl.hidden = !info;
  pickCloseEl.hidden = false;
  // On the suggestion, Start watching is the one strong button; on the item's card, Close is.
  pickCloseEl.className = info ? "btn btn-primary btn-sm" : "btn btn-outline btn-sm";

  pickWatchEl.classList.add("is-compact");
  pickWatchEl.replaceChildren(
    ...watchLinks(item, watchSites).map((link) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = info ? "btn btn-primary btn-sm" : "btn btn-outline btn-sm";
      const label = `${link.search ? "Search" : "Watch"} on ${link.host}`;
      btn.title = label;
      // The icon says what it does, so the host is enough text on the compact card.
      const icon = document.createElement("span");
      icon.className = "material-symbols-outlined btn-icon";
      icon.textContent = link.search ? "search" : "play_circle";
      btn.append(icon, document.createTextNode(link.host));
      btn.setAttribute("aria-label", label);
      btn.addEventListener("click", () => void chrome.tabs.create({ url: link.url }));
      return btn;
    })
  );
  pickWatchEl.hidden = pickWatchEl.childElementCount === 0;

  pickOpenEl.hidden = !isHttpUrl(item.url ?? item.sourceUrl ?? "");
  pickFooterEl.hidden = false;
  pickDialogEl.hidden = false;

  // Long text is cut to a few lines with a More link that opens it out, so the card never needs a scrollbar.
  pickMoreEl.hidden = true;
  pickPanelEl.classList.remove("is-expanded");
  pickPanelEl.classList.add("is-clamped");
  const cutOff = [pickOverviewEl, pickReviewEl].some((el) => !el.hidden && el.scrollHeight > el.clientHeight + 1);
  pickMoreEl.hidden = !cutOff;
  pickMoreEl.textContent = "More";
}

function showPick(item: SavedItem): void {
  showDetails(item, "pick");
}

/* The suggestion's filters: what it may choose from, kept between visits. */

const PICK_FILTERS_KEY = "keepshelf.pickFilters";
const pickFilterToggleEl = document.getElementById("pick-filter-toggle") as HTMLButtonElement;
const pickFilterCountEl = document.getElementById("pick-filter-count")!;
const pickFiltersEl = document.getElementById("pick-filters")!;
const pickTypeEl = document.getElementById("pick-f-type") as HTMLSelectElement;
const pickLengthEl = document.getElementById("pick-f-length") as HTMLSelectElement;
const pickGenreEl = document.getElementById("pick-f-genre") as HTMLSelectElement;
const pickClearEl = document.getElementById("pick-f-clear") as HTMLButtonElement;

function loadPickFilters(): PickFilters {
  try {
    return sanitizePickFilters(JSON.parse(localStorage.getItem(PICK_FILTERS_KEY) ?? "null"));
  } catch {
    return { ...NO_PICK_FILTERS };
  }
}

let pickFilters: PickFilters = loadPickFilters();
let pickFiltersOpen = false;

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Fills the choices from what is on the shelf, shows the current ones, and the count on the button. */
function renderPickFilters(base: SavedItem[]): void {
  const genres = pickGenres(base);
  if (pickFilters.genre && !genres.includes(pickFilters.genre)) genres.push(pickFilters.genre);
  fillOptions(pickTypeEl, [["all", "All types"], ["movie", "Movies"], ["series", "Series"], ["anime", "Anime"]], pickFilters.type);
  fillOptions(pickLengthEl, [["", "Any length"], ...PICK_LENGTHS.map((l): [string, string] => [String(l.minutes), l.label])], pickFilters.maxMinutes ? String(pickFilters.maxMinutes) : "");
  fillOptions(pickGenreEl, [["", "Any genre"], ...genres.map((g): [string, string] => [g, capitalise(g)])], pickFilters.genre ?? "");
  const count = activeFilterCount(pickFilters);
  pickFilterCountEl.textContent = String(count);
  pickFilterCountEl.hidden = count === 0;
  pickClearEl.hidden = count === 0;
  pickFiltersEl.hidden = !(pickFiltersOpen || count > 0);
  pickFilterToggleEl.setAttribute("aria-expanded", String(!pickFiltersEl.hidden));
}

function savePickFilters(): void {
  try {
    localStorage.setItem(PICK_FILTERS_KEY, JSON.stringify(pickFilters));
  } catch {
    /* the filters just won't be remembered */
  }
}

/** The card when the filters leave nothing to pick: say so, and keep the filters in reach. */
function showPickEmpty(): void {
  cancelRowHover();
  pickedId = undefined;
  pickPanelEl.classList.add("is-card", "is-pick");
  pickPanelEl.classList.remove("is-info", "is-clamped", "is-expanded");
  pickTopEl.hidden = false;
  pickKickerEl.textContent = "How about this?";
  pickLeadingEl.replaceChildren(createTypeIconEl("movie"));
  pickTitleEl.textContent = "Nothing matches";
  pickTitleEl.title = "";
  pickDetailEl.textContent = "Try a longer length or another genre, or tap Clear.";
  for (const el of [pickChipsEl, pickOverviewEl, pickMoreEl, pickReviewEl, pickActionsEl, pickWatchEl, pickOpenEl, pickAgainEl, pickEditEl]) {
    el.hidden = true;
  }
  pickCloseEl.hidden = false;
  pickCloseEl.className = "btn btn-outline btn-sm";
  pickFooterEl.hidden = false;
  pickDialogEl.hidden = false;
}

function pickForMe(excludeId?: string, options: { keepCurrent?: boolean } = {}): void {
  const base = filteredItems({ ignoreStatus: true });
  renderPickFilters(base);
  const pool = applyPickFilters(base, pickFilters);
  // Changing a filter shouldn't throw away a suggestion that still fits it.
  if (options.keepCurrent && pickedId && !pickDialogEl.hidden && pickCandidates(pool).some((i) => i.id === pickedId)) return;
  const item = pickRandom(pool, { excludeId });
  if (!item) {
    // Something could be picked without the filters: they are what is in the way, so keep the card open.
    if (activeFilterCount(pickFilters) > 0 && pickRandom(base, { excludeId })) {
      showPickEmpty();
      return;
    }
    showStatus(
      base.length === 0 ? "Nothing here to pick from." : "Nothing left to pick. Everything here is done or dropped.",
      true
    );
    return;
  }
  const nothingPlanned = !pickCandidates(pool).some((i) => statusOf(i) === "plan");
  showPick(item);
  if (nothingPlanned) pickKickerEl.textContent = "Nothing planned, so here's one you started";
}

function onPickFilterChange(): void {
  const maxMinutes = Number(pickLengthEl.value);
  pickFilters = {
    type: pickTypeEl.value as PickType,
    ...(maxMinutes ? { maxMinutes } : {}),
    ...(pickGenreEl.value ? { genre: pickGenreEl.value } : {}),
  };
  savePickFilters();
  pickForMe(undefined, { keepCurrent: true });
}

for (const el of [pickTypeEl, pickLengthEl, pickGenreEl]) el.addEventListener("change", onPickFilterChange);
document.getElementById("pick-f-clear")!.addEventListener("click", () => {
  pickFilters = { ...NO_PICK_FILTERS };
  pickFiltersOpen = false;
  savePickFilters();
  // Fewer filters can only add choices, so the current suggestion stays (unless there was none: "Nothing matches").
  pickForMe(undefined, { keepCurrent: true });
});
pickFilterToggleEl.addEventListener("click", () => {
  pickFiltersOpen = pickFiltersEl.hidden;
  pickFiltersEl.hidden = !pickFiltersOpen;
  pickFilterToggleEl.setAttribute("aria-expanded", String(pickFiltersOpen));
});


function closePick(): void {
  pickDialogEl.hidden = true;
  pickedId = undefined;
}

document.getElementById("pick-random")!.addEventListener("click", () => pickForMe());
document.getElementById("pick-again")!.addEventListener("click", () => pickForMe(pickedId));
pickDialogEl.querySelector("[data-pick-dismiss]")!.addEventListener("click", closePick);
pickCloseEl.addEventListener("click", closePick);
pickMoreEl.addEventListener("click", () => {
  const expanded = pickPanelEl.classList.toggle("is-expanded");
  pickPanelEl.classList.toggle("is-clamped", !expanded);
  pickMoreEl.textContent = expanded ? "Less" : "More";
});
pickEditEl.addEventListener("click", () => {
  const item = allItems.find((i) => i.id === pickedId);
  closePick();
  if (item) openEditDialog(item);
});
pickStartEl.addEventListener("click", async () => {
  const item = allItems.find((i) => i.id === pickedId);
  if (!item) return;
  const next: ItemStatus = statusOf(item) === "in_progress" ? "done" : "in_progress";
  const error = await updateItemFields(item.id, { status: next });
  closePick();
  showStatus(error ?? (next === "done" ? "Marked as done." : "Marked as in progress."), Boolean(error));
  if (!error && next === "done") maybeAskRating(item.id);
});
pickOpenEl.addEventListener("click", () => {
  const item = allItems.find((i) => i.id === pickedId);
  const url = item?.url ?? item?.sourceUrl;
  if (url) void chrome.tabs.create({ url });
});

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
  const snapshot = snapshotItems(allItems, [keepId, ...removeIds]);
  try {
    const response = await sendToBackground({ action: "merge", keepId, removeIds });
    if (!response.ok) throw new Error(response.error);
    if ("items" in response) allItems = response.items;
    render();
    renderDuplicates();
    showBackupStatus(`Merged ${removeIds.length + 1} items into one.`, false, UNDO_MS, () =>
      undoRemoval(snapshot, "Merge undone.", (msg, err) => showBackupStatus(msg, err))
    );
  } catch (err) {
    showBackupStatus(err instanceof Error ? err.message : "Merge failed.", true);
  }
}

document.getElementById("find-duplicates")!.addEventListener("click", renderDuplicates);

/* ── Backup & import ─────────────────────────────────────── */

const backupStatusTimer: { value: ReturnType<typeof setTimeout> | undefined } = { value: undefined };

function showBackupStatus(msg: string, err = false, ms = 6000, onUndo?: () => void | Promise<void>): void {
  showSectionStatus(backupSettingsStatusEl, backupSettingsStatusTextEl, backupSettingsStatusIconEl, backupStatusTimer, msg, err, ms, onUndo);
}

const backupIncludeSettingsEl = document.getElementById("backup-include-settings") as HTMLInputElement;

/** Reads the settings that go into a backup. Everything is checked on the way out. */
async function gatherSettings(): Promise<SettingsBackup | undefined> {
  const stored = await chrome.storage.local.get([TMDB_TOKEN_KEY, WATCH_SITES_KEY, REMINDERS_KEY, BOOK_INFO_KEY]);
  const keep = await sendToBackground({ action: "getKeepSettings" });
  const prefs: Record<string, string | null> = {};
  for (const key of Object.keys(PREF_CHOICES)) prefs[key] = localStorage.getItem(key);
  return collectSettings(
    {
      tmdbToken: stored[TMDB_TOKEN_KEY],
      keep: keep.ok && "settings" in keep ? keep.settings : undefined,
      watchSites: stored[WATCH_SITES_KEY],
      remindersEnabled: stored[REMINDERS_KEY],
      bookInfoEnabled: stored[BOOK_INFO_KEY],
      prefs,
    },
    { includeToken: true }
  );
}

/** "a", "a and b", "a, b and c". */
function joinWords(parts: string[]): string {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Puts a backup's settings in place, then refreshes everything on the page that shows them. */
async function applySettings(settings: SettingsBackup): Promise<void> {
  const ask = async (message: Parameters<typeof sendToBackground>[0]) => {
    const response = await sendToBackground(message);
    if (!response.ok) throw new Error(response.error);
  };
  // The token first: reminders need it.
  if (settings.tmdbToken) await ask({ action: "setTmdbToken", token: settings.tmdbToken });
  if (settings.keep) await ask({ action: "setKeepSettings", settings: settings.keep });
  if (settings.watchSites) await chrome.storage.local.set({ [WATCH_SITES_KEY]: settings.watchSites });
  if (settings.remindersEnabled !== undefined) await ask({ action: "setRemindersEnabled", enabled: settings.remindersEnabled });
  if (settings.bookInfoEnabled !== undefined) await ask({ action: "setBookInfoEnabled", enabled: settings.bookInfoEnabled });
  for (const [key, value] of Object.entries(settings.prefs ?? {})) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* the preference just won't be restored */
    }
  }
  await Promise.all([loadKeepSettings(), loadTmdbSettings(), loadReminderSettings(), loadBookInfoSettings(), loadWatchSites()]);
  renderPrefs();
}

async function exportBackup(): Promise<void> {
  try {
    const response = await sendToBackground({ action: "getAll" });
    if (!response.ok || !("items" in response)) throw new Error("Could not read your shelf.");
    const settings = backupIncludeSettingsEl.checked ? await gatherSettings() : undefined;
    const blob = new Blob([buildBackup(response.items, settings)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keepshelf-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showBackupStatus(
      `Exported ${response.items.length} item${response.items.length === 1 ? "" : "s"}` +
        (settings ? " and your settings." : ".")
    );
  } catch (err) {
    showBackupStatus(err instanceof Error ? err.message : "Export failed.", true);
  }
}

async function importFile(file: File): Promise<void> {
  try {
    const text = await file.text();
    const { source, items } = parseImportFile(text, file.name);
    const settings = source === "KeepShelf backup" ? settingsFromBackupJson(text) : undefined;
    if (items.length === 0 && !settings) {
      showBackupStatus(`No items found in this ${source} file.`, true);
      return;
    }
    const before = new Set(allItems.map((i) => i.id));
    let added = 0;
    let skipped = 0;
    if (items.length > 0) {
      const response = await sendToBackground({ action: "import", items });
      if (!response.ok) throw new Error(response.error);
      if ("items" in response) {
        allItems = response.items;
        render();
      }
      added = "added" in response ? response.added ?? 0 : 0;
      skipped = "skipped" in response ? response.skipped ?? 0 : 0;
    }
    let tail = "";
    if (settings) {
      const restore = await showConfirm({
        title: "Restore your settings?",
        message: `This backup also has ${joinWords(describeSettings(settings))}. Restoring replaces the ones you have now.`,
        confirmLabel: "Restore settings",
        cancelLabel: "Skip",
      });
      if (restore) await applySettings(settings);
      tail = restore ? " Settings restored." : " Settings skipped.";
    }
    const base =
      `Imported ${added} item${added === 1 ? "" : "s"} from ${source}` + (skipped ? `; ${skipped} already on your shelf.` : ".") + tail;
    showBackupStatus(base, false, 120000);
    // Letterboxd and Goodreads files have no posters or genres; a KeepShelf backup already has them.
    const addedIds = allItems.filter((i) => !before.has(i.id)).map((i) => i.id);
    const info = await fetchInfoForNew(addedIds, (progress) => showBackupStatus(`${base} ${progress}`, false, 120000));
    showBackupStatus(base + info);
  } catch (err) {
    showBackupStatus(err instanceof Error ? err.message : "Import failed.", true);
  }
}

/* ── Info for newly added titles ─────────────────────────── */

/**
 * After titles are added, fetches their TMDB info (and Open Library details for books, when that is switched on),
 * a few at a time so progress shows and what is done stays done. Never fails the import: it returns what to say.
 */
async function fetchInfoForNew(ids: string[], report: (progress: string) => void): Promise<string> {
  const added = allItems.filter((i) => ids.includes(i.id));
  const media = tmdbConfigured ? added.filter(needsTmdbInfo).map((i) => i.id) : [];
  const books = bookInfoEnabled ? added.filter(needsBookInfo).map((i) => i.id) : [];
  const total = media.length + books.length;
  if (total === 0) return "";

  let done = 0;
  let enriched = 0;
  let unmatched = 0;
  try {
    for (const [action, list, size] of [["enrich", media, 10], ["enrichBooks", books, 4]] as const) {
      for (let i = 0; i < list.length; i += size) {
        report(`Fetching info… ${done}/${total}`);
        const response = await sendToBackground({ action, ids: list.slice(i, i + size) });
        if (!response.ok) throw new Error(response.error);
        if ("items" in response) {
          allItems = response.items;
          enriched += response.enriched ?? 0;
          unmatched += response.unmatched ?? 0;
          render();
        }
        done += Math.min(size, list.length - i);
      }
    }
  } catch (err) {
    const why = err instanceof Error ? err.message.replace(/\.$/, "") : "something went wrong";
    return ` Couldn't fetch all the info (${why}). "Fetch info for my shelf" finishes the rest.`;
  }
  return ` Info added to ${enriched}` + (unmatched ? `; ${unmatched} had no match.` : ".");
}

/* ── Paste a list ────────────────────────────────────────── */

const pasteTextEl = document.getElementById("paste-text") as HTMLTextAreaElement;
const pasteStatusEl = document.getElementById("paste-status") as HTMLSelectElement;
const pasteSummaryEl = document.getElementById("paste-summary")!;
const pasteAddEl = document.getElementById("paste-add") as HTMLButtonElement;

/** What the pasted text would do to the shelf right now. */
function pastedPlan() {
  const parsed = parseList(pasteTextEl.value, pasteStatusEl.value === "done");
  return { parsed, plan: planListImport(listToItems(parsed.entries), allItems) };
}

function renderPasteSummary(): void {
  if (!pasteTextEl.value.trim()) {
    pasteSummaryEl.textContent = "";
    pasteAddEl.disabled = true;
    pasteAddEl.textContent = "Add to shelf";
    return;
  }
  const { parsed, plan } = pastedPlan();
  const watched = parsed.entries.filter((e) => e.watched).length;
  const parts = [
    parsed.entries.length === 0 ? "No titles found." : `${parsed.entries.length} found: ${watched} watched, ${parsed.entries.length - watched} to watch.`,
  ];
  if (plan.duplicates.length) parts.push(`${plan.duplicates.length} already on your shelf.`);
  if (plan.similar.length) parts.push(`${plan.similar.length} look like ones you have and will be skipped.`);
  if (parsed.unreadable.length) parts.push(`${parsed.unreadable.length} line${parsed.unreadable.length === 1 ? "" : "s"} couldn't be read.`);
  pasteSummaryEl.textContent = parts.join(" ");
  pasteAddEl.disabled = plan.fresh.length === 0;
  pasteAddEl.textContent = plan.fresh.length ? `Add ${plan.fresh.length} to shelf` : "Add to shelf";
}

async function addPastedList(): Promise<void> {
  const { plan } = pastedPlan();
  if (plan.fresh.length === 0) return;
  pasteAddEl.disabled = true;
  try {
    const before = new Set(allItems.map((i) => i.id));
    const response = await sendToBackground({ action: "import", items: plan.fresh });
    if (!response.ok) throw new Error(response.error);
    if (!("items" in response)) throw new Error("Could not add the titles.");
    allItems = response.items;
    render();
    const addedIds = allItems.filter((i) => !before.has(i.id)).map((i) => i.id);
    pasteTextEl.value = "";
    renderPasteSummary();

    const similar = plan.similar.slice(0, 3).map((s) => `${s.item.title} (like ${s.like})`);
    const base =
      `Added ${addedIds.length} title${addedIds.length === 1 ? "" : "s"}.` +
      (plan.similar.length ? ` Skipped ${plan.similar.length} that look like ones you have: ${similar.join(", ")}${plan.similar.length > 3 ? "…" : ""}.` : "");
    const undo = async () => {
      const undone = await sendToBackground({ action: "delete", ids: addedIds });
      if (undone.ok && "items" in undone) {
        allItems = undone.items;
        render();
        showBackupStatus(`Removed the ${addedIds.length} titles you just added.`);
      } else {
        showBackupStatus(undone.ok ? "Could not undo." : undone.error, true);
      }
    };
    showBackupStatus(base, false, 120000, undo);
    const info = await fetchInfoForNew(addedIds, (progress) => showBackupStatus(`${base} ${progress}`, false, 120000, undo));
    const missingToken = !tmdbConfigured && addedIds.some((id) => allItems.some((i) => i.id === id && isEnrichable(i)));
    showBackupStatus(
      base + info + (missingToken ? " Add a TMDB token (TMDB info) and posters and genres fill in automatically." : ""),
      false,
      UNDO_MS * 2,
      undo
    );
  } catch (err) {
    showBackupStatus(err instanceof Error ? err.message : "Could not add the titles.", true);
    renderPasteSummary();
  }
}

pasteTextEl.addEventListener("input", renderPasteSummary);
pasteStatusEl.addEventListener("change", renderPasteSummary);
pasteAddEl.addEventListener("click", () => void addPastedList());

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

/** With "Remember where I left off", keeps the tab, type chip, status and list for the next time the popup opens. */
function rememberView(): void {
  if (startMode !== "remember") return;
  try {
    localStorage.setItem("keepshelf.tab", activeTab);
    localStorage.setItem("keepshelf.type", activeFilter);
    localStorage.setItem("keepshelf.status", statusFilter);
    localStorage.setItem("keepshelf.list", listFilter);
  } catch {
    /* the view just won't be remembered */
  }
}

statusFilterEl.addEventListener("change", () => {
  statusFilter = statusFilterEl.value as StatusFilter;
  rememberView();
  render();
});

document.getElementById("show-all")!.addEventListener("click", () => {
  statusFilter = "all";
  rememberView();
  render();
});

listFilterEl.addEventListener("change", () => {
  listFilter = listFilterEl.value;
  rememberView();
  render();
});

sortEl.addEventListener("change", () => {
  sortBy = sortEl.value as SortBy;
  localStorage.setItem("keepshelf.sort", sortBy);
  render();
});

syncSelectedEl.addEventListener("click", () => void syncToKeep(getSelectedIds()));

listEl.addEventListener("change", (e) => {
  if ((e.target as HTMLElement).matches('input[type="checkbox"]')) updateSelectionUi();
});

toggleFiltersEl.addEventListener("click", () => {
  moreFiltersEl.hidden = !moreFiltersEl.hidden;
  toggleFiltersEl.setAttribute("aria-expanded", String(!moreFiltersEl.hidden));
});

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
  rememberView();
  render();
});

filtersEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".filter");
  if (!btn) return;
  activeFilter = (btn.dataset.filter as MediaType | "all") ?? "all";
  filtersEl.querySelectorAll(".filter").forEach((f) => {
    f.classList.toggle("active", f === btn);
  });
  rememberView();
  render();
});

/** Shows the restored tab and type chip as selected, for "Remember where I left off". */
function syncShelfUi(): void {
  shelfTabsEl.querySelectorAll<HTMLElement>(".shelf-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === activeTab));
  filtersEl.querySelectorAll<HTMLElement>(".filter").forEach((f) => f.classList.toggle("active", f.dataset.filter === activeFilter));
}

document.getElementById("save-page")!.addEventListener("click", () => {
  // On the Tabs shelf the button saves the page you are on as a bookmark, whatever site it is.
  // Elsewhere it reads a movie, series or book from the page.
  void (activeTab === "tabs" ? saveCurrentTab() : saveCurrentPage());
});

document.getElementById("tab-input-save")!.addEventListener("click", () => {
  void saveTabInput();
});

tabInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void saveTabInput();
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
  const snapshot = snapshotItems(allItems, ids);
  try {
    const response = await sendToBackground({ action: "delete", ids });
    if (response?.ok && "items" in response) {
      allItems = response.items;
      render();
      showStatus(`Deleted ${ids.length} item${ids.length === 1 ? "" : "s"}.`, false, UNDO_MS, () =>
        undoRemoval(snapshot, `Restored ${snapshot.length} item${snapshot.length === 1 ? "" : "s"}.`, (msg, err) =>
          showStatus(msg, err)
        )
      );
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
  else if (!rateDialogEl.hidden) closeRateDialog();
  else if (!pickDialogEl.hidden) closePick();
  else if (!upcomingView.hidden) closeUpcoming();
  else if (!statsView.hidden) closeStats();
  else if (tagPicker.isOpen()) tagPicker.close();
});

document.getElementById("open-upcoming")!.addEventListener("click", openUpcoming);
document.getElementById("close-upcoming")!.addEventListener("click", closeUpcoming);
document.getElementById("open-stats")!.addEventListener("click", openStats);
document.getElementById("close-stats")!.addEventListener("click", closeStats);
document.getElementById("open-settings")!.addEventListener("click", openSettings);
document.getElementById("close-settings")!.addEventListener("click", closeSettings);

document.getElementById("status-close")!.addEventListener("click", () => {
  statusEl.hidden = true;
  setToastUndo(statusTextEl);
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

syncShelfUi();
void loadItems().then(async () => {
  // Refreshes or drops TMDB data older than the retention limit; usually a no-op.
  try {
    const response = await sendToBackground({ action: "refreshStaleTmdb" });
    if (response.ok && "items" in response) {
      allItems = response.items;
      render();
    }
  } catch {
    /* not critical */
  }
});
void loadKeepSettings();
void loadTmdbSettings();
void loadWatchSites();
void loadBookInfoSettings();
void loadReminderSettings();
