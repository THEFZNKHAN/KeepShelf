import {
  buildBookParsed,
  findBookEntity,
  mapBookJsonLd,
  readJsonLdBlocks,
} from "./book-jsonld.js";
import type { ParsedMedia } from "./types.js";

const BOOK_PATH = /^\/books\/([^/?#]+)/i;

export function isBookFilterPage(doc: Document = document): boolean {
  return BOOK_PATH.test(doc.location?.pathname ?? "");
}

export function bookFilterSlugFromUrl(href: string): string | undefined {
  return href.match(/\/books\/([^/?#]+)/i)?.[1];
}

function parseTitleAuthorFromMeta(doc: Document): {
  title?: string;
  author?: string;
} {
  const ogTitle =
    doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ??
    doc.title;
  const match = ogTitle?.match(/^(.+?)\s+by\s+(.+?)(?:\s*\||$)/i);
  if (match) {
    return { title: match[1].trim(), author: match[2].trim() };
  }
  return { title: ogTitle?.split("|")[0]?.trim() };
}

function parsePublishedFromDom(doc: Document): string | undefined {
  const text = doc.body?.textContent?.replace(/\s+/g, " ") ?? "";
  const match = text.match(/Published\s+([A-Za-z]+\s+\d{4})/i);
  if (!match) return undefined;
  const yearMatch = match[1].match(/\d{4}/);
  return yearMatch?.[0];
}

export function parseBookFilterPage(doc: Document): ParsedMedia | null {
  const book = findBookEntity(readJsonLdBlocks(doc));
  if (book) {
    const parsed = mapBookJsonLd(book);
    if (parsed) return parsed;
  }

  const { title, author } = parseTitleAuthorFromMeta(doc);
  if (!title) return null;

  return buildBookParsed({
    title,
    author,
    publishedYear: parsePublishedFromDom(doc),
  });
}
