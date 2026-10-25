import {
  buildMediaSubtitle,
  findMediaEntity,
  formatIsoDuration,
  genreList,
  jsonLdType,
  mediaTypeFor,
  ratingValue,
  stringValue,
} from "./media-jsonld.js";
import type { ParsedMedia } from "./types.js";
import { normalizeYear } from "./year.js";

const TITLE_PATH = /^\/(movies|shows)\/([^/?#]+)\/?$/i;

export function isTraktTitlePage(doc: Document = document): boolean {
  return TITLE_PATH.test(doc.location?.pathname ?? "");
}

export function traktSlugFromUrl(href: string): string | undefined {
  return href.match(/\/(?:movies|shows)\/([^/?#]+)/i)?.[1];
}

/** Trakt is a single-page app; its JSON-LD can still describe the previous title right after navigating. */
function describesCurrentPage(entityUrl: string | undefined, doc: Document): boolean {
  if (!entityUrl) return true;
  try {
    return new URL(entityUrl).pathname.replace(/\/$/, "") === (doc.location?.pathname ?? "").replace(/\/$/, "");
  } catch {
    return true;
  }
}

export function parseTraktPage(doc: Document): ParsedMedia | null {
  const entity = findMediaEntity(doc);
  if (!entity || !describesCurrentPage(stringValue(entity.url), doc)) return null;
  const title = stringValue(entity.name);
  if (!title) return null;

  const genres = genreList(entity.genre);
  const year = normalizeYear(stringValue(entity.datePublished));
  const durationOrSeasons = formatIsoDuration(stringValue(entity.duration));
  const genre = genres.slice(0, 2).join("/") || undefined;

  return {
    title,
    type: mediaTypeFor(jsonLdType(entity), genres),
    subtitle: buildMediaSubtitle([year, genre, durationOrSeasons]) || "Trakt",
    year,
    genre,
    durationOrSeasons,
    imdbRating: ratingValue(entity.aggregateRating),
  };
}
