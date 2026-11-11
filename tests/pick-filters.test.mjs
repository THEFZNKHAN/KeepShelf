import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_PICK_FILTERS, PICK_LENGTHS, activeFilterCount, applyPickFilters, matchesPickFilters, parseMinutes, pickGenres,
  runtimeMinutes, sanitizePickFilters,
} from "../dist-test/pick-filters.js";

const item = (title, type, extra = {}) => ({ id: title, title, type, subtitle: "", googleQuery: title, savedAt: 1, sourceUrl: "", ...extra });
const movie = (title, minutes, genres = []) => item(title, "movie", { tmdb: { id: 1, kind: "movie", genres, runtimeMinutes: minutes, fetchedAt: 1 } });
const show = (title, type = "series", minutes, genres = []) => item(title, type, { tmdb: { id: 2, kind: "tv", genres, ...(minutes ? { runtimeMinutes: minutes } : {}), fetchedAt: 1 } });

test("parseMinutes reads runtimes and nothing else", () => {
  assert.equal(parseMinutes("2h 14m"), 134);
  assert.equal(parseMinutes("2h"), 120);
  assert.equal(parseMinutes("90m"), 90);
  assert.equal(parseMinutes("1h 5m"), 65);
  assert.equal(parseMinutes("5 seasons"), undefined);
  assert.equal(parseMinutes("37 eps"), undefined);
  assert.equal(parseMinutes(""), undefined);
  assert.equal(parseMinutes(undefined), undefined);
  assert.equal(parseMinutes("soon"), undefined);
});

test("runtimeMinutes: a movie's runtime, one episode of a show, or the page's own text", () => {
  assert.equal(runtimeMinutes(movie("A", 107)), 107);
  assert.equal(runtimeMinutes(show("B", "series", 45)), 45);
  assert.equal(runtimeMinutes(item("C", "movie", { durationOrSeasons: "1h 41m" })), 101);
  assert.equal(runtimeMinutes(item("D", "movie")), undefined);
  // A show's page text is seasons or episodes, never a runtime.
  assert.equal(runtimeMinutes(item("E", "series", { durationOrSeasons: "5 seasons" })), undefined);
  // Anime that TMDB lists as a film counts as a film.
  assert.equal(runtimeMinutes(item("F", "anime", { durationOrSeasons: "1h 30m", tmdb: { id: 3, kind: "movie", genres: [], fetchedAt: 1 } })), 90);
});

test("type filter", () => {
  const items = [movie("M", 100), show("S"), show("A", "anime")];
  assert.deepEqual(applyPickFilters(items, { type: "movie" }).map((i) => i.title), ["M"]);
  assert.deepEqual(applyPickFilters(items, { type: "series" }).map((i) => i.title), ["S"]);
  assert.deepEqual(applyPickFilters(items, { type: "anime" }).map((i) => i.title), ["A"]);
  assert.equal(applyPickFilters(items, { type: "all" }).length, 3);
});

test("length: a movie must fit, a show is judged by an episode", () => {
  const items = [movie("Short", 85), movie("Medium", 110), movie("Long", 170), movie("Unknown length", undefined),
    show("Episodes of 45", "series", 45), show("Long episodes", "series", 130), show("No episode length")];
  const under = (minutes) => applyPickFilters(items, { type: "all", maxMinutes: minutes }).map((i) => i.title);
  assert.deepEqual(under(90), ["Short", "Episodes of 45", "No episode length"]);
  assert.deepEqual(under(120), ["Short", "Medium", "Episodes of 45", "No episode length"]);
  assert.deepEqual(under(150), ["Short", "Medium", "Episodes of 45", "Long episodes", "No episode length"]);
});

test("genre filter matches the genre tags, however the genre is written", () => {
  const items = [movie("H", 100, ["Horror", "Thriller"]), movie("C", 100, ["Comedy"]), show("S", "series", 40, ["Sci-Fi & Fantasy"]), item("P", "movie", { genre: "Horror/Thriller" })];
  assert.deepEqual(applyPickFilters(items, { type: "all", genre: "horror" }).map((i) => i.title), ["H", "P"]);
  assert.deepEqual(applyPickFilters(items, { type: "all", genre: "fantasy" }).map((i) => i.title), ["S"]);
  assert.deepEqual(applyPickFilters(items, { type: "all", genre: "western" }), []);
});

test("filters combine, and none means everything", () => {
  const items = [movie("Short horror", 80, ["Horror"]), movie("Long horror", 140, ["Horror"]), movie("Short comedy", 85, ["Comedy"]), show("Horror show", "series", 40, ["Horror"])];
  assert.deepEqual(
    applyPickFilters(items, { type: "movie", maxMinutes: 90, genre: "horror" }).map((i) => i.title),
    ["Short horror"]
  );
  assert.equal(applyPickFilters(items, NO_PICK_FILTERS).length, 4);
  assert.equal(matchesPickFilters(items[0], { type: "all" }), true);
});

test("activeFilterCount", () => {
  assert.equal(activeFilterCount(NO_PICK_FILTERS), 0);
  assert.equal(activeFilterCount({ type: "movie" }), 1);
  assert.equal(activeFilterCount({ type: "movie", maxMinutes: 120 }), 2);
  assert.equal(activeFilterCount({ type: "anime", maxMinutes: 90, genre: "action" }), 3);
});

test("pickGenres lists every genre once, A to Z", () => {
  const items = [movie("A", 90, ["Horror", "Thriller"]), movie("B", 90, ["Comedy", "Horror"]), show("C", "series", 30, ["Sci-Fi & Fantasy"]), item("D", "movie")];
  assert.deepEqual(pickGenres(items), ["comedy", "fantasy", "horror", "sci-fi", "thriller"]);
  assert.deepEqual(pickGenres([]), []);
});

test("saved filters are checked when read back", () => {
  assert.deepEqual(sanitizePickFilters({ type: "movie", maxMinutes: 120, genre: " Horror " }), { type: "movie", maxMinutes: 120, genre: "horror" });
  assert.deepEqual(sanitizePickFilters({ type: "podcast", maxMinutes: 7, genre: "" }), { type: "all" });
  assert.deepEqual(sanitizePickFilters({ type: "anime", maxMinutes: "120", genre: 5 }), { type: "anime" });
  for (const bad of [null, undefined, "x", 5, [], true]) assert.deepEqual(sanitizePickFilters(bad), { type: "all" });
  assert.deepEqual(PICK_LENGTHS.map((l) => l.minutes), [90, 120, 150]);
  assert.deepEqual(sanitizePickFilters({ type: "all", genre: "x".repeat(41) }), { type: "all" });
});
