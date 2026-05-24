import type { MediaType, SavedItem } from "./types.js";

export type KeepTarget = "media" | "books" | "tabs";

export type KeepSyncStatus =
  | "disabled"
  | "missing_config"
  | "synced"
  | "duplicate"
  | "failed";

export interface KeepSyncResult {
  status: KeepSyncStatus;
  target?: KeepTarget;
  text?: string;
  noteUrl?: string;
  error?: string;
}

export interface KeepSettings {
  /** @deprecated use mediaEnabled */
  enabled?: boolean;
  mediaEnabled: boolean;
  booksEnabled: boolean;
  tabsEnabled: boolean;
  mediaNoteId?: string;
  mediaNoteUrl?: string;
  booksNoteId?: string;
  booksNoteUrl?: string;
  tabsNoteId?: string;
  tabsNoteUrl?: string;
}

export interface KeepNoteTarget {
  target: KeepTarget;
  noteId: string;
  noteUrl: string;
}

const STORAGE_KEY = "trackbuddy_keep_settings";

const DEFAULT_SETTINGS: Partial<KeepSettings> = {
  mediaEnabled: false,
  booksEnabled: false,
  tabsEnabled: false,
};

export function parseKeepNoteId(url: string): string | undefined {
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  const match =
    trimmed.match(/#(?:NOTE|LIST)\/([^/?#\s]+)/i) ??
    trimmed.match(/\/(?:NOTE|LIST)\/([^/?#\s]+)/i);
  return match?.[1];
}

export function normalizeKeepSettings(
  input: Partial<KeepSettings>
): KeepSettings {
  // migrate legacy `enabled` flag to both mediaEnabled and booksEnabled
  const legacyEnabled = Boolean(input.enabled);
  const mediaNoteUrl = input.mediaNoteUrl?.trim() || undefined;
  const booksNoteUrl = input.booksNoteUrl?.trim() || undefined;
  const tabsNoteUrl = input.tabsNoteUrl?.trim() || undefined;

  return {
    mediaEnabled: input.mediaEnabled !== undefined ? Boolean(input.mediaEnabled) : legacyEnabled,
    booksEnabled: input.booksEnabled !== undefined ? Boolean(input.booksEnabled) : legacyEnabled,
    tabsEnabled: Boolean(input.tabsEnabled),
    mediaNoteUrl,
    mediaNoteId: mediaNoteUrl
      ? parseKeepNoteId(mediaNoteUrl) ?? input.mediaNoteId
      : undefined,
    booksNoteUrl,
    booksNoteId: booksNoteUrl
      ? parseKeepNoteId(booksNoteUrl) ?? input.booksNoteId
      : undefined,
    tabsNoteUrl,
    tabsNoteId: tabsNoteUrl
      ? parseKeepNoteId(tabsNoteUrl) ?? input.tabsNoteId
      : undefined,
  };
}

export function isLikelyValidKeepNoteId(noteId: string | undefined): boolean {
  return Boolean(noteId && noteId.length >= 40);
}

export function getKeepTargetForType(
  type: MediaType,
  settings: KeepSettings
): KeepNoteTarget | null {
  if (type === "tab" || type === "link" || type === "note") {
    if (!settings.tabsEnabled) return null;
    if (!settings.tabsNoteId || !settings.tabsNoteUrl) return null;
    return { target: "tabs", noteId: settings.tabsNoteId, noteUrl: settings.tabsNoteUrl };
  }

  if (type === "book") {
    if (!settings.booksEnabled) return null;
    if (!settings.booksNoteId || !settings.booksNoteUrl) return null;
    return { target: "books", noteId: settings.booksNoteId, noteUrl: settings.booksNoteUrl };
  }

  if (!settings.mediaEnabled) return null;
  if (!settings.mediaNoteId || !settings.mediaNoteUrl) return null;
  return { target: "media", noteId: settings.mediaNoteId, noteUrl: settings.mediaNoteUrl };
}

export function getKeepTargetForItem(
  item: Pick<SavedItem, "type">,
  settings: KeepSettings
): KeepNoteTarget | null {
  return getKeepTargetForType(item.type, settings);
}

export function missingKeepConfigMessage(target: KeepTarget): string {
  if (target === "books") return "Link your Books Keep note in Settings.";
  if (target === "tabs") return "Link your Tabs Keep note in Settings.";
  return "Link your Media Keep note in Settings.";
}

export async function getKeepSettings(): Promise<KeepSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY] as Partial<KeepSettings> | undefined;
  return normalizeKeepSettings({ ...DEFAULT_SETTINGS, ...raw });
}

export async function setKeepSettings(
  settings: Partial<KeepSettings>
): Promise<KeepSettings> {
  const current = await getKeepSettings();
  const next = normalizeKeepSettings({ ...current, ...settings });
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}
