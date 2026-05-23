import type { SavedItem } from "./types.js";
import { isGenericBookSubtitle } from "./book.js";
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
  return `IMDb ${item.imdbRating}`;
}

export { formatRatingLabel, formatBookTitlePart };

function formatDurationOrSeasons(value: string): string {
  const seasonMatch = value.match(/^(\d+)\s*seasons?$/i);
  if (seasonMatch) {
    return `S${seasonMatch[1].padStart(2, "0")}`;
  }
  return value;
}

export function formatItemLine(item: SavedItem): string {
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

  if (item.durationOrSeasons) {
    parts.push(formatDurationOrSeasons(item.durationOrSeasons));
  }
  const rating = formatRatingLabel(item);
  if (rating) parts.push(rating);

  return parts.join(" | ");
}

export function formatItemsList(items: SavedItem[]): string {
  return items.map(formatItemLine).join("\n");
}
