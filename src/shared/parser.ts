import {
  extractAuthorByLine,
  extractAuthorFromEmbeddedText,
  isGenericBookSubtitle,
  looksLikePersonName,
  parseCommaName,
  pickBestAuthor,
  sanitizeAuthor,
  shouldSkipAboutLink,
} from "./book.js";
import type { MediaType, ParsedMedia } from "./types.js";
import { normalizeYear } from "./year.js";

const ANIME_KEYWORDS = /\b(anime|animation|manga|shōnen|shonen)\b/i;
const BOOK_BY_PATTERN =
  /(?:novel|book(?:\s+series)?|series|saga)\s+by\s+(.+)/i;
const SEPARATOR = /\s*[‧·]\s*/;

const SKIP_HEADING =
  /^(books|about|overview|popular products|people also ask|choose what)/i;

function findTitleElement(doc: Document, scope?: ParentNode): Element | null {
  const searchIn = scope ?? doc;
  const attrTitle = searchIn.querySelector?.('[data-attrid="title"]');
  if (attrTitle?.textContent?.trim()) return attrTitle;

  const container =
    searchIn.querySelector?.(".kp-wholepage-osrp, .Kevs9, #rhs") ?? searchIn;
  for (const h of container.querySelectorAll(
    '[data-attrid="title"], [role="heading"], h1, h2, h3'
  )) {
    const text = h.textContent?.replace(/\s+/g, " ").trim();
    if (!text || text.length > 120 || SKIP_HEADING.test(text)) continue;
    if (h.querySelector?.('[data-attrid="title"]')) continue;
    return h;
  }
  return null;
}

function getPanelTitle(doc: Document, scope?: ParentNode): string | null {
  const fromEl = findTitleElement(doc, scope)?.textContent?.trim();
  if (fromEl) return fromEl;
  const searchIn = scope ?? doc;
  const maindata =
    searchIn.querySelector?.("[data-maindata]") ??
    doc.querySelector("[data-maindata]");
  return parseTitleFromMaindata(maindata?.getAttribute("data-maindata"));
}

function parseTitleFromMaindata(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw.replace(/&quot;/g, '"')) as unknown[];
    const title = arr[2];
    return typeof title === "string" && title.trim() ? title.trim() : null;
  } catch {
    return null;
  }
}

/** Widest practical knowledge-panel root (author/book links often sit outside .kp-wholepage-osrp). */
export function findKnowledgePanelRoot(doc: Document): Element | null {
  const title = findTitleElement(doc);
  if (title) {
    return (
      title.closest(".SLPe5b") ??
      title.closest(".Kevs9") ??
      title.closest(".XqFnDf") ??
      title.closest(".kp-wholepage-osrp") ??
      title.closest(".EyBRub") ??
      title.closest("#rhs") ??
      title.parentElement
    );
  }
  if (getPanelTitle(doc)) {
    return (
      doc.querySelector("#rhs") ??
      doc.querySelector(".kp-wholepage-osrp")?.closest(".SLPe5b") ??
      doc.querySelector(".Kevs9") ??
      null
    );
  }
  return null;
}

/** Google book-series UI often lives in #rhs with author in aria-labels, not title attrs. */
function getKnowledgeSidebar(doc: Document): ParentNode {
  return (
    doc.querySelector("#rhs") ??
    doc.querySelector('[data-hveid] .SLPe5b') ??
    findKnowledgePanelRoot(doc) ??
    doc
  );
}

function getWidePanelScope(scope: ParentNode, doc: Document): ParentNode {
  const sidebar = getKnowledgeSidebar(doc);
  const titleEl = findTitleElement(doc, scope);
  if (!titleEl) return sidebar;
  return (
    titleEl.closest(".SLPe5b") ??
    titleEl.closest(".Kevs9") ??
    titleEl.closest(".XqFnDf") ??
    titleEl.closest(".kp-wholepage-osrp") ??
    titleEl.closest(".EyBRub") ??
    titleEl.closest("#rhs") ??
    sidebar
  );
}

function resolveDocument(
  root: Document | Element,
  doc?: Document
): Document | null {
  if (doc) return doc;
  const g = globalThis as { Document?: typeof Document };
  if (g.Document && root instanceof g.Document) return root as Document;
  return (root as Element).ownerDocument;
}

