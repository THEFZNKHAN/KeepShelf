import type { SavedItem } from "./types.js";
import { isGenericBookSubtitle } from "./book.js";
import { durationText } from "./tmdb.js";
import { normalizeYear } from "./year.js";

function formatBookRatingLabel(item: SavedItem): string | undefined {
  if (!item.imdbRating) return undefined;
  const url = item.sourceUrl ?? "";
  if (url.includes("goodreads.com")) return `GR ${item.imdbRating}`;
  if (url.includes("book-filter.com")) return `BF ${item.imdbRating}`;
  return undefined;
}

function formatBookTitlePart(item: SavedItem): string {
  if (item.author) return `${item.title} (${item.author})`;
  return item.title;
}

function formatRatingLabel(item: SavedItem): string | undefined {
  if (!item.imdbRating) return undefined;
  if (item.type === "book") return formatBookRatingLabel(item);
  const url = item.sourceUrl ?? "";
  if (url.includes("myanimelist.net")) return `MAL ${item.imdbRating}`;
  if (url.includes("letterboxd.com")) return `LB ${item.imdbRating}`;
  if (url.includes("rottentomatoes.com")) return `RT ${item.imdbRating}%`;
  if (url.includes("trakt.tv")) return `Trakt ${item.imdbRating}`;
  return `IMDb ${item.imdbRating}`;
}

export { formatRatingLabel, formatBookTitlePart };

export function formatDurationOrSeasons(value: string): string {
  const seasonMatch = value.match(/^(\d+)\s*seasons?$/i);
  if (seasonMatch) {
    return `S${seasonMatch[1].padStart(2, "0")}`;
  }
  return value;
}

/**
 * Shortens long text to at most `max` characters, cutting at a word boundary and adding an ellipsis.
 * Paragraph breaks are kept, so a clipped description still reads as paragraphs.
 */
export function clipText(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  // If the next character is whitespace the cut already ends a word; otherwise back up to the last space.
  const endsWord = /\s/.test(clean[max] ?? "");
  const lastSpace = cut.search(/\s\S*$/);
  const base = endsWord || lastSpace <= max * 0.6 ? cut : cut.slice(0, lastSpace);
  return `${base.replace(/[\s,.;:!?-]+$/, "")}…`;
}

export function formatItemLine(item: SavedItem): string {
  if (item.type === "tab" || item.type === "link") {
    return item.url ? `${item.title} | ${item.url}` : item.title;
  }

  if (item.type === "note") {
    return (item.body ?? item.title).trim();
  }

  const parts: string[] = [];

  if (item.type === "book") {
    parts.push(formatBookTitlePart(item));

    const year = isGenericBookSubtitle(item.subtitle)
      ? undefined
      : normalizeYear(item.publishedYear ?? item.year);
    if (year) parts.push(year);
    else if (
      item.subtitle &&
      !item.author &&
      !isGenericBookSubtitle(item.subtitle)
    ) {
      parts.push(item.subtitle);
    }

    const rating = formatBookRatingLabel(item);
    if (rating) parts.push(rating);
    return parts.join(" | ");
  }

  const titleWithYear = item.year
    ? `${item.title} (${item.year})`
    : item.title;
  parts.push(titleWithYear);

  const duration = durationText(item);
  if (duration) {
    parts.push(formatDurationOrSeasons(duration));
  }
  const rating = formatRatingLabel(item);
  if (rating) parts.push(rating);

  const line = parts.join(" | ");
  return item.type === "anime" ? `${line} (A)` : line;
}

export function formatItemsList(items: SavedItem[]): string {
  return items.map(formatItemLine).join("\n");
}
