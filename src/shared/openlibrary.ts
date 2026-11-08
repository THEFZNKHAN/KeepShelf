import { normalizeTitle, similarity } from "./fuzzy.js";
import type { BookInfo, SavedItem } from "./types.js";

export const OPENLIBRARY_API = "https://openlibrary.org";
export const OPENLIBRARY_COVERS = "https://covers.openlibrary.org/b/id/";
export const OPENLIBRARY_NOTICE = "Book data from Open Library (openlibrary.org).";

/** Open Library asks anonymous clients to stay at or under one request per second. */
export const MIN_REQUEST_GAP_MS = 1100;

const MATCH_THRESHOLD = 0.85;
/** A rating from one or two people is noise, so it isn't shown. */
export const MIN_RATINGS = 5;
const AMBIGUITY_THRESHOLD = 0.95;
const MAX_SUBJECTS = 6;

export class OpenLibraryError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface OpenLibraryClient {
  get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T>;
}

export interface ClientOptions {
  fetchImpl?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * A client that never sends requests closer together than MIN_REQUEST_GAP_MS. Keep one instance alive
 * (the background worker does), because the spacing is remembered per instance.
 */
export function createOpenLibraryClient(options: ClientOptions = {}): OpenLibraryClient {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastRequestAt = Number.NEGATIVE_INFINITY;

  return {
    async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
      const url = new URL(`${OPENLIBRARY_API}${path}`);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
      }
      const wait = lastRequestAt + MIN_REQUEST_GAP_MS - now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = now();

      let response;
      try {
        response = await fetchImpl(url.toString(), { headers: { accept: "application/json" } });
      } catch {
        throw new OpenLibraryError("Could not reach Open Library. Check your connection.");
      }
      if (response.status === 429 || response.status === 403) {
        throw new OpenLibraryError("Open Library is limiting requests right now. Try again in a minute.", response.status);
      }
      if (response.status === 404) throw new OpenLibraryError("Not found on Open Library.", 404);
      if (!response.ok) throw new OpenLibraryError(`Open Library returned an error (${response.status}).`, response.status);
      return (await response.json()) as T;
    },
  };
}

export function isBookItem(item: Pick<SavedItem, "type">): boolean {
  return item.type === "book";
}

interface SearchDoc {
  key: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  number_of_pages_median?: number;
  subject?: string[];
  ratings_average?: number;
  ratings_count?: number;
  cover_i?: number;
  edition_count?: number;
  /** The editions that matched the query, with their titles. Open Library files many books under the original-language title. */
  editions?: { docs?: Array<{ title?: string }> };
}

function lastNames(names: string | string[] | undefined): Set<string> {
  const list = Array.isArray(names) ? names : [names ?? ""];
  const out = new Set<string>();
  for (const entry of list) {
    for (const part of entry.toLowerCase().split(/,|&| and /)) {
      const last = part.trim().split(/\s+/).pop();
      if (last) out.add(last.replace(/[^\p{L}\p{N}-]/gu, ""));
    }
  }
  out.delete("");
  return out;
}

/** true or false when both sides name authors, undefined when either side is unknown. */
export function authorsMatch(wanted: string | undefined, candidates: string[] | undefined): boolean | undefined {
  const a = lastNames(wanted);
  const b = lastNames(candidates);
  if (a.size === 0 || b.size === 0) return undefined;
  return [...a].some((name) => b.has(name));
}

/** "Drive: The Surprising Truth About What Motivates Us" is found as just "Drive". */
export function mainTitle(title: string): string {
  return title.split(/\s*:\s+|\s+[-–—]\s+/)[0].trim() || title;
}

