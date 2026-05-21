import type { KeepSyncResult } from "./keep-settings.js";
import type { KeepSettings, KeepTarget } from "./keep-settings.js";

export type MediaType = "movie" | "series" | "anime" | "book";

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
}

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
}

export type MessageAction =
  | { action: "save"; item: Omit<SavedItem, "id" | "savedAt"> }
  | { action: "getAll" }
  | { action: "delete"; ids: string[] }
  | { action: "clear" }
  | { action: "getKeepSettings" }
  | { action: "setKeepSettings"; settings: Partial<KeepSettings> }
  | { action: "testKeepAppend"; target: KeepTarget }
  | { action: "getLastKeepResult" };

export type MessageResponse =
  | { ok: true; duplicate?: boolean; item?: SavedItem; keep?: KeepSyncResult }
  | { ok: true; items: SavedItem[] }
  | { ok: true; settings: KeepSettings }
  | { ok: true; keep: KeepSyncResult }
  | { ok: true; lastKeepResult: { message: string; isError: boolean; at: number } | null }
  | { ok: false; error: string };
