import { bookFilterSlugFromUrl, isBookFilterPage, parseBookFilterPage } from "../shared/book-filter.js";
import { goodreadsBookIdFromUrl, isGoodreadsBookPage, parseGoodreadsPage } from "../shared/goodreads.js";
import { imdbIdFromUrl, isImdbTitlePage, parseImdbPage } from "../shared/imdb.js";
import { isLetterboxdFilmPage, letterboxdSlugFromUrl, parseLetterboxdPage } from "../shared/letterboxd.js";
import { isMalAnimePage, malIdFromUrl, parseMalPage } from "../shared/mal.js";
import { readJsonLdObjects } from "../shared/media-jsonld.js";
import { findKnowledgePanelRoot, parseKnowledgePanel } from "../shared/parser.js";
import {
  isRottenTomatoesTitlePage,
  parseRottenTomatoesPage,
  rottenTomatoesSlugFromUrl,
} from "../shared/rottentomatoes.js";
import { isSeriesGraphShowPage, parseSeriesGraphPage, seriesGraphQueryFromUrl } from "../shared/seriesgraph.js";
import { isTraktTitlePage, parseTraktPage, traktSlugFromUrl } from "../shared/trakt.js";
import type { ParsedMedia } from "../shared/types.js";

type PageData = ParsedMedia & { googleQuery: string; sourceUrl: string };

function withSource(
  parsed: ParsedMedia | null,
  query: string | undefined,
  sourceUrl = location.href.split("?")[0]
): PageData | null {
  if (!parsed) return null;
  return { ...parsed, googleQuery: query || parsed.title, sourceUrl };
}

function isGoogleSearchPage(): boolean {
  return location.hostname.endsWith("google.com") && location.pathname.startsWith("/search");
}

function parseGoogleSearch(): ParsedMedia | null {
  const panel = findKnowledgePanelRoot(document);
  return panel ? parseKnowledgePanel(panel, document) : null;
}

const loadedAt = Date.now();
const SERIES_GRAPH_CHART_WAIT_MS = 15000;
const TRAKT_RENDER_WAIT_MS = 4000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The season chart renders after the title, so give it time to appear before saving without seasons. */
async function parseSeriesGraphWhenReady(): Promise<ParsedMedia | null> {
  let parsed = parseSeriesGraphPage(document);
  while (parsed && !parsed.durationOrSeasons && Date.now() - loadedAt < SERIES_GRAPH_CHART_WAIT_MS) {
    await sleep(250);
    parsed = parseSeriesGraphPage(document);
  }
  return parsed;
}

/** Trakt renders its JSON-LD client-side, including after in-app navigation. */
async function parseTraktWhenReady(): Promise<ParsedMedia | null> {
  const deadline = Date.now() + TRAKT_RENDER_WAIT_MS;
  let parsed = parseTraktPage(document);
  while (!parsed && Date.now() < deadline) {
    await sleep(250);
    parsed = parseTraktPage(document);
  }
  return parsed;
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value, location.href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function jsonLdImage(): string | undefined {
  for (const obj of readJsonLdObjects(document)) {
    const raw = Array.isArray(obj.image) ? obj.image[0] : obj.image;
    const url = httpUrl(typeof raw === "object" && raw ? (raw as { url?: unknown }).url : raw);
    if (url) return url;
  }
  return undefined;
}

function ogImage(): string | undefined {
  return httpUrl(document.querySelector('meta[property="og:image"]')?.getAttribute("content"));
}

type Site = "goodreads" | "bookfilter" | "imdb" | "seriesgraph" | "mal" | "letterboxd" | "rt" | "trakt" | "google";

/** Picks the source that gives a poster-shaped image; some og:images are wide share cards. */
function posterFor(site: Site): string | undefined {
  switch (site) {
    case "google":
      return undefined;
    case "rt":
      return ogImage() ?? jsonLdImage();
    case "trakt":
      return jsonLdImage();
    case "seriesgraph":
      return httpUrl(document.querySelector<HTMLImageElement>('img[id^="poster-"]')?.getAttribute("src")) ?? ogImage();
    default:
      return jsonLdImage() ?? ogImage();
  }
}

function detectSite(): Site | null {
  const host = location.hostname;
  if (host === "www.goodreads.com" && isGoodreadsBookPage()) return "goodreads";
  if (host === "www.book-filter.com" && isBookFilterPage()) return "bookfilter";
  if (host === "www.imdb.com" && isImdbTitlePage()) return "imdb";
  if (host === "seriesgraph.com" && isSeriesGraphShowPage()) return "seriesgraph";
  if (host === "myanimelist.net" && isMalAnimePage()) return "mal";
  if (host === "letterboxd.com" && isLetterboxdFilmPage()) return "letterboxd";
  if (host === "www.rottentomatoes.com" && isRottenTomatoesTitlePage()) return "rt";
  if ((host === "app.trakt.tv" || host === "trakt.tv") && isTraktTitlePage()) return "trakt";
  if (isGoogleSearchPage()) return "google";
  return null;
}

async function parseSite(site: Site): Promise<PageData | null> {
  const href = location.href;
  switch (site) {
    case "goodreads":
      return withSource(parseGoodreadsPage(document), goodreadsBookIdFromUrl(href));
    case "bookfilter":
      return withSource(parseBookFilterPage(document), bookFilterSlugFromUrl(href));
    case "imdb":
      return withSource(parseImdbPage(document), imdbIdFromUrl(href));
    case "seriesgraph":
      return withSource(await parseSeriesGraphWhenReady(), seriesGraphQueryFromUrl(href), href);
    case "mal":
      return withSource(parseMalPage(document), malIdFromUrl(href));
    case "letterboxd":
      return withSource(parseLetterboxdPage(document), letterboxdSlugFromUrl(href));
    case "rt":
      return withSource(parseRottenTomatoesPage(document), rottenTomatoesSlugFromUrl(href));
    case "trakt":
      return withSource(await parseTraktWhenReady(), traktSlugFromUrl(href));
    case "google":
      return withSource(parseGoogleSearch(), new URL(href).searchParams.get("q") ?? undefined, href);
  }
}

async function readPage(): Promise<PageData | null> {
  const site = detectSite();
  if (!site) return null;
  const data = await parseSite(site);
  if (!data) return null;
  const imageUrl = data.imageUrl ?? posterFor(site);
  return imageUrl ? { ...data, imageUrl } : data;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== "getPageData") return false;
  readPage()
    .then((item) => sendResponse({ item }))
    .catch(() => sendResponse({ item: null }));
  return true;
});
