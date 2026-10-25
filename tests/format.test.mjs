import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDurationOrSeasons, formatItemLine, formatItemsList } from "../dist-test/format.js";

const base = { id: "x", savedAt: 0, googleQuery: "", subtitle: "" };

test("movie line includes year, runtime and IMDb rating", () => {
  const line = formatItemLine({
    ...base,
    type: "movie",
    title: "Inception",
    year: "2010",
    durationOrSeasons: "2h 28m",
    imdbRating: "8.8",
    sourceUrl: "https://www.imdb.com/title/tt1375666/",
  });
  assert.equal(line, "Inception (2010) | 2h 28m | IMDb 8.8");
});

test("anime from MyAnimeList gets MAL label and (A) suffix", () => {
  const line = formatItemLine({
    ...base,
    type: "anime",
    title: "Frieren",
    year: "2023",
    durationOrSeasons: "1 season",
    imdbRating: "9.3",
    sourceUrl: "https://myanimelist.net/anime/52991",
  });
  assert.equal(line, "Frieren (2023) | S01 | MAL 9.3 (A)");
});

test("Letterboxd rating uses LB label", () => {
  const line = formatItemLine({
    ...base,
    type: "movie",
    title: "Parasite",
    year: "2019",
    imdbRating: "4.5",
    sourceUrl: "https://letterboxd.com/film/parasite-2019/",
  });
  assert.equal(line, "Parasite (2019) | LB 4.5");
});

test("Rotten Tomatoes and Trakt rating labels", () => {
  const rt = { ...base, type: "movie", title: "Inception", year: "2010", imdbRating: "86", sourceUrl: "https://www.rottentomatoes.com/m/inception" };
  const trakt = { ...base, type: "series", title: "Breaking Bad", year: "2008", imdbRating: "9.3", sourceUrl: "https://app.trakt.tv/shows/breaking-bad" };
  assert.equal(formatItemLine(rt), "Inception (2010) | RT 86%");
  assert.equal(formatItemLine(trakt), "Breaking Bad (2008) | Trakt 9.3");
});

test("book line includes author, year and Goodreads rating", () => {
  const line = formatItemLine({
    ...base,
    type: "book",
    title: "Dune",
    author: "Frank Herbert",
    publishedYear: "1965",
    subtitle: "Novel by Frank Herbert",
    imdbRating: "4.3",
    sourceUrl: "https://www.goodreads.com/book/show/44767458-dune",
  });
  assert.equal(line, "Dune (Frank Herbert) | 1965 | GR 4.3");
});

test("tabs, links and notes", () => {
  assert.equal(
    formatItemLine({ ...base, type: "tab", title: "Example", url: "https://example.com", sourceUrl: "" }),
    "Example | https://example.com"
  );
  assert.equal(
    formatItemLine({ ...base, type: "note", title: "Buy milk", body: "  Buy milk today  ", sourceUrl: "" }),
    "Buy milk today"
  );
});

test("seasons are abbreviated, other durations pass through", () => {
  assert.equal(formatDurationOrSeasons("3 seasons"), "S03");
  assert.equal(formatDurationOrSeasons("12 Seasons"), "S12");
  assert.equal(formatDurationOrSeasons("2h 28m"), "2h 28m");
});

test("items list joins lines with newlines", () => {
  const items = [
    { ...base, type: "note", title: "a", body: "a", sourceUrl: "" },
    { ...base, type: "note", title: "b", body: "b", sourceUrl: "" },
  ];
  assert.equal(formatItemsList(items), "a\nb");
});
