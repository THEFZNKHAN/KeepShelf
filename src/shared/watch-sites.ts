import { imdbIdFromUrl, isEnrichable } from "./tmdb.js";
import type { SavedItem, TmdbKind } from "./types.js";

/**
 * "Watch sites": places the user watches things. KeepShelf never visits them. The user pastes the address of
 * one title page, says which title on their shelf it is, and KeepShelf works out how that site's addresses are
 * built (a TMDB id, an IMDb id, or the title in the path). It then builds the exact link for every other title.
 * Nothing is built in, so no site is named anywhere in this code.
 */

export type WatchToken = "tmdb_id" | "imdb_id" | "slug" | "year" | "type";

export interface WatchSite {
  host: string;
  /** The address with parts to fill in, such as `https://example.com/details?id={tmdb_id}&type={type}`. */
  template: string;
  /** The word the site uses in `{type}` for each kind, as seen in the examples the user gave. */
  typeWords: { movie?: string; tv?: string };
}

export const WATCH_SITES_KEY = "keepshelf_watch_sites";
export const MAX_WATCH_SITES = 4;

/** What KeepShelf knows about a title that an address might contain. */
export interface TitleFacts {
  tmdbId?: number;
  imdbId?: string;
  kind: TmdbKind;
  title: string;
  year?: string;
}

export function titleFacts(item: SavedItem): TitleFacts | undefined {
  if (!isEnrichable(item)) return undefined;
  return {
    tmdbId: item.tmdb?.id,
    imdbId: item.tmdb?.imdbId ?? imdbIdFromUrl(item.sourceUrl),
    kind: item.tmdb?.kind ?? (item.type === "movie" ? "movie" : "tv"),
    title: item.title,
    year: item.year,
  };
}

/** "Heart of the Beast!" to "heart-of-the-beast". */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const MOVIE_WORDS = new Set(["movie", "movies", "film", "films"]);
const TV_WORDS = new Set(["tv", "show", "shows", "series", "tvshow", "tvshows", "tv-show", "tv-shows", "tv-series"]);

export interface Learned {
  template: string;
  /** The word the address used for the picked title's kind, when it has one. */
  typeWord?: string;
  kind: TmdbKind;
}

export type LearnResult = { ok: true; learned: Learned } | { ok: false; error: string };

const fail = (error: string): LearnResult => ({ ok: false, error });

/**
 * Replaces `value` where it stands alone, not inside a longer word or number. With `dashed`, a dash counts as
 * part of a word too (so "beast" isn't found inside "heart-of-the-beast"), except straight after an earlier
 * replacement such as `{tmdb_id}-beast`.
 */
function replaceStandalone(text: string, value: string, token: string, dashed = false): string {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const before = dashed ? "(?:(?<![\\w-])|(?<=\\}-))" : "(?<!\\w)";
  const after = dashed ? "(?![\\w-])" : "(?!\\w)";
  return text.replace(new RegExp(`${before}${escaped}${after}`, "gi"), token);
}

