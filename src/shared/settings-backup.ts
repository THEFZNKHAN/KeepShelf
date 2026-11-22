import { normalizeKeepSettings, type KeepSettings } from "./keep-settings.js";
import { parseTmdbToken } from "./tmdb.js";
import { sanitizeWatchSites, type WatchSite } from "./watch-sites.js";
import { cleanClientId } from "./trakt-auth.js";
import { PULL_INTERVALS, type PullInterval } from "./trakt-pull.js";

/** The Trakt app and its switches. Never the sign-in: after a restore you connect again. */
export interface TraktSettingsBackup {
  clientId?: string;
  auto?: boolean;
  watchlist?: boolean;
  pull?: PullInterval;
}

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
  trakt?: TraktSettingsBackup;
}

/** The popup preferences that are part of a backup, and the only values each may hold. */
export const PREF_CHOICES: Record<string, readonly string[]> = {
  "keepshelf.askRating": ["on", "off"],
  "keepshelf.startMode": ["fresh", "remember"],
  "keepshelf.defaultView": ["hide", "all"],
  "keepshelf.searchOnline": ["row", "auto", "off"],
  "keepshelf.showBooks": ["on", "off"],
  "keepshelf.showTabs": ["on", "off"],
  "keepshelf.theme": ["system", "light", "dark"],
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
  trakt?: unknown;
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

  if (input.trakt && typeof input.trakt === "object" && !Array.isArray(input.trakt)) {
    const t = input.trakt as Record<string, unknown>;
    const trakt: TraktSettingsBackup = {};
    const clientId = cleanClientId(t.clientId);
    if (clientId) trakt.clientId = clientId;
    if (typeof t.auto === "boolean") trakt.auto = t.auto;
    if (typeof t.watchlist === "boolean") trakt.watchlist = t.watchlist;
    if ((PULL_INTERVALS as readonly unknown[]).includes(t.pull)) trakt.pull = t.pull as PullInterval;
    // Switches alone, with no app to use them, are nothing to restore.
    if (trakt.clientId) out.trakt = trakt;
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
  if (settings.trakt) parts.push("your Trakt app (connect again afterwards)");
  if (settings.remindersEnabled !== undefined || settings.newSeasonReminders !== undefined || settings.bookInfoEnabled !== undefined || settings.prefs) {
    parts.push("your switches and preferences");
  }
  return parts;
}
