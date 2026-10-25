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
  /** Watched / read. */
  done?: boolean;
  doneAt?: number;
  keepStatus?: ItemKeepStatus;
  keepError?: string;
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
  | { action: "update"; id: string; changes: EditableFields & { done?: boolean } }
  | { action: "syncKeep"; ids: string[] }
  | { action: "import"; items: ImportItem[] }
  | { action: "clear" }
  | { action: "getKeepSettings" }
  | { action: "setKeepSettings"; settings: Partial<KeepSettings> }
  | { action: "testKeepAppend"; target: KeepTarget }
  | { action: "getLastKeepResult" };

export type MessageResponse =
  | { ok: true; duplicate?: boolean; item?: SavedItem; keep?: KeepSyncResult }
  | { ok: true; items: SavedItem[]; synced?: number; failed?: number; added?: number; skipped?: number }
  | { ok: true; settings: KeepSettings }
  | { ok: true; keep: KeepSyncResult }
  | { ok: true; lastKeepResult: { message: string; isError: boolean; at: number } | null }
  | { ok: false; error: string };
