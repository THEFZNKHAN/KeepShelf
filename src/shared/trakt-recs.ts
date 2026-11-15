/**
 * Trakt's suggestions: titles related to one on the shelf (public), and recommendations for you from your history
 * (signed in). Pure; the background worker fetches them and looks each up on TMDB for its poster.
 */

export interface TraktTitle {
  kind: "movie" | "tv";
  tmdb: number;
  title: string;
  year?: string;
  overview?: string;
  /** Trakt files it as anime. */
  anime: boolean;
}

/** At most this many suggestions per list, each costing one TMDB lookup for its poster. */
export const TRAKT_SUGGESTIONS = 10;

type Media = { title?: unknown; year?: unknown; ids?: { tmdb?: unknown }; overview?: unknown; genres?: unknown; language?: unknown };

const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};

/**
 * Titles from a Trakt list of movies or shows: /movies/{id}/related, /recommendations/shows and the like, with
 * ?extended=full. Entries can be the title itself or wrap it ({ movie: … }). Titles without a TMDB id are left out.
 */
export function parseTraktTitles(raw: unknown, kind: "movie" | "tv"): TraktTitle[] {
  if (!Array.isArray(raw)) return [];
  const key = kind === "movie" ? "movie" : "show";
  const out: TraktTitle[] = [];
  const seen = new Set<number>();
  for (const entry of raw as Array<Record<string, unknown>>) {
    const media = ((entry?.[key] as Media | undefined) ?? (entry as Media)) as Media;
    const tmdb = media?.ids?.tmdb;
    const title = clean(media?.title, 200);
    if (typeof tmdb !== "number" || !Number.isInteger(tmdb) || tmdb <= 0 || !title || seen.has(tmdb)) continue;
    seen.add(tmdb);
    const genres = Array.isArray(media.genres) ? media.genres.filter((g): g is string => typeof g === "string").map((g) => g.toLowerCase()) : [];
    const year = typeof media.year === "number" && media.year > 1800 && media.year < 2200 ? String(media.year) : undefined;
    const overview = clean(media.overview, 1500);
    out.push({
      kind,
      tmdb,
      title,
      ...(year ? { year } : {}),
      ...(overview ? { overview } : {}),
      anime: genres.includes("anime") || (media.language === "ja" && genres.includes("animation")),
    });
    if (out.length >= TRAKT_SUGGESTIONS) break;
  }
  return out;
}

/** Leaves out what is already listed (by kind and TMDB id), and the title the list is about. */
export function newTitlesOnly(trakt: TraktTitle[], listed: Array<{ kind: string; id: number }>): TraktTitle[] {
  const keys = new Set(listed.map((r) => `${r.kind}:${r.id}`));
  return trakt.filter((t) => !keys.has(`${t.kind}:${t.tmdb}`));
}
