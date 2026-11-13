/**
 * An export for Trakt's importer (trakt.tv, Settings > Import): films, series and anime in one CSV. Trakt's importer
 * accepts a CSV with an id column and these columns: watched_at, watchlisted_at, rating (1 to 10) and rated_at, all
 * ISO 8601. It isn't officially documented and has changed before, and a bare numeric id can match the wrong title,
 * so only an IMDb id is used; titles without one are left out and counted.
 */
import { toCsv } from "./csv.js";
import type { SavedItem } from "./types.js";
import { statusOf } from "./user-data.js";

export interface TraktExport {
  csv: string;
  /** Rows with a watched date (and a rating when you gave one). */
  watched: number;
  /** Rows for the watchlist: still to watch, or in progress. */
  watchlist: number;
  /** Titles with no IMDb id saved, so Trakt couldn't match them reliably. */
  skippedNoId: number;
  skippedDropped: number;
}

const isMedia = (item: SavedItem): boolean => item.type === "movie" || item.type === "series" || item.type === "anime";

const iso = (timestamp: number): string => new Date(timestamp).toISOString();

export function buildTraktExport(items: SavedItem[]): TraktExport {
  const rows: string[][] = [];
  let watched = 0;
  let watchlist = 0;
  let skippedNoId = 0;
  let skippedDropped = 0;

  for (const item of items) {
    if (!isMedia(item)) continue;
    const status = statusOf(item);
    if (status === "dropped") {
      skippedDropped += 1;
      continue;
    }
    const imdb = item.tmdb?.imdbId;
    if (!imdb || !/^tt\d+$/.test(imdb)) {
      skippedNoId += 1;
      continue;
    }
    if (status === "done") {
      const when = iso(item.doneAt ?? item.savedAt);
      const rating = typeof item.myRating === "number" && item.myRating >= 1 && item.myRating <= 10 ? String(item.myRating) : "";
      rows.push([imdb, when, "", rating, rating ? when : ""]);
      watched += 1;
    } else {
      // A show you are partway through can't be told to Trakt episode by episode in a CSV, so it goes on the watchlist.
      rows.push([imdb, "", iso(item.savedAt), "", ""]);
      watchlist += 1;
    }
  }

  return { csv: toCsv(["imdb_id", "watched_at", "watchlisted_at", "rating", "rated_at"], rows), watched, watchlist, skippedNoId, skippedDropped };
}
