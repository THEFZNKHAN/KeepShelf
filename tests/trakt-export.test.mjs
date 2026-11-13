import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTraktExport } from "../dist-test/trakt-export.js";
import { parseCsv } from "../dist-test/import.js";

const base = { subtitle: "", googleQuery: "", sourceUrl: "", savedAt: Date.UTC(2023, 5, 1, 12) };
const item = (title, type, imdb, extra = {}) => ({ ...base, id: title, title, type, ...(imdb === undefined ? {} : { tmdb: { id: 1, kind: type === "movie" ? "movie" : "tv", genres: [], fetchedAt: 1, imdbId: imdb } }), ...extra });
const DONE = Date.UTC(2024, 2, 7, 21, 30);
const rows = (csv) => parseCsv(csv).slice(1);

test("watched titles get a watched date, and a rating with its date when you gave one", () => {
  const out = buildTraktExport([item("Dark", "series", "tt5753856", { status: "done", doneAt: DONE, myRating: 9 }), item("Heat", "movie", "tt0113277", { status: "done", doneAt: DONE })]);
  assert.deepEqual(parseCsv(out.csv)[0], ["imdb_id", "watched_at", "watchlisted_at", "rating", "rated_at"]);
  assert.deepEqual(rows(out.csv), [
    ["tt5753856", "2024-03-07T21:30:00.000Z", "", "9", "2024-03-07T21:30:00.000Z"],
    ["tt0113277", "2024-03-07T21:30:00.000Z", "", "", ""],
  ]);
  assert.equal(out.watched, 2);
});

test("a watched title with no saved date uses the day it was saved", () => {
  const out = buildTraktExport([item("Old", "movie", "tt1", { status: "done" })]);
  assert.equal(rows(out.csv)[0][1], "2023-06-01T12:00:00.000Z");
});

test("titles still to watch or in progress go on the watchlist", () => {
  const out = buildTraktExport([item("Plan", "movie", "tt2"), item("Midway", "series", "tt3", { status: "in_progress" })]);
  assert.deepEqual(rows(out.csv), [["tt2", "", "2023-06-01T12:00:00.000Z", "", ""], ["tt3", "", "2023-06-01T12:00:00.000Z", "", ""]]);
  assert.equal(out.watchlist, 2);
  assert.equal(out.watched, 0);
});

test("titles without an IMDb id are left out and counted, and so are dropped ones", () => {
  const out = buildTraktExport([
    item("No info", "movie", undefined),
    item("Bad id", "movie", "12345"),
    item("Empty id", "series", ""),
    item("Dropped", "series", "tt4", { status: "dropped" }),
    item("Fine", "anime", "tt5", { status: "done", doneAt: DONE }),
  ]);
  assert.equal(out.skippedNoId, 3);
  assert.equal(out.skippedDropped, 1);
  assert.deepEqual(rows(out.csv).map((r) => r[0]), ["tt5"]);
});

test("books, tabs, links and notes are not part of it", () => {
  const out = buildTraktExport([item("A book", "book", "tt9"), item("A tab", "tab", undefined), item("A note", "note", undefined)]);
  assert.equal(rows(out.csv).length, 0);
  assert.equal(out.skippedNoId, 0);
});

test("a rating outside 1 to 10 is not written, and an empty shelf gives a header-only file", () => {
  const out = buildTraktExport([item("Odd", "movie", "tt6", { status: "done", doneAt: DONE, myRating: 11 })]);
  assert.deepEqual(rows(out.csv)[0].slice(3), ["", ""]);
  const empty = buildTraktExport([]);
  assert.equal(rows(empty.csv).length, 0);
  assert.equal(parseCsv(empty.csv)[0].length, 5);
});
