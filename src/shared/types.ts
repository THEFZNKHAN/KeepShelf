import type { EpisodeRatings } from "./episode-ratings.js";
import type { KeepSettings, KeepSyncResult, KeepTarget } from "./keep-settings.js";

export type MediaType = "movie" | "series" | "anime" | "book" | "tab" | "link" | "note";

export interface SavedItem {
  id: string;
  title: string;
  year?: string;
  type: MediaType;
  subtitle: string;
  genre?: string;
  durationOrSeasons?: string;
  imdbRating?: string;
  author?: string;
  publishedYear?: string;
  googleQuery: string;
  savedAt: number;
  sourceUrl: string;
  url?: string;
  body?: string;
  imageUrl?: string;
  /** Watched / read. Always mirrors `status === "done"`. */
  done?: boolean;
  doneAt?: number;
  status?: ItemStatus;
  tmdb?: TmdbInfo;
  bookInfo?: BookInfo;
  /** The user removed a wrong Open Library match, so don't look it up again automatically. */
  bookInfoOptOut?: boolean;
  /** The user removed a wrong TMDB match, so don't look it up again automatically. */
  tmdbOptOut?: boolean;
  tags?: string[];
  /** Name of a custom list the item belongs to. */
  list?: string;
  /** Personal rating, 1 to 10. */
  myRating?: number;
  review?: string;
  /** Episodes, chapters or pages completed, and the total when known. */
  progressCurrent?: number;
  progressTotal?: number;
  /**
   * Episodes watched in each season (index 0 is season 1). When set, `progressCurrent` is their sum,
   * so everything that only knows the single number keeps working.
   */
  seasonProgress?: number[];
  keepStatus?: ItemKeepStatus;
  keepError?: string;
}

export type TmdbKind = "movie" | "tv";

/**
 * Information fetched from TMDB. It is a cache: TMDB's terms forbid keeping it more than six months,
 * so it carries `fetchedAt` and is refreshed or dropped (see tmdb.ts).
 */
export interface TmdbInfo {
  id: number;
  kind: TmdbKind;
  imdbId?: string;
  genres: string[];
  overview?: string;
  tagline?: string;
  /** TMDB community score, 0 to 10. */
  rating?: number;
  votes?: number;
  /** Age rating such as PG-13 or TV-MA (US). */
  certification?: string;
  runtimeMinutes?: number;
  seasons?: number;
  episodes?: number;
  /** Episodes in each regular season (specials excluded). Index 0 is season 1. */
  seasonEpisodes?: number[];
  /** The next episode to air for a series, as TMDB gives it. Used for release reminders. */
  nextEpisode?: { airDate: string; season: number; episode: number };
  /** A movie's release date, "YYYY-MM-DD". */
  releaseDate?: string;
  /**
   * When a movie reaches streaming and online stores ("digital" on TMDB), by country code, "YYYY-MM-DD". An empty
   * object means TMDB has no digital date yet; missing means this movie was fetched before dates were kept.
   */
  digitalDates?: Record<string, string>;
  status?: string;
  posterPath?: string;
  fetchedAt: number;
}

/** Details about a book from Open Library. Kept on the item once fetched, and shown only when present. */
export interface BookInfo {
  /** Open Library work id, such as "/works/OL17930368W". */
  workKey: string;
  /** Cleaned subjects, used as genres. */
  subjects: string[];
  /** The median page count across editions. */
  pages?: number;
  /** Open Library community rating, 1 to 5, with the number of ratings. */
  rating?: number;
  ratingsCount?: number;
  description?: string;
  /** When the work was first published. Never overwrites the edition year the user saved. */
  firstPublishYear?: number;
  coverId?: number;
  fetchedAt: number;
}

export type ItemStatus = "plan" | "in_progress" | "done" | "dropped";

/** Personal fields the user can change; `null` clears a numeric value. */
export interface UserFields {
  tags?: string[];
  list?: string;
  myRating?: number | null;
  review?: string;
  status?: ItemStatus;
  progressCurrent?: number | null;
  progressTotal?: number | null;
  /** Per-season episodes watched; `null` clears it. */
  seasonProgress?: number[] | null;
}

export type ItemKeepStatus = "synced" | "duplicate" | "failed" | "missing_config" | "disabled";

export type ImportItem = Omit<SavedItem, "id" | "savedAt"> & { savedAt?: number };

/** Fields the user may change from the edit dialog. */
export type EditableFields = Partial<
  Pick<SavedItem, "title" | "year" | "durationOrSeasons" | "imdbRating" | "author" | "publishedYear" | "url" | "body">
>;

export interface ParsedMedia {
  title: string;
  year?: string;
  type: MediaType;
  subtitle: string;
  genre?: string;
  durationOrSeasons?: string;
  imdbRating?: string;
  author?: string;
  publishedYear?: string;
  imageUrl?: string;
}

export type MessageAction =
  | { action: "save"; item: Omit<SavedItem, "id" | "savedAt"> }
  | { action: "saveTab" }
  | { action: "getAll" }
  | { action: "delete"; ids: string[] }
  | { action: "update"; id: string; changes: EditableFields & UserFields & { done?: boolean } }
  | { action: "syncKeep"; ids: string[] }
  | { action: "import"; items: ImportItem[] }
  | { action: "merge"; keepId: string; removeIds: string[] }
  | { action: "restore"; items: SavedItem[] }
  | { action: "getReminderSettings" }
  | { action: "setRemindersEnabled"; enabled: boolean }
  | { action: "checkReminders" }
  | { action: "getBookInfoSettings" }
  | { action: "setBookInfoEnabled"; enabled: boolean }
  | { action: "enrichBooks"; ids?: string[]; force?: boolean }
  | { action: "removeBookMatch"; id: string }
  | { action: "getTmdbSettings" }
  | { action: "setTmdbToken"; token: string }
  | { action: "testTmdb"; token?: string }
  | { action: "enrich"; ids?: string[]; force?: boolean }
  | { action: "removeTmdbMatch"; id: string }
  | { action: "refreshStaleTmdb" }
  | { action: "refreshDates"; force?: boolean }
  | { action: "episodeRatings"; id: string; force?: boolean }
  | { action: "clear" }
  | { action: "getKeepSettings" }
  | { action: "setKeepSettings"; settings: Partial<KeepSettings> }
  | { action: "testKeepAppend"; target: KeepTarget }
  | { action: "getLastKeepResult" };

export type MessageResponse =
  | { ok: true; duplicate?: boolean; similar?: string[]; item?: SavedItem; keep?: KeepSyncResult }
  | {
      ok: true;
      items: SavedItem[];
      synced?: number;
      failed?: number;
      added?: number;
      skipped?: number;
      enriched?: number;
      unmatched?: number;
    }
  | { ok: true; tmdb: { configured: boolean } }
  | { ok: true; episodeRatings: EpisodeRatings }
  | { ok: true; bookInfo: { enabled: boolean } }
  | { ok: true; reminders: { enabled: boolean } }
  | { ok: true; message: string }
  | { ok: true; settings: KeepSettings }
  | { ok: true; keep: KeepSyncResult }
  | { ok: true; lastKeepResult: { message: string; isError: boolean; at: number } | null }
  | { ok: false; error: string };
