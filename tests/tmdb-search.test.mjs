import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_SEARCH_DELAY_MS, DEFAULT_SEARCH_MODE, MAX_RESULTS, SEARCH_MODES, findOnShelf, guessType, newItemFromResult, onlineSearchState,
  parseSearchResults, sanitizeResult, tmdbPageUrl,
} from "../dist-test/tmdb-search.js";

const movie = (id, extra = {}) => ({ id, media_type: "movie", title: `Movie ${id}`, release_date: "2018-05-04", overview: "A film.", poster_path: "/p.jpg", vote_average: 7.46, vote_count: 120, genre_ids: [28], original_language: "en", ...extra });
const show = (id, extra = {}) => ({ id, media_type: "tv", name: `Show ${id}`, first_air_date: "2019-01-02", poster_path: "/s.jpg", vote_average: 8.3, vote_count: 900, genre_ids: [18], original_language: "en", origin_country: ["US"], ...extra });

test("guessType calls Japanese animation anime, and everything else a movie or a series", () => {
  assert.equal(guessType("tv", [16, 10759], "ja", ["JP"]), "anime");
  assert.equal(guessType("movie", [16], "ja", []), "anime", "an anime film is anime");
  assert.equal(guessType("tv", [16], "en", ["JP"]), "anime", "made in Japan counts");
  assert.equal(guessType("tv", [16], "en", ["US"]), "series", "Western cartoons are series");
  assert.equal(guessType("movie", [16], "en", ["US"]), "movie");
  assert.equal(guessType("tv", [18], "ja", ["JP"]), "series", "live-action Japanese drama is not anime");
  assert.equal(guessType("tv", undefined, undefined, undefined), "series");
  assert.equal(guessType("movie", "x", 5, null), "movie");
});

test("parseSearchResults keeps movies and series, in TMDB's order, with only the fields the list needs", () => {
  const out = parseSearchResults({ results: [movie(1), show(2)] });
  assert.deepEqual(out, [
    { id: 1, kind: "movie", type: "movie", title: "Movie 1", year: "2018", overview: "A film.", posterPath: "/p.jpg", rating: 7.5 },
    { id: 2, kind: "tv", type: "series", title: "Show 2", year: "2019", posterPath: "/s.jpg", rating: 8.3 },
  ]);
});

test("parseSearchResults drops people, junk, duplicates and untitled entries", () => {
  const out = parseSearchResults({
    results: [
      { id: 5, media_type: "person", name: "An Actor" },
      movie(1), movie(1, { title: "Same id again" }),
      movie(2, { title: "  " }), movie(3, { title: 5 }),
      { media_type: "movie", title: "No id" }, { id: -4, media_type: "tv", name: "Negative" }, { id: 1.5, media_type: "tv", name: "Fraction" },
      null, "x", 7,
      show(1),
    ],
  });
  assert.deepEqual(out.map((r) => `${r.kind}:${r.id}`), ["movie:1", "tv:1"], "the same id as a movie and a series are different titles");
  assert.equal(out[0].title, "Movie 1");
});

test("parseSearchResults copes with nothing or nonsense", () => {
  for (const raw of [undefined, null, {}, { results: "x" }, { results: [] }, 5, "x"]) assert.deepEqual(parseSearchResults(raw), []);
});

test("parseSearchResults cleans text, bad posters, bad dates and empty ratings", () => {
  const [r] = parseSearchResults({ results: [movie(1, {
    title: "Tab\tand\nline  breaks", overview: "x".repeat(3000), poster_path: "http://evil/x.jpg", release_date: "soon", vote_average: 0, vote_count: 0,
  })] });
  assert.equal(r.title, "Tab and line breaks");
  assert.equal(r.overview.length, 1500, "a long description is kept for the hover, but not without limit");
  assert.equal(r.posterPath, undefined, "only TMDB poster paths");
  assert.equal(r.year, undefined);
  assert.equal(r.rating, undefined, "a score with no votes is not a rating");
  const [capped] = parseSearchResults({ results: [movie(1, { vote_average: 12, vote_count: 3 })] });
  assert.equal(capped.rating, 10);
  const [noVotes] = parseSearchResults({ results: [movie(1, { vote_average: 8, vote_count: 0 })] });
  assert.equal(noVotes.rating, undefined);
});

test("a description of ordinary length is kept whole", () => {
  const long = "A sentence about the show. ".repeat(30).trim();
  assert.equal(long.length > 400 && long.length < 1500, true);
  const [r] = parseSearchResults({ results: [movie(1, { overview: long })] });
  assert.equal(r.overview, long);
});

test("parseSearchResults caps the list", () => {
  const many = Array.from({ length: 60 }, (_, i) => movie(i + 1));
  assert.equal(parseSearchResults({ results: many }).length, MAX_RESULTS);
});

