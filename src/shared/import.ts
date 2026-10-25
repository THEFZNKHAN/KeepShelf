import { buildBookParsed } from "./book-jsonld.js";
import type { ImportItem, MediaType, SavedItem } from "./types.js";
import { normalizeYear } from "./year.js";

const MEDIA_TYPES = new Set<MediaType>(["movie", "series", "anime", "book", "tab", "link", "note"]);

export const BACKUP_APP = "KeepShelf";
export const BACKUP_VERSION = 1;

export function buildBackup(items: SavedItem[]): string {
  return JSON.stringify(
    { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), items },
    null,
    2
  );
}

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim()));
}

function toRecords(rows: string[][]): Record<string, string>[] {
  const [header, ...body] = rows;
  if (!header) return [];
  const names = header.map((h) => h.trim());
  return body.map((cells) => Object.fromEntries(names.map((name, i) => [name, (cells[i] ?? "").trim()])));
}

function parseDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value.replace(/\//g, "-"));
  return Number.isNaN(time) ? undefined : time;
}

/** Strips Goodreads' ="..." spreadsheet guard. */
function unguard(value: string | undefined): string {
  return (value ?? "").replace(/^="?(.*?)"?$/, "$1").trim();
}

export function fromLetterboxdCsv(records: Record<string, string>[], fileName: string): ImportItem[] {
  const watched = !/watchlist/i.test(fileName) && /watched|diary|ratings|reviews/i.test(fileName);
  const items: ImportItem[] = [];
  for (const r of records) {
    const title = r["Name"];
    if (!title) continue;
    const year = normalizeYear(r["Year"]);
    const url = r["Letterboxd URI"] || "";
    const savedAt = parseDate(r["Watched Date"] || r["Date"]);
    items.push({
      type: "movie",
      title,
      year,
      subtitle: year ?? "Letterboxd",
      googleQuery: title,
      sourceUrl: url,
      ...(savedAt ? { savedAt } : {}),
      ...(watched ? { done: true, doneAt: savedAt } : {}),
    });
  }
  return items;
}

export function fromGoodreadsCsv(records: Record<string, string>[]): ImportItem[] {
  const items: ImportItem[] = [];
  for (const r of records) {
    const title = r["Title"];
    if (!title) continue;
    const publishedYear = normalizeYear(r["Original Publication Year"] || r["Year Published"]);
    const rating = Number(r["Average Rating"]) > 0 ? r["Average Rating"] : undefined;
    const parsed = buildBookParsed({ title, author: r["Author"] || undefined, publishedYear, rating });
    const id = unguard(r["Book Id"]);
    const savedAt = parseDate(r["Date Added"]);
    const done = r["Exclusive Shelf"] === "read";
    items.push({
      ...parsed,
      googleQuery: id || title,
      sourceUrl: id ? `https://www.goodreads.com/book/show/${id}` : "",
      ...(savedAt ? { savedAt } : {}),
      ...(done ? { done: true, doneAt: parseDate(r["Date Read"]) ?? savedAt } : {}),
    });
  }
  return items;
}

function isImportItem(value: unknown): value is ImportItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.title === "string" && v.title.trim() !== "" && MEDIA_TYPES.has(v.type as MediaType);
}

export function fromBackupJson(text: string): ImportItem[] {
  const data = JSON.parse(text) as unknown;
  const list = Array.isArray(data) ? data : (data as { items?: unknown })?.items;
  if (!Array.isArray(list)) throw new Error("This JSON file isn't a KeepShelf backup.");
  return list.filter(isImportItem).map((raw) => {
    const { id: _id, ...rest } = raw as ImportItem & { id?: string };
    return {
      ...rest,
      subtitle: typeof rest.subtitle === "string" ? rest.subtitle : "",
      googleQuery: typeof rest.googleQuery === "string" ? rest.googleQuery : rest.title,
      sourceUrl: typeof rest.sourceUrl === "string" ? rest.sourceUrl : "",
      savedAt: typeof rest.savedAt === "number" ? rest.savedAt : undefined,
    };
  });
}

export type ImportSource = "KeepShelf backup" | "Letterboxd" | "Goodreads";

export function parseImportFile(text: string, fileName: string): { source: ImportSource; items: ImportItem[] } {
  if (/\.json$/i.test(fileName) || /^\s*[[{]/.test(text)) {
    return { source: "KeepShelf backup", items: fromBackupJson(text) };
  }
  const records = toRecords(parseCsv(text));
  const columns = new Set(Object.keys(records[0] ?? {}));
  if (columns.has("Letterboxd URI")) {
    return { source: "Letterboxd", items: fromLetterboxdCsv(records, fileName) };
  }
  if (columns.has("Book Id") && columns.has("Title")) {
    return { source: "Goodreads", items: fromGoodreadsCsv(records) };
  }
  throw new Error("Unrecognised file. Use a KeepShelf backup (.json), or a Letterboxd or Goodreads CSV export.");
}
