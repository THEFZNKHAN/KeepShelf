import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBackup, parseCsv, parseImportFile } from "../dist-test/import.js";
import { formatIsoDuration } from "../dist-test/media-jsonld.js";

test("CSV parser handles quotes, escaped quotes, commas and CRLF", () => {
  const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n\r\nlast,\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'say "hi"'], ["last", ""]]);
});

test("Letterboxd watchlist imports unwatched movies", () => {
  const csv = "Date,Name,Year,Letterboxd URI\n2024-03-01,Parasite,2019,https://boxd.it/hTha\n";
  const { source, items } = parseImportFile(csv, "watchlist.csv");
  assert.equal(source, "Letterboxd");
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "movie");
  assert.equal(items[0].title, "Parasite");
  assert.equal(items[0].year, "2019");
  assert.equal(items[0].sourceUrl, "https://boxd.it/hTha");
  assert.equal(items[0].done, undefined);
  assert.equal(items[0].savedAt, Date.parse("2024-03-01"));
});

test("Letterboxd diary imports watched movies", () => {
  const csv = "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2024-03-02,Dune,2021,https://boxd.it/x,4,,,2024-03-01\n";
  const { items } = parseImportFile(csv, "diary.csv");
  assert.equal(items[0].done, true);
});

test("Goodreads export maps author, year, rating, shelf and link", () => {
  const csv = [
    "Book Id,Title,Author,ISBN,Average Rating,Year Published,Original Publication Year,Date Read,Date Added,Exclusive Shelf",
    '44767458,"Dune (Dune, #1)",Frank Herbert,"=""0441172717""",4.28,2019,1965,2024/01/10,2023/12/01,read',
    "1,Unread Book,Some Author,,0,2020,,,2024/02/01,to-read",
  ].join("\n");
  const { source, items } = parseImportFile(csv, "goodreads_library_export.csv");
  assert.equal(source, "Goodreads");
  const [dune, unread] = items;
  assert.equal(dune.type, "book");
  assert.equal(dune.title, "Dune (Dune, #1)");
  assert.equal(dune.author, "Frank Herbert");
  assert.equal(dune.publishedYear, "1965");
  assert.equal(dune.imdbRating, "4.28");
  assert.equal(dune.sourceUrl, "https://www.goodreads.com/book/show/44767458");
  assert.equal(dune.done, true);
  assert.equal(unread.done, undefined);
  assert.equal(unread.imdbRating, undefined);
});

test("KeepShelf backup round-trips and drops ids", () => {
  const items = [
    { id: "a", savedAt: 5, type: "movie", title: "Inception", year: "2010", subtitle: "", googleQuery: "x", sourceUrl: "", done: true },
    { id: "b", savedAt: 6, type: "bogus", title: "Skip me", subtitle: "", googleQuery: "", sourceUrl: "" },
  ];
  const { source, items: parsed } = parseImportFile(buildBackup(items), "keepshelf-backup.json");
  assert.equal(source, "KeepShelf backup");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, undefined);
  assert.equal(parsed[0].savedAt, 5);
  assert.equal(parsed[0].done, true);
});

test("unknown CSV is rejected with a helpful message", () => {
  assert.throws(() => parseImportFile("foo,bar\n1,2\n", "random.csv"), /Letterboxd or Goodreads/);
});

test("ISO durations", () => {
  assert.equal(formatIsoDuration("PT148M"), "2h 28m");
  assert.equal(formatIsoDuration("PT2H"), "2h");
  assert.equal(formatIsoDuration("PT45M"), "45m");
  assert.equal(formatIsoDuration("P1D"), undefined);
});
