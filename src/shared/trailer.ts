/**
 * Choosing which TMDB video to open as a title's trailer. TMDB lists every clip it knows (trailers, teasers, featurettes,
 * clips), mostly on YouTube; only a YouTube video with a well-formed key can become a link, so nothing else from the
 * response ever reaches a tab.
 */
export interface Trailer {
  url: string;
  name: string;
}

const KEY = /^[\w-]{6,20}$/;

/** Languages to ask TMDB for when a title has no English trailer, such as a film from India, Japan or Korea. */
export const TRAILER_LANGUAGES = "en,null,hi,ta,te,ml,kn,bn,mr,pa,ja,ko,zh,es,fr,de,it,pt,ru,tr,ar";

interface RawVideo {
  key?: unknown;
  site?: unknown;
  type?: unknown;
  official?: unknown;
  published_at?: unknown;
  name?: unknown;
}

const typeRank = (type: unknown): number => (type === "Trailer" ? 3 : type === "Teaser" ? 2 : 1);

const published = (value: unknown): number => {
  const t = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** The best trailer in a /videos answer: a Trailer over a Teaser over anything else, official over not, newest first. */
export function pickTrailer(raw: unknown): Trailer | undefined {
  const list = (raw as { results?: unknown } | null)?.results;
  if (!Array.isArray(list)) return undefined;
  const candidates = (list as RawVideo[]).filter(
    (v): v is RawVideo & { key: string } => !!v && typeof v === "object" && v.site === "YouTube" && typeof v.key === "string" && KEY.test(v.key)
  );
  if (candidates.length === 0) return undefined;
  const best = [...candidates].sort(
    (a, b) =>
      typeRank(b.type) - typeRank(a.type) ||
      Number(b.official === true) - Number(a.official === true) ||
      published(b.published_at) - published(a.published_at)
  )[0];
  const name = typeof best.name === "string" ? best.name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) : "";
  return { url: `https://www.youtube.com/watch?v=${best.key}`, name };
}
