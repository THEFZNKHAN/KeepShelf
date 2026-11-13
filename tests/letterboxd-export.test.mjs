import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLetterboxdExport, toStars } from "../dist-test/letterboxd-export.js";
import { parseCsv } from "../dist-test/import.js";

const base = { subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1 };
const film = (title, extra = {}) => ({ ...base, id: title, title, type: "movie", year: "2015", ...extra });
const withTmdb = (id, imdb, kind = "movie", extra = {}) => ({ tmdb: { id, kind, genres: [], fetchedAt: 1, ...(imdb ? { imdbId: imdb } : {}), ...extra } });
const DONE = new Date(2024, 2, 7, 21, 30).getTime();
const rows = (csv) => parseCsv(csv).slice(1);
const header = (csv) => parseCsv(csv)[0];

test("watched films carry ids, title, year, date, stars, review and tags", () => {
  const out = buildLetterboxdExport([
    film("Drishyam", { status: "done", done: true, doneAt: DONE, myRating: 9, review: "Gripping, and the \"ending\" works.", tags: ["thriller", "family"], ...withTmdb(300, "tt4430212") }),
  ]);
  assert.deepEqual(header(out.watched.csv), ["tmdbID", "imdbID", "Title", "Year", "WatchedDate", "Rating", "Review", "Tags"]);
  assert.deepEqual(rows(out.watched.csv), [["300", "tt4430212", "Drishyam", "2015", "2024-03-07", "4.5", 'Gripping, and the "ending" works.', "thriller, family"]]);
  assert.equal(out.watched.count, 1);
});

test("films still to watch go in the watchlist file, with just the identifying columns", () => {
  const out = buildLetterboxdExport([film("Heat", { year: "1995", ...withTmdb(949, "tt0113277") }), film("Started", { status: "in_progress" })]);
  assert.deepEqual(header(out.watchlist.csv), ["tmdbID", "imdbID", "Title", "Year"]);
  assert.deepEqual(rows(out.watchlist.csv), [["949", "tt0113277", "Heat", "1995"], ["", "", "Started", "2015"]]);
  assert.equal(out.watchlist.count, 2);
  assert.equal(out.watched.count, 0);
});

test("series and anime series are left out and counted, and so are dropped films", () => {
  const out = buildLetterboxdExport([
    film("A film", { status: "done" }),
    { ...base, id: "s", title: "A show", type: "series", ...withTmdb(1, "tt1", "tv") },
    { ...base, id: "a", title: "An anime show", type: "anime", ...withTmdb(2, "tt2", "tv") },
    film("Dropped film", { status: "dropped" }),
  ]);
  assert.equal(out.skippedSeries, 2);
  assert.equal(out.skippedDropped, 1);
  assert.deepEqual(rows(out.watched.csv).map((r) => r[2]), ["A film"]);
});

test("an anime film is a film, and books, tabs and notes are not counted at all", () => {
  const out = buildLetterboxdExport([
    { ...base, id: "af", title: "Your Name", type: "anime", year: "2016", status: "done", ...withTmdb(372058, "tt5311514", "movie") },
    { ...base, id: "b", title: "A book", type: "book" },
    { ...base, id: "t", title: "A tab", type: "tab" },
    { ...base, id: "n", title: "A note", type: "note" },
  ]);
  assert.deepEqual(rows(out.watched.csv).map((r) => r[2]), ["Your Name"]);
  assert.equal(out.skippedSeries, 0);
  assert.equal(out.skippedDropped, 0);
});

test("a TMDB id is only written for a film, so a show's id never matches the wrong film", () => {
  const out = buildLetterboxdExport([film("Odd one", { status: "done", ...withTmdb(1396, "tt0903747", "tv") })]);
  assert.deepEqual(rows(out.watched.csv)[0].slice(0, 2), ["", "tt0903747"]);
});

test("titles are cleaned: a trailing year is removed, and a year comes from the film when the item has none", () => {
  const out = buildLetterboxdExport([film("Dune (2021)", { year: undefined, status: "done", ...withTmdb(438631, undefined, "movie", { releaseDate: "2021-10-22" }) })]);
  assert.deepEqual(rows(out.watched.csv)[0].slice(2, 4), ["Dune", "2021"]);
  const noYear = buildLetterboxdExport([film("Nameless", { year: undefined, status: "done" })]);
  assert.equal(rows(noYear.watched.csv)[0][3], "");
});

test("toStars turns a 1 to 10 rating into half-stars and ignores anything else", () => {
  assert.equal(toStars(10), "5");
  assert.equal(toStars(9), "4.5");
  assert.equal(toStars(7), "3.5");
  assert.equal(toStars(1), "0.5");
  for (const bad of [undefined, 0, 11, -1, NaN, "8"]) assert.equal(toStars(bad), "", String(bad));
});

test("a title that looks like a formula cannot run in a spreadsheet", () => {
  const out = buildLetterboxdExport([film("=HYPERLINK(\"http://evil\")", { status: "done", review: "@cmd|calc", tags: ["+x"] })]);
  const [row] = rows(out.watched.csv);
  assert.ok(row[2].startsWith("'="), row[2]);
  assert.ok(row[6].startsWith("'@"), row[6]);
  assert.ok(row[7].startsWith("'+"), row[7]);
});

test("no watched date is written when none was saved, and an empty shelf gives header-only files", () => {
  const out = buildLetterboxdExport([film("Old", { status: "done" })]);
  assert.equal(rows(out.watched.csv)[0][4], "");
  const empty = buildLetterboxdExport([]);
  assert.equal(empty.watched.count + empty.watchlist.count, 0);
  assert.equal(rows(empty.watched.csv).length, 0);
  assert.equal(header(empty.watched.csv).length, 8);
});