/** Works out how an address is built from one example of a title the user picked. */
export function learnPattern(exampleUrl: string, facts: TitleFacts): LearnResult {
  let url: URL;
  try {
    url = new URL(exampleUrl.trim());
  } catch {
    return fail("That doesn't look like a web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return fail("Only http and https addresses work.");
  if (!url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname)) return fail("Use the address of a page on the site, not a local one.");

  let rest = url.pathname + url.search;
  if (facts.imdbId) rest = replaceStandalone(rest, facts.imdbId, "{imdb_id}");
  if (facts.tmdbId) rest = replaceStandalone(rest, String(facts.tmdbId), "{tmdb_id}");
  const slug = slugify(facts.title);
  if (slug) {
    const withYear = facts.year ? replaceStandalone(rest, `${slug}-${facts.year}`, "{slug}-{year}", true) : rest;
    rest = withYear !== rest ? withYear : replaceStandalone(rest, slug, "{slug}", true);
  }

  let typeWord: string | undefined;
  rest = rest.replace(/[^/?&=#]+/g, (segment) => {
    const word = segment.toLowerCase();
    if (!MOVIE_WORDS.has(word) && !TV_WORDS.has(word)) return segment;
    if (typeWord !== undefined && typeWord.toLowerCase() !== word) return segment;
    typeWord = segment;
    return "{type}";
  });

  if (!/\{(imdb_id|tmdb_id|slug)\}/.test(rest)) return fail(notFoundHint(url, facts));
  if (typeWord !== undefined) {
    const isMovieWord = MOVIE_WORDS.has(typeWord.toLowerCase());
    if (isMovieWord !== (facts.kind === "movie")) {
      return fail(`That address looks like a ${isMovieWord ? "movie" : "series"} page, but the title you picked is a ${facts.kind === "movie" ? "movie" : "series"}.`);
    }
  }
  return { ok: true, learned: { template: `${url.origin}${rest}`, typeWord, kind: facts.kind } };
}

/** Says what is missing, in plain words, when nothing in the address matched the title. */
function notFoundHint(url: URL, facts: TitleFacts): string {
  const text = url.pathname + url.search;
  const base = "Couldn't find anything in that address that identifies the title you picked. Check that it is that title's own page.";
  if (/\btt\d{5,}\b/i.test(text) && !facts.imdbId) {
    return `${base} It looks like an IMDb id: pick a title saved from IMDb, or fetch its TMDB info first.`;
  }
  if (/\d{4,}/.test(text) && facts.tmdbId === undefined) {
    return `${base} The number in it may be a TMDB id: add your TMDB token, fetch info for that title, then try again.`;
  }
  return `${base} Some sites add random letters to their addresses, and those can't be worked out.`;
}

/** Turns what was learned from one or two examples into a site. The two must follow the same pattern. */
export function siteFromLearned(first: Learned, second?: Learned): { ok: true; site: WatchSite } | { ok: false; error: string } {
  if (second && second.template !== first.template) {
    if (second.template.replace("-{year}", "") === first.template.replace("-{year}", "")) {
      return {
        ok: false,
        error:
          "One address has the year in it and the other doesn't, so this site doesn't build title addresses the same way every time. Use an address that has an id in it instead (a code like tt1196946 or a number), for example a /title/… page.",
      };
    }
    return { ok: false, error: "The two addresses don't follow the same pattern. Check they are both from the same site." };
  }
  const typeWords: WatchSite["typeWords"] = {};
  for (const learned of second ? [first, second] : [first]) {
    if (learned.typeWord !== undefined) typeWords[learned.kind] ??= learned.typeWord;
  }
  const host = hostOf(first.template);
  if (!host) return { ok: false, error: "That doesn't look like a web address." };
  return { ok: true, site: { host, template: first.template, typeWords } };
}

function hostOf(template: string): string | undefined {
  return /^https?:\/\/([^/?#]+)/i.exec(template)?.[1]?.toLowerCase();
}

/** The exact page for a title on a site, or undefined when something the address needs isn't known. */
export function buildWatchUrl(site: WatchSite, facts: TitleFacts): string | undefined {
  let missing = false;
  const url = site.template.replace(/\{(tmdb_id|imdb_id|slug|year|type)\}/g, (_, token: WatchToken) => {
    let value: string | undefined;
    switch (token) {
      case "tmdb_id":
        value = facts.tmdbId === undefined ? undefined : String(facts.tmdbId);
        break;
      case "imdb_id":
        value = facts.imdbId;
        break;
      case "slug":
        value = slugify(facts.title) || undefined;
        break;
      case "year":
        value = facts.year;
        break;
      case "type":
        value = site.typeWords[facts.kind];
        break;
    }
    if (!value) missing = true;
    return value ?? "";
  });
  return missing ? undefined : url;
}

/** Links for every site that can build one for this item. */
export function watchLinks(item: SavedItem, sites: WatchSite[]): Array<{ host: string; url: string }> {
  const facts = titleFacts(item);
  if (!facts) return [];
  const links: Array<{ host: string; url: string }> = [];
  for (const site of sites) {
    const url = buildWatchUrl(site, facts);
    if (url) links.push({ host: site.host, url });
  }
  return links;
}

const TOKEN_LABELS: Record<WatchToken, string> = {
  tmdb_id: "TMDB id",
  imdb_id: "IMDb id",
  slug: "title",
  year: "year",
  type: "movie or series",
};

/** The pattern in plain words, such as `example.com/details?id=‹TMDB id›&type=‹movie or series›`. */
export function describePattern(site: WatchSite): string {
  return site.template
    .replace(/^https?:\/\//i, "")
    .replace(/\{(tmdb_id|imdb_id|slug|year|type)\}/g, (_, token: WatchToken) => `‹${TOKEN_LABELS[token]}›`);
}

/** Which kinds this site can link to. Sites that don't tell movies from series work for both. */
export function supportedKinds(site: WatchSite): TmdbKind[] {
  if (!site.template.includes("{type}")) return ["movie", "tv"];
  return (["movie", "tv"] as const).filter((kind) => site.typeWords[kind] !== undefined);
}

/** Keeps only well-formed sites, one per host, so a damaged store can't break anything. */
export function sanitizeWatchSites(raw: unknown): WatchSite[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const sites: WatchSite[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { template, typeWords } = entry as Record<string, unknown>;
    if (typeof template !== "string") continue;
    const host = hostOf(template);
    if (!host || seen.has(host) || !/\{(imdb_id|tmdb_id|slug)\}/.test(template)) continue;
    const words: WatchSite["typeWords"] = {};
    if (typeWords && typeof typeWords === "object") {
      const { movie, tv } = typeWords as Record<string, unknown>;
      if (typeof movie === "string" && /^[\w-]{1,20}$/.test(movie)) words.movie = movie;
      if (typeof tv === "string" && /^[\w-]{1,20}$/.test(tv)) words.tv = tv;
    }
    seen.add(host);
    sites.push({ host, template, typeWords: words });
  }
  return sites.slice(0, MAX_WATCH_SITES);
}

export async function getWatchSites(): Promise<WatchSite[]> {
  return sanitizeWatchSites((await chrome.storage.local.get(WATCH_SITES_KEY))[WATCH_SITES_KEY]);
}

/** Adds a site, replacing one already saved for the same host. */
export async function saveWatchSite(site: WatchSite): Promise<WatchSite[]> {
  const others = (await getWatchSites()).filter((s) => s.host !== site.host);
  if (others.length >= MAX_WATCH_SITES) throw new Error(`You can add up to ${MAX_WATCH_SITES} sites. Remove one first.`);
  const sites = [...others, site];
  await chrome.storage.local.set({ [WATCH_SITES_KEY]: sites });
  return sites;
}

export async function removeWatchSite(host: string): Promise<WatchSite[]> {
  const sites = (await getWatchSites()).filter((s) => s.host !== host);
  await chrome.storage.local.set({ [WATCH_SITES_KEY]: sites });
  return sites;
}
