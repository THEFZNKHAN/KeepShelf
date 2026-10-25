import {
  buildMediaSubtitle,
  findMediaEntity,
  genreList,
  jsonLdType,
  mediaTypeFor,
  ratingValue,
  seasonsLabel,
  stringValue,
} from "./media-jsonld.js";
import type { ParsedMedia } from "./types.js";
import { normalizeYear } from "./year.js";

const TITLE_PATH = /^\/(m|tv)\/[^/]+\/?$/i;

export function isRottenTomatoesTitlePage(doc: Document = document): boolean {
  return TITLE_PATH.test(doc.location?.pathname ?? "");
}

export function rottenTomatoesSlugFromUrl(href: string): string | undefined {
  return href.match(/rottentomatoes\.com\/(?:m|tv)\/([^/?#]+)/i)?.[1]?.replace(/_/g, " ");
}

/** The page hero data holds runtime ("2h 28m") or season count ("5 Seasons") that JSON-LD lacks. */
function readHeroMetadata(doc: Document): string[] {
  const raw = doc.querySelector("#media-hero-json")?.textContent;
  if (!raw) return [];
  try {
    const props = (JSON.parse(raw) as { content?: { metadataProps?: unknown } }).content?.metadataProps;
    return Array.isArray(props) ? props.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function durationFromHero(props: string[], numberOfSeasons: unknown): string | undefined {
  const fromSchema = seasonsLabel(Number(numberOfSeasons));
  if (fromSchema) return fromSchema;
  for (const prop of props) {
    const seasons = prop.match(/^(\d+)\s+seasons?$/i);
    if (seasons) return seasonsLabel(Number(seasons[1]));
    if (/^\d+h(?:\s+\d+m)?$|^\d+m$/i.test(prop.trim())) return prop.trim();
  }
  return undefined;
}

export function parseRottenTomatoesPage(doc: Document): ParsedMedia | null {
  const entity = findMediaEntity(doc);
  if (!entity) return null;
  const title = stringValue(entity.name);
  if (!title) return null;

  const genres = genreList(entity.genre);
  const year = normalizeYear(stringValue(entity.dateCreated) ?? stringValue(entity.datePublished));
  const durationOrSeasons = durationFromHero(readHeroMetadata(doc), entity.numberOfSeasons);
  const genre = genres.slice(0, 2).join("/") || undefined;

  return {
    title,
    type: mediaTypeFor(jsonLdType(entity), genres),
    subtitle: buildMediaSubtitle([year, genre, durationOrSeasons]) || "Rotten Tomatoes",
    year,
    genre,
    durationOrSeasons,
    imdbRating: ratingValue(entity.aggregateRating),
  };
}