export function parseKnowledgePanel(
  root: Document | Element,
  doc?: Document
): ParsedMedia | null {
  const document = resolveDocument(root, doc);
  if (!document) return null;

  const g = globalThis as { Document?: typeof Document };
  const scope =
    g.Document && root instanceof g.Document ? root : (root as Element);
  const title = getPanelTitle(document, scope);
  if (!title) return null;
  const subtitle = inferSubtitle(scope, document);

  const maindataEl =
    scope.querySelector("[data-maindata]") ??
    document.querySelector("[data-maindata]");
  const googleType = parseMainDataType(maindataEl?.getAttribute("data-maindata"));

  const type = resolveMediaType(googleType, subtitle, document);
  const subtitleParts = parseSubtitle(subtitle, type);
  const imdbRating = extractImdbRating(scope, document);
  const isBookSeries = isGenericBookSubtitle(subtitle);
  const bookFacts = type === "book" ? extractBookFacts(scope, document, title) : {};
  const publishedYear = isBookSeries
    ? undefined
    : normalizeYear(bookFacts.publishedYear);
  const year =
    type === "book" ? publishedYear : subtitleParts.year;

  return {
    title,
    type,
    subtitle,
    year,
    genre: subtitleParts.genre,
    durationOrSeasons: subtitleParts.durationOrSeasons,
    author: subtitleParts.author ?? bookFacts.author,
    publishedYear,
    imdbRating,
  };
}

function parseMainDataType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const decoded = raw.replace(/&quot;/g, '"');
    const arr = JSON.parse(decoded) as unknown[];
    const types = arr[4];
    if (Array.isArray(types) && types.length > 0) {
      return String(types[0]);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function inferSubtitle(scope: ParentNode, doc: Document): string {
  const attrSub =
    scope.querySelector('[data-attrid="subtitle"]') ??
    doc.querySelector('[data-attrid="subtitle"]');
  if (attrSub?.textContent?.trim()) {
    return attrSub.textContent.replace(/\s+/g, " ").trim();
  }
  const panel = getWidePanelScope(scope, doc);
  const panelText = panel.textContent?.replace(/\s+/g, " ") ?? "";
  const novelSeries = panelText.match(
    /(?:fantasy|fiction|graphic)?\s*(?:novel|book)\s+series/i
  );
  if (novelSeries) return novelSeries[0].trim();
  return "";
}

function looksLikeBookSeriesPanel(doc: Document): boolean {
  const rhs = doc.querySelector("#rhs");
  if (!rhs) return false;
  if (rhs.querySelector('[data-maindata*="BOOKS"]')) return true;
  const text = rhs.textContent ?? "";
  return /(?:novel|book)\s+series/i.test(text);
}

function resolveMediaType(
  googleType: string | null,
  subtitle: string,
  doc: Document
): MediaType {
  if (googleType === "FILM") return "movie";
  if (googleType === "BOOKS") return "book";
  if (looksLikeBookSeriesPanel(doc)) return "book";
  if (googleType === "TV") {
    const query = new URL(doc.location?.href ?? "").searchParams
      .get("q")
      ?.toLowerCase();
    if (query?.includes("anime")) return "anime";
    if (ANIME_KEYWORDS.test(subtitle)) return "anime";
    if (detectAnimeFromDocument(doc)) return "anime";
    return "series";
  }
  if (/novel by/i.test(subtitle)) return "book";
  if (isGenericBookSubtitle(subtitle)) return "book";
  if (/\d{4}\s*[‧·]/.test(subtitle) && /season/i.test(subtitle)) {
    return ANIME_KEYWORDS.test(subtitle) ? "anime" : "series";
  }
  if (/\d{4}\s*[‧·]/.test(subtitle)) return "movie";
  return "movie";
}

function normalizeMediaSubtitle(subtitle: string): string {
  return subtitle
    .replace(/\bCBFC:\s*\w+\b/gi, " ")
    .replace(/\b(?:UA|U\/A)\s*:?\s*\/?[A-Z]?\s*\d*\+?\s*(?:\([^)]+\))?/gi, " ")
    .replace(/\/?\s*A\s*\d+\+\s*\([^)]+\)/gi, " ")
    .replace(/\b\d+\+\s*\([^)]+\)/gi, " ")
    .replace(/(?:^|[‧·]\s*)[\u2044/]?A(?:\s*[‧·]|$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCertificationToken(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  return (
    /^(?:\/+|U\/)?A(?:\s*\d+\+)?(?:\s*\([^)]+\))?$/i.test(t) ||
    /^(?:\/A|U\/A|UA|A|CBFC|PG-?\d+|R|NC-?\d+|TV-?\w+)$/i.test(t) ||
    /^\d+\+(\s*\([^)]+\))?$/i.test(t) ||
    /^\([^)]+\)$/.test(t)
  );
}