/** The best search result for a saved book, or undefined rather than a wrong guess. */
export function pickBestBook(
  docs: SearchDoc[],
  wanted: { title: string; author?: string }
): SearchDoc | undefined {
  const full = normalizeTitle(wanted.title);
  const main = normalizeTitle(mainTitle(wanted.title));
  const scored: Array<{ doc: SearchDoc; score: number }> = [];

  for (const doc of docs) {
    if (!doc.title) continue;
    const match = authorsMatch(wanted.author, doc.author_name);
    if (match === false) continue;
    // Open Library often files a book under its original-language title ("O Alquimista" for The Alchemist),
    // with the title you know listed as an edition. So a book matches on its work title or any matching edition.
    const titles = [doc.title, ...(doc.editions?.docs ?? []).map((e) => e.title ?? "")].filter(Boolean);
    const score = Math.max(0, ...titles.map((t) => { const c = normalizeTitle(t); return Math.max(similarity(full, c), similarity(main, c)); }));
    if (score < MATCH_THRESHOLD) continue;
    scored.push({ doc, score });
  }
  if (scored.length === 0) return undefined;

  const unknownAuthor = authorsMatch(wanted.author, ["x"]) === undefined;
  if (unknownAuthor) {
    // Without an author, only trust a title that is both near-exact and unambiguous.
    const strong = scored.filter((s) => s.score >= AMBIGUITY_THRESHOLD);
    return strong.length === 1 ? strong[0].doc : undefined;
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (b.doc.ratings_count ?? 0) - (a.doc.ratings_count ?? 0) ||
      (b.doc.edition_count ?? 0) - (a.doc.edition_count ?? 0)
  );
  return scored[0].doc;
}

const JUNK_SUBJECT = /accessible book|protected daisy|in library|large type|large print|lending library|open library|overdrive|internet archive|nyt:|reading level|bestseller|best seller|new york times|award|juvenile|translations? into|^\s*\d/i;

/** Open Library subjects are crowdsourced and noisy. Keep short, topical ones and drop catalogue labels. */
export function cleanSubjects(subjects: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of subjects ?? []) {
    // "Dune (Imaginary place)" names a place or a character, not a genre.
    if (/\((imaginary|fictitious)[^)]*\)/i.test(raw)) continue;
    // "Motivation (Psychology)" reads better as "Motivation".
    const subject = raw.replace(/\s*\([^)]*\)/g, "").trim().replace(/\s+/g, " ");
    // Digits and commas mean dates or inverted names; accented letters mean another language's catalogue entry.
    if (!subject || subject.length > 32 || /\d|,|[^\x00-\x7F]/.test(subject)) continue;
    if (JUNK_SUBJECT.test(subject) || subject.split(" ").length > 4) continue;
    // "Fantasy - epic" and "Success- psychological aspects" are sub-categories of another subject, not genres.
    if (/\s[-–—]|[-–—]\s/.test(subject)) continue;
    const text = subject.charAt(0).toUpperCase() + subject.slice(1);
    // "Science fiction" and "Science-fiction" are the same subject.
    const key = text.toLowerCase().replace(/[^a-z]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_SUBJECTS) break;
  }
  return out;
}

/** How many genres a book shows and offers as tags. The rest of the subjects are mostly catalogue noise. */
export const MAX_BOOK_GENRES = 3;

/**
 * The genres for a book: cleaned again at read time (so books fetched before a cleaning rule existed are
 * fixed too), and limited to the few the row actually shows, so the tag filter matches what you see.
 */
export function bookGenres(info: Pick<BookInfo, "subjects"> | undefined): string[] {
  return cleanSubjects(info?.subjects).slice(0, MAX_BOOK_GENRES);
}

