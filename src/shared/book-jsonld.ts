import type { ParsedMedia } from "./types.js";
import { normalizeYear } from "./year.js";

export function readJsonLdBlocks(doc: Document): unknown[] {
  const out: unknown[] = [];
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent ?? "");
      flattenJsonLd(parsed, out);
    } catch {
      /* ignore */
    }
  }
  return out;
}

function flattenJsonLd(value: unknown, out: unknown[]): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, out);
    return;
  }
  if (typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  out.push(obj);
  if (Array.isArray(obj["@graph"])) flattenJsonLd(obj["@graph"], out);
}

function normalizeSchemaType(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return undefined;
}

export function findBookEntity(
  blocks: unknown[]
): Record<string, unknown> | null {
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const obj = block as Record<string, unknown>;
    const type = normalizeSchemaType(obj["@type"]);
    if (type === "Book") return obj;
  }
  return null;
}

function stringField(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function parseAuthor(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return raw.trim() || undefined;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const name = parseAuthor(item);
      if (name) return name;
    }
    return undefined;
  }
  if (typeof raw === "object") {
    return stringField((raw as Record<string, unknown>).name);
  }
  return undefined;
}

function parseRating(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = (raw as Record<string, unknown>).ratingValue;
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim() || undefined;
  return undefined;
}

function parseGenres(raw: unknown): string | undefined {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const genres = values
    .map((g) => (typeof g === "string" ? g.trim() : ""))
    .filter(Boolean);
  return genres.slice(0, 2).join("/") || undefined;
}

export function parsePublishedFromText(text: string): string | undefined {
  const match = text.match(
    /(?:first\s+)?published\s+(?:on\s+)?(.+?)(?:\s+by\s+|$)/i
  );
  if (!match) return undefined;
  return normalizeYear(match[1].trim());
}

export function buildBookParsed(options: {
  title: string;
  author?: string;
  publishedYear?: string;
  rating?: string;
  genre?: string;
  pages?: number;
  subtitlePrefix?: string;
}): ParsedMedia {
  const { title, author, publishedYear, rating, genre, pages, subtitlePrefix } =
    options;
  const parts: string[] = [];
  if (author) parts.push(`${subtitlePrefix ?? "Novel"} by ${author}`);
  else parts.push(subtitlePrefix ?? "Novel");
  if (pages) parts.push(`${pages} pages`);

  return {
    title,
    type: "book",
    subtitle: parts.join(" · "),
    author,
    publishedYear,
    year: publishedYear,
    genre,
    imdbRating: rating,
  };
}

export function mapBookJsonLd(book: Record<string, unknown>): ParsedMedia | null {
  const title = stringField(book.name);
  if (!title) return null;

  const author = parseAuthor(book.author);
  const publishedYear = normalizeYear(stringField(book.datePublished));
  const rating = parseRating(book.aggregateRating);
  const genre = parseGenres(book.genre);
  const pages =
    typeof book.numberOfPages === "number"
      ? book.numberOfPages
      : typeof book.numberOfPages === "string" &&
          /^\d+$/.test(book.numberOfPages)
        ? Number(book.numberOfPages)
        : undefined;

  return buildBookParsed({
    title,
    author,
    publishedYear,
    rating,
    genre,
    pages,
  });
}