test("sanitizeResult accepts what the list produced and rejects anything else", () => {
  const good = { id: 9, kind: "tv", type: "anime", title: "Frieren", year: "2023" };
  assert.deepEqual(sanitizeResult({ ...good, extra: "ignored", overview: "dropped" }), good);
  assert.deepEqual(sanitizeResult({ id: 1, kind: "movie", type: "movie", title: "No year", year: "soon" }), { id: 1, kind: "movie", type: "movie", title: "No year" });
  for (const bad of [null, "x", {}, { ...good, id: "9" }, { ...good, id: 0 }, { ...good, id: 1.5 }, { ...good, kind: "person" }, { ...good, type: "book" }, { ...good, title: "" }, { ...good, title: 7 }]) {
    assert.equal(sanitizeResult(bad), undefined, JSON.stringify(bad));
  }
});

const saved = (extra) => ({ id: "x", title: "Dark", type: "series", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1, ...extra });

test("findOnShelf matches the same TMDB title, or the same name and year", () => {
  const dark = { id: 70523, kind: "tv", title: "Dark", year: "2017" };
  assert.ok(findOnShelf(dark, [saved({ tmdb: { id: 70523, kind: "tv", genres: [], fetchedAt: 1 }, title: "Whatever it is called" })]), "by TMDB id");
  assert.equal(findOnShelf(dark, [saved({ tmdb: { id: 70523, kind: "movie", genres: [], fetchedAt: 1 }, title: "Nope" })]), undefined, "a movie with that id is not the series");
  assert.ok(findOnShelf(dark, [saved({ year: "2017" })]), "by name and year");
  assert.ok(findOnShelf(dark, [saved({ year: "2017", title: "DARK!" })]), "ignoring case and punctuation");
  assert.equal(findOnShelf(dark, [saved({ year: "2024" })]), undefined, "a different year is a different title");
  assert.equal(findOnShelf(dark, [saved({})]), undefined, "no year on the shelf: don't guess");
  assert.equal(findOnShelf({ ...dark, year: undefined }, [saved({ year: "2017" })]), undefined, "no year in the result: don't guess");
  assert.equal(findOnShelf(dark, [saved({ year: "2017", type: "book" })]), undefined, "a book with the same name is not it");
  assert.equal(findOnShelf(dark, []), undefined);
});

test("newItemFromResult builds an item that already carries its TMDB info", () => {
  const info = { id: 70523, kind: "tv", genres: ["Drama"], fetchedAt: 5 };
  const result = { id: 70523, kind: "tv", type: "series", title: "Dark", year: "2017" };
  const item = newItemFromResult(result, info);
  assert.deepEqual(item, {
    type: "series", title: "Dark", year: "2017", subtitle: "2017", googleQuery: "Dark 2017",
    sourceUrl: "https://www.themoviedb.org/tv/70523", tmdb: info,
  });
  const bare = newItemFromResult({ id: 1, kind: "movie", type: "movie", title: "Untitled" }, { ...info, id: 1, kind: "movie" });
  assert.equal("year" in bare, false);
  assert.equal(bare.subtitle, "");
  assert.equal(bare.googleQuery, "Untitled");
  assert.equal(tmdbPageUrl({ id: 3, kind: "movie" }), "https://www.themoviedb.org/movie/3");
});

test("onlineSearchState: the row for media with something typed, automatic only when nothing local matches", () => {
  const state = (o) => onlineSearchState({ mode: "row", tab: "media", query: "dark matter", localMatches: 3, ...o });
  assert.deepEqual(state({}), { offer: true, auto: false, query: "dark matter" });
  assert.equal(state({ mode: "off" }).offer, false);
  assert.equal(state({ tab: "books" }).offer, false);
  assert.equal(state({ tab: "tabs" }).offer, false);
  assert.equal(state({ query: "d" }).offer, false, "one letter is not a search");
  assert.equal(state({ query: "   " }).offer, false);
  assert.equal(state({ query: "  dark   matter  " }).query, "dark matter", "spaces tidied");
  assert.equal(state({ query: "x".repeat(300) }).query.length, 100);
  assert.equal(state({ mode: "auto", localMatches: 0 }).auto, true);
  assert.equal(state({ mode: "auto", localMatches: 2 }).auto, false, "something on the shelf matches: wait to be asked");
  assert.equal(state({ mode: "auto", localMatches: 0, query: "da" }).auto, false, "too short to send by itself");
  assert.equal(state({ mode: "auto", localMatches: 0, query: "da" }).offer, true, "but the row is still there");
  assert.equal(state({ mode: "row", localMatches: 0 }).auto, false, "row mode never starts by itself");
  assert.equal(state({ mode: "off", localMatches: 0 }).auto, false);
});

test("the setting has the three choices and defaults to the row", () => {
  assert.deepEqual([...SEARCH_MODES], ["row", "auto", "off"]);
  assert.equal(DEFAULT_SEARCH_MODE, "row");
  assert.ok(AUTO_SEARCH_DELAY_MS >= 500);
});