/** The plain description: no markdown links, no "source" footers, no catalogue sections after a rule. */
export function cleanDescription(raw: unknown): string | undefined {
  const text = typeof raw === "string" ? raw : typeof (raw as { value?: unknown })?.value === "string" ? (raw as { value: string }).value : "";
  const cleaned = text
    .split(/\r?\n\s*-{3,}/)[0]
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\(\[source\]\[\d+\]\)/gi, "")
    .replace(/\*\*|__/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length >= 20 ? cleaned : undefined;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function toBookInfo(doc: SearchDoc, description: string | undefined, now = Date.now()): BookInfo {
  const info: BookInfo = { workKey: doc.key, subjects: cleanSubjects(doc.subject), fetchedAt: now };
  if (doc.number_of_pages_median && doc.number_of_pages_median > 0) info.pages = Math.round(doc.number_of_pages_median);
  if (doc.ratings_average && doc.ratings_count && doc.ratings_count >= MIN_RATINGS) {
    info.rating = round1(doc.ratings_average);
    info.ratingsCount = doc.ratings_count;
  }
  if (description) info.description = description;
  if (doc.first_publish_year) info.firstPublishYear = doc.first_publish_year;
  if (doc.cover_i) info.coverId = doc.cover_i;
  return info;
}

const SEARCH_FIELDS =
  "key,title,author_name,first_publish_year,number_of_pages_median,subject,ratings_average,ratings_count,cover_i,edition_count,editions";

/** The rating to show: only when enough people have rated it. Also applied to info saved before the rule existed. */
export function bookRating(info: Pick<BookInfo, "rating" | "ratingsCount"> | undefined): number | undefined {
  return info?.rating && (info.ratingsCount ?? 0) >= MIN_RATINGS ? info.rating : undefined;
}

/** Finds a saved book on Open Library by title and author, then reads its description. */
export async function lookupBook(
  client: OpenLibraryClient,
  item: Pick<SavedItem, "title" | "author">,
  now = Date.now()
): Promise<BookInfo | undefined> {
  // A free-text search also looks inside edition titles, which a title search does not.
  const search = await client.get<{ docs?: SearchDoc[] }>("/search.json", {
    q: [mainTitle(item.title), item.author].filter(Boolean).join(" "),
    limit: 10,
    fields: SEARCH_FIELDS,
    "editions.fields": "key,title",
    "editions.rows": 3,
  });
  const doc = pickBestBook(search.docs ?? [], { title: item.title, author: item.author });
  if (!doc) return undefined;

  let description: string | undefined;
  try {
    const work = await client.get<{ description?: unknown }>(`${doc.key}.json`);
    description = cleanDescription(work.description);
  } catch (err) {
    // A missing description is fine, but being rate limited means everything after it will fail too.
    if (err instanceof OpenLibraryError && (err.status === 429 || err.status === 403)) throw err;
  }
  return toBookInfo(doc, description, now);
}

/** Validates book info read from a backup. Anything malformed is dropped. */
export function sanitizeBookInfo(raw: unknown): BookInfo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.workKey !== "string" || !/^\/works\/OL\d+W$/.test(r.workKey)) return undefined;
  if (typeof r.fetchedAt !== "number") return undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const info: BookInfo = {
    workKey: r.workKey,
    subjects: Array.isArray(r.subjects) ? r.subjects.filter((s): s is string => typeof s === "string" && s.trim() !== "").slice(0, MAX_SUBJECTS) : [],
    fetchedAt: r.fetchedAt,
  };
  const optional: Partial<BookInfo> = {
    pages: num(r.pages),
    rating: num(r.rating),
    ratingsCount: num(r.ratingsCount),
    description: str(r.description),
    firstPublishYear: num(r.firstPublishYear),
    coverId: num(r.coverId),
  };
  for (const [key, value] of Object.entries(optional)) if (value !== undefined) (info as unknown as Record<string, unknown>)[key] = value;
  return info;
}

export function bookCoverUrl(item: Pick<SavedItem, "bookInfo">, size: "S" | "M" | "L" = "S"): string | undefined {
  return item.bookInfo?.coverId ? `${OPENLIBRARY_COVERS}${item.bookInfo.coverId}-${size}.jpg` : undefined;
}

/** Total pages: your own number, else the page count from Open Library. */
export function totalPages(item: Pick<SavedItem, "progressTotal" | "bookInfo">): number | undefined {
  return item.progressTotal ?? item.bookInfo?.pages;
}
