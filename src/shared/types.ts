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
  tags?: string[];
  /** Name of a custom list the item belongs to. */
  list?: string;
  /** Personal rating, 1 to 10. */
  myRating?: number;
  review?: string;
  /** Episodes, chapters or pages completed, and the total when known. */
  progressCurrent?: number;
  progressTotal?: number;
  keepStatus?: ItemKeepStatus;
  keepError?: string;
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
  | { action: "clear" }
  | { action: "getKeepSettings" }
  | { action: "setKeepSettings"; settings: Partial<KeepSettings> }
  | { action: "testKeepAppend"; target: KeepTarget }
  | { action: "getLastKeepResult" };

export type MessageResponse =
  | { ok: true; duplicate?: boolean; similar?: string[]; item?: SavedItem; keep?: KeepSyncResult }
  | { ok: true; items: SavedItem[]; synced?: number; failed?: number; added?: number; skipped?: number }
  | { ok: true; settings: KeepSettings }
  | { ok: true; keep: KeepSyncResult }
  | { ok: true; lastKeepResult: { message: string; isError: boolean; at: number } | null }
  | { ok: false; error: string };
