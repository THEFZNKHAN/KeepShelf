import { imdbIdFromUrl, isEnrichable } from "./tmdb.js";
import type { SavedItem, TmdbKind } from "./types.js";

/**
 * "Watch sites": places the user watches things. KeepShelf never visits them. The user pastes the address of
 * one title page, says which title on their shelf it is, and KeepShelf works out how that site's addresses are
 * built (a TMDB id, an IMDb id, or the title in the path). It then builds the exact link for every other title.
 * Nothing is built in, so no site is named anywhere in this code.
 */

/**
 * Parts of an address that are filled in per title. `q_plus` and `q_pct` are the title as search text, written
 * the two common ways: `one+piece` and `one%20piece`. `qm_plus` and `qm_pct` are the same for the main name only,
 * the part before a colon ("One Piece" for "One Piece: Wan pîsu"), because that is what sites search by.
 */
export type WatchToken = "tmdb_id" | "imdb_id" | "slug" | "year" | "type" | "q_plus" | "q_pct" | "qm_plus" | "qm_pct";

/** The parts that say which title an address is for. A template needs at least one. */
const IDENTIFYING = /\{(imdb_id|tmdb_id|slug|q_plus|q_pct|qm_plus|qm_pct)\}/;
const ALL_TOKENS = /\{(tmdb_id|imdb_id|slug|year|type|q_plus|q_pct|qm_plus|qm_pct)\}/g;

/** The kinds of title a site can be limited to. */
export type WatchMediaType = "movie" | "series" | "anime";
export const WATCH_MEDIA_TYPES: readonly WatchMediaType[] = ["movie", "series", "anime"];

export interface WatchSite {
  host: string;
  /** Only show this site's button on these kinds of title. Missing means all of them. */
  types?: WatchMediaType[];
  /** False when the user has switched the site off without removing it. Missing means on. */
  enabled?: boolean;
  /** The address with parts to fill in, such as `https://example.com/details?id={tmdb_id}&type={type}`. */
  template: string;
  /** The word the site uses in `{type}` for each kind, as seen in the examples the user gave. */
  typeWords: { movie?: string; tv?: string };
  /**
   * Set when movies and series don't share one pattern (a series address with extra parts, say). Each kind then
   * uses its own, with the type word already written in; `template` is just the first of them.
   */
  templates?: { movie?: string; tv?: string };
}

export const WATCH_SITES_KEY = "keepshelf_watch_sites";
export const MAX_WATCH_SITES = 10;

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

/** The title as search text: `plus` gives "one+piece", `percent` gives "one%20piece". */
export function searchText(title: string, style: "plus" | "percent"): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  return style === "plus" ? words.map(encodeURIComponent).join("+") : encodeURIComponent(words.join(" "));
}

