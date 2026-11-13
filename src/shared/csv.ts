/**
 * Writing CSV files for other services to import. Fields are quoted when they need to be, and text a person typed
 * (titles, reviews, tags) is made safe against spreadsheet formulas: a cell that starts with = + - @ would be run as a
 * formula by Excel or Sheets, so it gets a leading apostrophe.
 */

/** Text from a person or a web page, made safe to open in a spreadsheet. */
export function csvText(value: string | undefined): string {
  const raw = value ?? "";
  const text = raw.replace(/\r\n?/g, "\n");
  return /^[=+\-@\t\r]/.test(raw) ? `'${text}` : text;
}

function field(value: string): string {
  return /[",\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** One CSV document: a header row and the rows, with a UTF-8 byte order mark so Excel reads accents correctly. */
export function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((row) => row.map(field).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** YYYY-MM-DD in the user's own time zone. */
export function localDay(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
