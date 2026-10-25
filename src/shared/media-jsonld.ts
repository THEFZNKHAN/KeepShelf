import type { MediaType } from "./types.js";

export type JsonLdObject = Record<string, unknown>;

export function readJsonLdObjects(doc: Document): JsonLdObject[] {
  const out: JsonLdObject[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const obj = value as JsonLdObject;
    out.push(obj);
    if (Array.isArray(obj["@graph"])) visit(obj["@graph"]);
  };
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    // Letterboxd wraps its JSON-LD in CDATA comments.
    const text = (script.textContent ?? "")
      .replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\//, "")
      .replace(/\/\*\s*\]\]>\s*\*\/\s*$/, "");
    try {
      visit(JSON.parse(text));
    } catch {
      /* ignore malformed blocks */
    }
  }
  return out;
}

export function jsonLdType(obj: JsonLdObject): string | undefined {
  const raw = obj["@type"];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return undefined;
}

const MEDIA_TYPES = new Set(["Movie", "TVSeries", "TVMiniSeries"]);

export function findMediaEntity(doc: Document): JsonLdObject | null {
  return readJsonLdObjects(doc).find((obj) => MEDIA_TYPES.has(jsonLdType(obj) ?? "")) ?? null;
}

export function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

export function genreList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((g) => (typeof g === "string" ? g.trim() : "")).filter(Boolean);
}

export function ratingValue(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  return stringValue((value as JsonLdObject).ratingValue);
}

export function mediaTypeFor(schemaType: string | undefined, genres: string[]): MediaType {
  if (genres.some((g) => /\banime\b/i.test(g))) return "anime";
  return schemaType === "Movie" ? "movie" : "series";
}

/** ISO 8601 durations like PT148M or PT2H28M, as "2h 28m". */
export function formatIsoDuration(raw: string | undefined): string | undefined {
  const match = raw?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!match || (!match[1] && !match[2])) return undefined;
  const total = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}

export function seasonsLabel(count: number): string | undefined {
  if (!Number.isFinite(count) || count <= 0) return undefined;
  return `${count} season${count === 1 ? "" : "s"}`;
}

export function buildMediaSubtitle(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" · ");
}