/** "One Piece: Wan pîsu" to "One Piece". Undefined when the title has no subtitle. */
export function mainTitle(title: string): string | undefined {
  const main = title.split(/:|\s[-–—]\s/)[0].trim();
  return main.length >= 2 && main !== title.trim() ? main : undefined;
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

/**
 * Finds the title as search text in the path and query of an example, and returns the address with it replaced,
 * or undefined when it isn't there. The full title is tried first, then the main name before a colon.
 */
function learnSearch(rest: string, facts: TitleFacts): string | undefined {
  const [pathPart, ...queryParts] = rest.split("?");
  const hasQuery = queryParts.length > 0;
  const forms: Array<{ text: string; plus: WatchToken; pct: WatchToken }> = [{ text: facts.title, plus: "q_plus", pct: "q_pct" }];
  const main = mainTitle(facts.title);
  if (main) forms.push({ text: main, plus: "qm_plus", pct: "qm_pct" });

  for (const { text, plus, pct } of forms) {
    let path = pathPart;
    let query = queryParts.join("?");
    const inQuery = replaceStandalone(query, searchText(text, "plus"), `{${plus}}`);
    if (hasQuery && inQuery !== query) return `${path}?${inQuery}`;
    // Spaces written as %20 only show up for titles of two or more words.
    if (!text.trim().includes(" ")) continue;
    const encoded = searchText(text, "percent");
    const pathPct = replaceStandalone(path, encoded, `{${pct}}`);
    const queryPct = replaceStandalone(query, encoded, `{${pct}}`);
    if (pathPct !== path || queryPct !== query) {
      path = pathPct;
      query = queryPct;
      return hasQuery ? `${path}?${query}` : path;
    }
  }
  return undefined;
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
  const withYear = slug && facts.year ? replaceStandalone(rest, `${slug}-${facts.year}`, "{slug}-{year}", true) : rest;
  if (withYear !== rest) {
    rest = withYear;
  } else {
    // A search page has the title as text in the query (or path), such as ?keyword=one+piece.
    const searched = learnSearch(rest, facts);
    if (searched !== undefined) rest = searched;
    else if (slug) rest = replaceStandalone(rest, slug, "{slug}", true);
  }

  let typeWord: string | undefined;
  rest = rest.replace(/[^/?&=#]+/g, (segment) => {
    const word = segment.toLowerCase();
    if (!MOVIE_WORDS.has(word) && !TV_WORDS.has(word)) return segment;
    if (typeWord !== undefined && typeWord.toLowerCase() !== word) return segment;
    typeWord = segment;
    return "{type}";
  });

  if (!IDENTIFYING.test(rest)) return fail(notFoundHint(url, facts));
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
  const searchFor = mainTitle(facts.title) ?? facts.title;
  return `${base} Some sites add random letters to their addresses, and those can't be worked out. If the site has a search page, paste the address of a search for "${searchFor}" instead (a title with two or more words works best).`;
}

/** A site is on unless the user switched it off. */
export function isEnabled(site: Pick<WatchSite, "enabled">): boolean {
  return site.enabled !== false;
}

/** Whether a site's button belongs on a title of this kind. */
export function appliesTo(site: Pick<WatchSite, "types">, type: string): boolean {
  return !site.types || (site.types as string[]).includes(type);
}

/**
 * Where to start: a site added with an anime as the example is most likely an anime site, so it starts as anime
 * only. Anything else starts with every kind. The user can change it in the site's row.
 */
export function defaultTypesFor(exampleType: string | undefined): WatchMediaType[] | undefined {
  return exampleType === "anime" ? ["anime"] : undefined;
}

/** A valid, non-empty set of kinds, or undefined for "all" (so a site with every kind ticked stores nothing extra). */
export function normalizeTypes(types: unknown): WatchMediaType[] | undefined {
  if (!Array.isArray(types)) return undefined;
  const kept = WATCH_MEDIA_TYPES.filter((t) => types.includes(t));
  return kept.length > 0 && kept.length < WATCH_MEDIA_TYPES.length ? kept : undefined;
}

/** Why two addresses can't both be examples of one site, in plain words. */
function mismatchError(a: string, b: string): string {
  if (yearOnlyDifference(a, b)) {
    return "One address has the year in it and the other doesn't, so this site doesn't build title addresses the same way every time. Use an address that has an id in it instead (a code like tt1196946 or a number), for example a /title/… page.";
  }
  return "The two addresses don't follow the same pattern. Check they are both from the same site.";
}

/** True when two patterns differ only by a "-{year}" on the end, which sites add to some addresses and not others. */
function yearOnlyDifference(a: string, b: string): boolean {
  return a !== b && a.replace("-{year}", "") === b.replace("-{year}", "");
}

/** A learned pattern with the site's word for movie or series written in, so it no longer needs `{type}`. */
function literalTemplate(learned: Learned): string {
  return learned.typeWord === undefined ? learned.template : learned.template.split("{type}").join(learned.typeWord);
}

const OTHER_KIND: Record<TmdbKind, TmdbKind> = { movie: "tv", tv: "movie" };

type SiteResult = { ok: true; site: WatchSite } | { ok: false; error: string };

/**
 * Turns what was learned from one or two examples into a site. If both follow one pattern the site shares it.
 * If they are different kinds (a movie page and a series page) with different patterns, each kind keeps its own.
 */
export function siteFromLearned(first: Learned, second?: Learned, types?: WatchMediaType[]): SiteResult {
  const limited = normalizeTypes(types);
  const extra = limited ? { types: limited } : {};
  const host = hostOf(first.template);
  if (!host) return { ok: false, error: "That doesn't look like a web address." };

  if (second && second.template !== first.template) {
    const separate =
      second.kind !== first.kind && hostOf(second.template) === host && !yearOnlyDifference(first.template, second.template);
    if (!separate) return { ok: false, error: mismatchError(first.template, second.template) };
    const own = literalTemplate(first);
    return {
      ok: true,
      site: { host, template: own, typeWords: {}, templates: { [first.kind]: own, [second.kind]: literalTemplate(second) }, ...extra },
    };
  }

  const typeWords: WatchSite["typeWords"] = {};
  for (const learned of second ? [first, second] : [first]) {
    if (learned.typeWord !== undefined) typeWords[learned.kind] ??= learned.typeWord;
  }
  return { ok: true, site: { host, template: first.template, typeWords, ...extra } };
}

/** Adds an example of the other kind (a series page, say) to a site that only knew one, without starting over. */
export function addExampleToSite(site: WatchSite, learned: Learned): SiteResult {
  const own = literalTemplate(learned);
  if (hostOf(learned.template) !== site.host) return { ok: false, error: mismatchError(site.template, learned.template) };

  if (site.templates) {
    const existing = site.templates[learned.kind];
    if (existing !== undefined) {
      return existing === own ? { ok: true, site } : { ok: false, error: mismatchError(existing, own) };
    }
    const other = site.templates[OTHER_KIND[learned.kind]];
    if (other !== undefined && yearOnlyDifference(other, own)) return { ok: false, error: mismatchError(other, own) };
    return { ok: true, site: { ...site, templates: { ...site.templates, [learned.kind]: own } } };
  }

  if (learned.template === site.template) {
    if (learned.typeWord === undefined) return { ok: false, error: "That address doesn't tell movies from series, so there is nothing to add." };
    return { ok: true, site: { ...site, typeWords: { ...site.typeWords, [learned.kind]: site.typeWords[learned.kind] ?? learned.typeWord } } };
  }

  // A different pattern for the kind the site is missing: keep one pattern for each kind from now on.
  const missing = missingKind(site);
  const known = missing ? OTHER_KIND[missing] : undefined;
  const knownWord = known ? site.typeWords[known] : undefined;
  if (missing === learned.kind && known && knownWord !== undefined && !yearOnlyDifference(site.template, learned.template)) {
    const existing = site.template.split("{type}").join(knownWord);
    return { ok: true, site: { ...site, template: existing, typeWords: {}, templates: { [known]: existing, [learned.kind]: own } } };
  }
  return { ok: false, error: mismatchError(site.template, learned.template) };
}

/** The pattern a title of this kind uses on a site, or undefined when the site has none for it. */
function templateFor(site: Pick<WatchSite, "template" | "templates">, kind: TmdbKind): string | undefined {
  return site.templates ? site.templates[kind] : site.template;
}

/** The kind of title this site is still missing an example for, if any. */
export function missingKind(site: WatchSite): TmdbKind | undefined {
  if (site.templates) return (["movie", "tv"] as const).find((kind) => site.templates?.[kind] === undefined);
  if (!site.template.includes("{type}")) return undefined;
  return (["movie", "tv"] as const).find((kind) => site.typeWords[kind] === undefined);
}

/**
 * True for a pattern that opens the site's search for the title, not the title's own page: the title is written as
 * text and nothing in it is an id. A title name alongside an id (`?id=603&title=Heat`) is still an exact page.
 */
function isSearchTemplate(template: string): boolean {
  return /\{qm?_(plus|pct)\}/.test(template) && !/\{(tmdb_id|imdb_id|slug)\}/.test(template);
}

/** True when the site's links open its search. With a kind, only that kind's pattern counts. */
export function isSearchSite(site: Pick<WatchSite, "template" | "templates">, kind?: TmdbKind): boolean {
  const templates = kind ? [templateFor(site, kind)] : site.templates ? Object.values(site.templates) : [site.template];
  const known = templates.filter((t): t is string => t !== undefined);
  return known.length > 0 && known.every(isSearchTemplate);
}

function hostOf(template: string): string | undefined {
  return /^https?:\/\/([^/?#]+)/i.exec(template)?.[1]?.toLowerCase();
}

/** The exact page for a title on a site, or undefined when something the address needs isn't known. */
export function buildWatchUrl(site: WatchSite, facts: TitleFacts): string | undefined {
  const template = templateFor(site, facts.kind);
  if (template === undefined) return undefined;
  let missing = false;
  const url = template.replace(ALL_TOKENS, (_, token: WatchToken) => {
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
      case "q_plus":
        value = searchText(facts.title, "plus") || undefined;
        break;
      case "q_pct":
        value = searchText(facts.title, "percent") || undefined;
        break;
      case "qm_plus":
        value = searchText(mainTitle(facts.title) ?? facts.title, "plus") || undefined;
        break;
      case "qm_pct":
        value = searchText(mainTitle(facts.title) ?? facts.title, "percent") || undefined;
        break;
    }
    if (!value) missing = true;
    return value ?? "";
  });
  return missing ? undefined : url;
}

/** Links for every site that can build one for this item. */
export function watchLinks(item: SavedItem, sites: WatchSite[]): Array<{ host: string; url: string; search: boolean }> {
  const facts = titleFacts(item);
  if (!facts) return [];
  const links: Array<{ host: string; url: string; search: boolean }> = [];
  for (const site of sites) {
    if (!isEnabled(site) || !appliesTo(site, item.type)) continue;
    const url = buildWatchUrl(site, facts);
    if (url) links.push({ host: site.host, url, search: isSearchSite(site, facts.kind) });
  }
  return links;
}

const TOKEN_LABELS: Record<WatchToken, string> = {
  tmdb_id: "TMDB id",
  imdb_id: "IMDb id",
  slug: "title",
  year: "year",
  type: "movie or series",
  q_plus: "title",
  q_pct: "title",
  qm_plus: "title",
  qm_pct: "title",
};

/** The pattern in plain words, one line per kind when movies and series differ: `example.com/details?id=‹TMDB id›`. */
export function patternLines(site: WatchSite): string[] {
  const plain = (template: string) =>
    template.replace(/^https?:\/\//i, "").replace(ALL_TOKENS, (_, token: WatchToken) => `‹${TOKEN_LABELS[token]}›`);
  if (!site.templates) return [plain(site.template)];
  return (["movie", "tv"] as const)
    .filter((kind) => site.templates?.[kind] !== undefined)
    .map((kind) => `${kind === "movie" ? "Movies" : "Series"}: ${plain(site.templates![kind]!)}`);
}

/** The same, on one line. */
export function describePattern(site: WatchSite): string {
  return patternLines(site).join("  ·  ");
}

/** Which kinds this site can link to. Sites that don't tell movies from series work for both. */
export function supportedKinds(site: WatchSite): TmdbKind[] {
  if (site.templates) return (["movie", "tv"] as const).filter((kind) => site.templates?.[kind] !== undefined);
  if (!site.template.includes("{type}")) return ["movie", "tv"];
  return (["movie", "tv"] as const).filter((kind) => site.typeWords[kind] !== undefined);
}

/** The per-kind patterns of a site, keeping only well-formed ones on the same host, or undefined if there are none. */
function sanitizeKindTemplates(raw: unknown, host: string): WatchSite["templates"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: NonNullable<WatchSite["templates"]> = {};
  for (const kind of ["movie", "tv"] as const) {
    const value = (raw as Record<string, unknown>)[kind];
    if (typeof value === "string" && hostOf(value) === host && IDENTIFYING.test(value)) out[kind] = value;
  }
  return out.movie !== undefined || out.tv !== undefined ? out : undefined;
}

/** Keeps only well-formed sites, one per host, so a damaged store can't break anything. */
export function sanitizeWatchSites(raw: unknown): WatchSite[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const sites: WatchSite[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { template, typeWords, types, enabled, templates } = entry as Record<string, unknown>;
    if (typeof template !== "string") continue;
    const host = hostOf(template);
    if (!host || seen.has(host) || !IDENTIFYING.test(template)) continue;
    const words: WatchSite["typeWords"] = {};
    if (typeWords && typeof typeWords === "object") {
      const { movie, tv } = typeWords as Record<string, unknown>;
      if (typeof movie === "string" && /^[\w-]{1,20}$/.test(movie)) words.movie = movie;
      if (typeof tv === "string" && /^[\w-]{1,20}$/.test(tv)) words.tv = tv;
    }
    seen.add(host);
    const limited = normalizeTypes(types);
    const own = sanitizeKindTemplates(templates, host);
    sites.push({
      host,
      template,
      typeWords: words,
      ...(own ? { templates: own } : {}),
      ...(limited ? { types: limited } : {}),
      ...(enabled === false ? { enabled: false } : {}),
    });
  }
  return sites.slice(0, MAX_WATCH_SITES);
}

export async function getWatchSites(): Promise<WatchSite[]> {
  return sanitizeWatchSites((await chrome.storage.local.get(WATCH_SITES_KEY))[WATCH_SITES_KEY]);
}

/** Adds a site, or replaces the one already saved for the same host in the same place, so the list never reorders. */
export async function saveWatchSite(site: WatchSite): Promise<WatchSite[]> {
  const current = await getWatchSites();
  const index = current.findIndex((s) => s.host === site.host);
  if (index === -1 && current.length >= MAX_WATCH_SITES) throw new Error(`You can add up to ${MAX_WATCH_SITES} sites. Remove one first.`);
  const sites = index === -1 ? [...current, site] : current.map((s, i) => (i === index ? site : s));
  await chrome.storage.local.set({ [WATCH_SITES_KEY]: sites });
  return sites;
}

export async function removeWatchSite(host: string): Promise<WatchSite[]> {
  const sites = (await getWatchSites()).filter((s) => s.host !== host);
  await chrome.storage.local.set({ [WATCH_SITES_KEY]: sites });
  return sites;
}
