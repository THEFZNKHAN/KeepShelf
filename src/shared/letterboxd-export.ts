/**
 * An export Letterboxd can import (letterboxd.com/import). Letterboxd is films only, so series and anime series are
 * left out and counted. Two files, because Letterboxd takes a watched list and a watchlist separately: films you have
 * watched, with the date, rating, review and tags, and films still to watch.
 * Columns follow Letterboxd's documented import format: tmdbID, imdbID, Title, Year, WatchedDate, Rating (0.5 to 5),
 * Review, Tags.
 */
import { csvText, localDay, toCsv } from "./csv.js";
import type { SavedItem } from "./types.js";
import { statusOf } from "./user-data.js";

export interface LetterboxdExport {
  watched: { csv: string; count: number };
  watchlist: { csv: string; count: number };
  /** Series and anime series: Letterboxd has no TV. */
  skippedSeries: number;
  /** Films you dropped. */
  skippedDropped: number;
}

/** A film, as Letterboxd means it: a movie, or an anime that TMDB lists as a film. */
function isFilm(item: SavedItem): boolean {
  if (item.type === "movie") return true;
  return item.type === "anime" && item.tmdb?.kind === "movie";
}

const isMedia = (item: SavedItem): boolean => item.type === "movie" || item.type === "series" || item.type === "anime";

const yearOf = (item: SavedItem): string => {
  const own = /^\d{4}$/.test(item.year ?? "") ? (item.year as string) : "";
  return own || (item.tmdb?.releaseDate ?? "").slice(0, 4);
};

const titleOf = (item: SavedItem): string => item.title.replace(/\s*\(\d{4}\)\s*$/, "").trim();

/** Your 1 to 10 rating as Letterboxd's 0.5 to 5 stars. */
export function toStars(rating: number | undefined): string {
  if (typeof rating !== "number" || !Number.isFinite(rating) || rating < 1 || rating > 10) return "";
  return String(Math.round(rating) / 2);
}

const ids = (item: SavedItem): [string, string] => [
  item.tmdb?.kind === "movie" ? String(item.tmdb.id) : "",
  /^tt\d+$/.test(item.tmdb?.imdbId ?? "") ? (item.tmdb?.imdbId as string) : "",
];

export function buildLetterboxdExport(items: SavedItem[]): LetterboxdExport {
  const watched: string[][] = [];
  const watchlist: string[][] = [];
  let skippedSeries = 0;
  let skippedDropped = 0;

  for (const item of items) {
    if (!isMedia(item)) continue;
    if (!isFilm(item)) {
      skippedSeries += 1;
      continue;
    }
    const status = statusOf(item);
    if (status === "dropped") {
      skippedDropped += 1;
      continue;
    }
    const [tmdbID, imdbID] = ids(item);
    const base = [tmdbID, imdbID, csvText(titleOf(item)), yearOf(item)];
    if (status === "done") {
      watched.push([
        ...base,
        item.doneAt ? localDay(item.doneAt) : "",
        toStars(item.myRating),
        csvText(item.review),
        csvText((item.tags ?? []).join(", ")),
      ]);
    } else {
      watchlist.push(base);
    }
  }

  return {
    watched: { csv: toCsv(["tmdbID", "imdbID", "Title", "Year", "WatchedDate", "Rating", "Review", "Tags"], watched), count: watched.length },
    watchlist: { csv: toCsv(["tmdbID", "imdbID", "Title", "Year"], watchlist), count: watchlist.length },
    skippedSeries,
    skippedDropped,
  };
}
