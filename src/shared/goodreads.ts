import {
  buildBookParsed,
  findBookEntity,
  mapBookJsonLd,
  parsePublishedFromText,
  readJsonLdBlocks,
} from "./book-jsonld.js";
import type { ParsedMedia } from "./types.js";
import { normalizeYear } from "./year.js";

const BOOK_PATH = /^\/book\/show\/(\d+)/i;

export function isGoodreadsBookPage(doc: Document = document): boolean {
  return BOOK_PATH.test(doc.location?.pathname ?? "");
}

export function goodreadsBookIdFromUrl(href: string): string | undefined {
  return href.match(/\/book\/show\/(\d+)/i)?.[1];
}

function parsePublishedFromDom(doc: Document): string | undefined {
  for (const el of doc.querySelectorAll(
    '[data-testid="pubInfoBox"], .BookDetails, .FeaturedDetails, p, span, div'
  )) {
    const text = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!/first published/i.test(text)) continue;
    const year = parsePublishedFromText(text);
    if (year) return year;
  }

  const bodyText = doc.body?.textContent?.replace(/\s+/g, " ") ?? "";
  const match = bodyText.match(
    /First published\s+([^·]+?)(?:\s+Book details|\s+Genres|$)/i
  );
  return match ? normalizeYear(match[1].trim()) : undefined;
}

function parseTitleFromDom(doc: Document): string | undefined {
  return (
    doc.querySelector('[data-testid="bookTitle"]')?.textContent?.trim() ??
    doc.querySelector("h1")?.textContent?.trim() ??
    doc
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content")
      ?.replace(/\s*by\s+.+$/i, "")
      .trim()
  );
}

function parseAuthorFromDom(doc: Document): string | undefined {
  const authorLink = doc.querySelector(
    'a[href*="/author/show/"], [data-testid="name"] a, .authorName a'
  );
  const fromLink = authorLink?.textContent?.replace(/\s+/g, " ").trim();
  if (fromLink) return fromLink;

  const ogTitle = doc
    .querySelector('meta[property="og:title"]')
    ?.getAttribute("content");
  const match = ogTitle?.match(/\sby\s+(.+?)(?:\s*\||$)/i);
  return match?.[1]?.trim();
}

function parseRatingFromDom(doc: Document): string | undefined {
  const aria = doc.querySelector('[aria-label*="rating" i]');
  const fromAria = aria
    ?.getAttribute("aria-label")
    ?.match(/([\d.]+)\s*out of/i)?.[1];
  if (fromAria) return fromAria;

  const ratingEl = doc.querySelector(
    '[data-testid="rating"], .RatingStatistics__rating, .AverageRating'
  );
  const text = ratingEl?.textContent?.replace(/\s+/g, " ").trim();
  if (text && /^\d+(?:\.\d+)?$/.test(text)) return text;

  const bodyMatch = doc.body?.textContent?.match(
    /(\d+(?:\.\d+)?)\s*[\d,]+\s*ratings/i
  );
  return bodyMatch?.[1];
}

export function parseGoodreadsPage(doc: Document): ParsedMedia | null {
  const book = findBookEntity(readJsonLdBlocks(doc));
  if (book) {
    const parsed = mapBookJsonLd(book);
    if (parsed) {
      if (!parsed.publishedYear) {
        parsed.publishedYear = parsePublishedFromDom(doc);
        parsed.year = parsed.publishedYear;
      }
      if (!parsed.imdbRating) {
        parsed.imdbRating = parseRatingFromDom(doc);
      }
      return parsed;
    }
  }

  const title = parseTitleFromDom(doc);
  if (!title) return null;

  const author = parseAuthorFromDom(doc);
  const publishedYear = parsePublishedFromDom(doc);

  return buildBookParsed({
    title,
    author,
    publishedYear,
    rating: parseRatingFromDom(doc),
  });
}