function parseSubtitle(
  subtitle: string,
  type: MediaType
): {
  year?: string;
  genre?: string;
  durationOrSeasons?: string;
  author?: string;
} {
  if (type === "book") {
    const authorMatch = subtitle.match(BOOK_BY_PATTERN);
    return { author: authorMatch?.[1]?.trim() };
  }

  const normalized = normalizeMediaSubtitle(subtitle);
  const parts = normalized.split(SEPARATOR).map((p) => p.trim()).filter(Boolean);

  let year: string | undefined;
  let genre: string | undefined;
  let durationOrSeasons: string | undefined;

  for (const part of parts) {
    if (isCertificationToken(part)) continue;

    const embeddedYear = part.match(/\b(19|20)\d{2}\b/);
    if (embeddedYear && !year) {
      year = embeddedYear[0];
      const rest = normalizeMediaSubtitle(
        part.replace(embeddedYear[0], "")
      );
      if (rest && !genre) genre = rest;
      continue;
    }
    if (/^\d{4}$/.test(part)) {
      year = part;
      continue;
    }
    if (/^\d+h|\d+\s*season|episode/i.test(part)) {
      durationOrSeasons = part;
      continue;
    }
    if (!genre) genre = part;
    else durationOrSeasons = part;
  }

  return { year, genre, durationOrSeasons };
}

function extractImdbRating(scope: ParentNode, doc: Document): string | undefined {
  const g = globalThis as { Document?: typeof Document };
  const searchRoot =
    g.Document && scope instanceof g.Document ? scope : doc;
  const labels = searchRoot.querySelectorAll("[aria-label]");
  for (const el of labels) {
    const label = el.getAttribute("aria-label") ?? "";
    if (!/IMDb/i.test(label) || !/scored/i.test(label)) continue;
    const fraction = label.match(/(\d+(?:\.\d+)?)\s*out\s*of\s*10/i);
    if (fraction) return fraction[1];
    const span = el.querySelector(".IcqUx");
    if (span?.textContent) {
      const m = span.textContent.match(/([\d.]+)/);
      if (m) return m[1];
    }
  }
  return undefined;
}

function detectAnimeFromDocument(doc: Document): boolean {
  for (const img of doc.querySelectorAll("img[alt]")) {
    const alt = img.getAttribute("alt") ?? "";
    if (/\bAnime\b/i.test(alt)) return true;
    if (/MyAnimeList/i.test(alt)) return true;
  }
  for (const link of doc.querySelectorAll('a[href*="myanimelist.net"]')) {
    if (link) return true;
  }
  return false;
}

function extractFactValue(container: Element): string | undefined {
  const valueSpan = container.querySelector(
    ".yaIk0d span, .TLIZ span, .XRTiXc span"
  );
  const raw =
    valueSpan?.textContent?.trim() ??
    container.textContent?.replace(/\s+/g, " ").trim();
  if (!raw) return undefined;
  return raw
    .replace(/^(Authors?|Originally published|Published)\s*:?\s*/i, "")
    .trim();
}

function extractBookFacts(
  scope: ParentNode,
  doc: Document,
  title: string
): { author?: string; publishedYear?: string } {
  const g = globalThis as { Document?: typeof Document };
  const panel = getWidePanelScope(scope, doc);
  const factRoot = g.Document && scope instanceof g.Document ? scope : doc;

  let author =
    extractAuthorFromBookPanel(panel, title) ??
    extractAuthorFromBookPanel(getKnowledgeSidebar(doc), title);

  if (!author) {
    for (const el of factRoot.querySelectorAll("[data-attrid]")) {
      const attr = el.getAttribute("data-attrid") ?? "";
      const value = extractFactValue(el);
      if (!value) continue;
      if (/author/i.test(attr)) {
        author = sanitizeAuthor(value);
        if (author) break;
      }
    }
  }

  let publishedYear: string | undefined;
  for (const el of factRoot.querySelectorAll("[data-attrid]")) {
    const attr = el.getAttribute("data-attrid") ?? "";
    const value = extractFactValue(el);
    if (!value) continue;
    if (/originally published|first published/i.test(attr)) {
      publishedYear = value;
      break;
    }
  }

  return { author, publishedYear };
}

function elementText(el: Element): string {
  return (
    el.getAttribute("aria-label") ??
    el.textContent ??
    ""
  )
    .replace(/\s+/g, " ")
    .trim();
}

function extractAuthorFromBookPanel(
  root: ParentNode,
  title: string
): string | undefined {
  const candidates: string[] = [];

  for (const anchor of root.querySelectorAll("a")) {
    const text = elementText(anchor);
    if (!text || shouldSkipAboutLink(text, title)) continue;
    if (looksLikePersonName(text)) candidates.push(text);
    const embedded = extractAuthorFromEmbeddedText(text);
    if (embedded) candidates.push(embedded);
  }

  for (const el of root.querySelectorAll(
    "li, [role='listitem'], button, [role='heading'], h2, h3"
  )) {
    const text = elementText(el);
    if (!text) continue;
    const comma = parseCommaName(text);
    if (comma) candidates.push(comma);
    const embedded = extractAuthorFromEmbeddedText(text);
    if (embedded) candidates.push(embedded);
    const byLine = extractAuthorByLine(text);
    if (byLine) candidates.push(byLine);
  }

  return pickBestAuthor(candidates);
}
