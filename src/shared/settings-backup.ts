import { normalizeKeepSettings, type KeepSettings } from "./keep-settings.js";
import { parseTmdbToken } from "./tmdb.js";
import { sanitizeWatchSites, type WatchSite } from "./watch-sites.js";

/**
 * The settings that travel with a backup, so a fresh install needs no re-typing. Everything is checked on the
 * way in and out: a damaged or hand-edited file can only ever restore values the app itself would accept.
 */
export interface SettingsBackup {
  /** The TMDB token. It is a secret, so it is only written when the user leaves "Include my settings" on. */
  tmdbToken?: string;
  keep?: KeepSettings;
  watchSites?: WatchSite[];
  remindersEnabled?: boolean;
  /** Also announce new seasons of shows you have finished. */
  newSeasonReminders?: boolean;
  bookInfoEnabled?: boolean;
  /** Preferences the popup keeps in its own storage, by name. */
  prefs?: Record<string, string>;
}

/** The popup preferences that are part of a backup, and the only values each may hold. */
export const PREF_CHOICES: Record<string, readonly string[]> = {
  "keepshelf.askRating": ["on", "off"],
  "keepshelf.startMode": ["fresh", "remember"],
  "keepshelf.defaultView": ["hide", "all"],
  "keepshelf.searchOnline": ["row", "auto", "off"],
  "keepshelf.showBooks": ["on", "off"],
  "keepshelf.showTabs": ["on", "off"],
};

/** What was read from storage, before any checking. */
export interface SettingsSource {
  tmdbToken?: unknown;
  keep?: unknown;
  watchSites?: unknown;
  remindersEnabled?: unknown;
  newSeasonReminders?: unknown;
  bookInfoEnabled?: unknown;
  prefs?: Record<string, string | null | undefined>;
}

function hasKeepSetup(keep: KeepSettings): boolean {
  return Boolean(
    keep.mediaEnabled || keep.booksEnabled || keep.tabsEnabled || keep.mediaNoteUrl || keep.booksNoteUrl || keep.tabsNoteUrl
  );
}

/** Keeps only what is valid. Undefined when nothing usable is left. */
export function sanitizeSettings(raw: unknown): SettingsBackup | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  const out: SettingsBackup = {};

  if (typeof input.tmdbToken === "string" && parseTmdbToken(input.tmdbToken)) out.tmdbToken = input.tmdbToken.trim();

  if (input.keep && typeof input.keep === "object" && !Array.isArray(input.keep)) {
    const keep = normalizeKeepSettings(input.keep as Partial<KeepSettings>);
    if (hasKeepSetup(keep)) out.keep = keep;
  }

  const sites = sanitizeWatchSites(input.watchSites);
  if (sites.length > 0) out.watchSites = sites;

  if (typeof input.remindersEnabled === "boolean") out.remindersEnabled = input.remindersEnabled;
  if (typeof input.newSeasonReminders === "boolean") out.newSeasonReminders = input.newSeasonReminders;
  if (typeof input.bookInfoEnabled === "boolean") out.bookInfoEnabled = input.bookInfoEnabled;

  if (input.prefs && typeof input.prefs === "object" && !Array.isArray(input.prefs)) {
    const prefs: Record<string, string> = {};
    for (const [key, choices] of Object.entries(PREF_CHOICES)) {
      const value = (input.prefs as Record<string, unknown>)[key];
      if (typeof value === "string" && choices.includes(value)) prefs[key] = value;
    }
    if (Object.keys(prefs).length > 0) out.prefs = prefs;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/** Gathers the settings for an export. Without `includeToken` the TMDB token is left out. */
export function collectSettings(source: SettingsSource, options: { includeToken: boolean }): SettingsBackup | undefined {
  return sanitizeSettings({ ...source, tmdbToken: options.includeToken ? source.tmdbToken : undefined });
}

/** What a backup's settings contain, in plain words, for the question before restoring them. */
export function describeSettings(settings: SettingsBackup): string[] {
  const parts: string[] = [];
  if (settings.tmdbToken) parts.push("your TMDB token");
  if (settings.keep) parts.push("your Keep links");
  if (settings.watchSites) parts.push(`${settings.watchSites.length} watch site${settings.watchSites.length === 1 ? "" : "s"}`);
  if (settings.remindersEnabled !== undefined || settings.newSeasonReminders !== undefined || settings.bookInfoEnabled !== undefined || settings.prefs) {
    parts.push("your switches and preferences");
  }
  return parts;
}
