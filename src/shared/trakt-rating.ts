/**
 * Trakt's community rating for a title, shown on its card next to TMDB's. Pure; the background worker fetches it from
 * the public GET /movies/{id}/ratings or /shows/{id}/ratings (a Client ID is enough, no sign-in).
 */

export interface TraktRating {
  /** Trakt shows its 1-10 average as a percentage. */
  percent: number;
  votes: number;
}

/** Kept for a day: a rating barely moves, and the card shouldn't wait on Trakt each time. */
export const RATING_FRESH_MS = 24 * 60 * 60 * 1000;

export function parseTraktRating(raw: unknown): TraktRating | undefined {
  const r = raw as { rating?: unknown; votes?: unknown } | null;
  if (!r || typeof r.rating !== "number" || typeof r.votes !== "number") return undefined;
  if (!Number.isFinite(r.rating) || r.rating <= 0 || r.rating > 10 || !Number.isInteger(r.votes) || r.votes <= 0) return undefined;
  return { percent: Math.round(r.rating * 10), votes: r.votes };
}

/** The path that asks Trakt about a title. IMDb ids work directly; otherwise its Trakt id from a TMDB-id search. */
export function ratingPath(kind: "movie" | "tv", id: string): string {
  return `/${kind === "movie" ? "movies" : "shows"}/${encodeURIComponent(id)}/ratings`;
}

/** The Trakt id from GET /search/tmdb/{id}?type=movie|show, for the kind asked about. */
export function traktIdFromSearch(raw: unknown, kind: "movie" | "tv"): string | undefined {
  if (!Array.isArray(raw)) return undefined;
  const key = kind === "movie" ? "movie" : "show";
  for (const entry of raw as Array<Record<string, { ids?: { trakt?: unknown } } | undefined>>) {
    const trakt = entry?.[key]?.ids?.trakt;
    if (typeof trakt === "number" && Number.isInteger(trakt) && trakt > 0) return String(trakt);
  }
  return undefined;
}

/** A cached rating, checked when read back: `rating` null means Trakt had none. */
export function sanitizeCachedRating(raw: unknown, now: number): { rating: TraktRating | null } | undefined {
  const r = raw as { at?: unknown; rating?: unknown } | null;
  if (!r || typeof r.at !== "number" || now - r.at > RATING_FRESH_MS || now < r.at) return undefined;
  if (r.rating === null) return { rating: null };
  const rating = parseTraktRating({ rating: (r.rating as TraktRating)?.percent / 10, votes: (r.rating as TraktRating)?.votes });
  return rating ? { rating } : undefined;
}

export const ratingText = (rating: TraktRating): string => `Trakt ${rating.percent}%`;
