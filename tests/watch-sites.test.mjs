import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildWatchUrl, describePattern, getWatchSites, learnPattern, removeWatchSite, sanitizeWatchSites, saveWatchSite,
  siteFromLearned, slugify, supportedKinds, titleFacts, watchLinks, WATCH_SITES_KEY,
} from "../dist-test/watch-sites.js";

const store = {};
globalThis.chrome = {
  storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (v) => { Object.assign(store, JSON.parse(JSON.stringify(v))); } } },
};
beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

const odyssey = { tmdbId: 1368337, imdbId: "tt0000001", kind: "movie", title: "The Odyssey", year: "2026" };
const mentalist = { tmdbId: 5920, imdbId: "tt1196946", kind: "tv", title: "The Mentalist", year: "2008" };
const learn = (url, facts) => { const r = learnPattern(url, facts); assert.equal(r.ok, true, r.error); return r.learned; };

test("slugify", () => {
  assert.equal(slugify("Heart of the Beast!"), "heart-of-the-beast");
  assert.equal(slugify("Amélie"), "amelie");
  assert.equal(slugify("Ocean's Eleven"), "oceans-eleven");
  assert.equal(slugify("  --  "), "");
});

test("learns a TMDB id and a type word from the query", () => {
  const learned = learn("https://site.example/details?id=1368337&type=movie", odyssey);
  assert.deepEqual(learned, { template: "https://site.example/details?id={tmdb_id}&type={type}", typeWord: "movie", kind: "movie" });
});

test("learns an IMDb id and a type word from the path", () => {
  const learned = learn("https://app.example.com/shows/tt1196946", mentalist);
  assert.deepEqual(learned, { template: "https://app.example.com/{type}/{imdb_id}", typeWord: "shows", kind: "tv" });
});

test("learns the title and year in the path", () => {
  const facts = { kind: "movie", title: "Heart of the Beast", year: "2026" };
  assert.equal(learn("https://app.example.com/movies/heart-of-the-beast-2026", facts).template, "https://app.example.com/{type}/{slug}-{year}");
  assert.equal(learn("https://app.example.com/film/heart-of-the-beast", facts).template, "https://app.example.com/{type}/{slug}");
});

test("a site with no type word in the address", () => {
  const learned = learn("https://s.example/title/603-the-matrix", { tmdbId: 603, kind: "movie", title: "The Matrix", year: "1999" });
  assert.equal(learned.template, "https://s.example/title/{tmdb_id}-{slug}");
  assert.equal(learned.typeWord, undefined);
});

test("ignores the hash and keeps the query", () => {
  assert.equal(learn("https://site.example/details?id=5920&type=tv#watch", mentalist).template, "https://site.example/details?id={tmdb_id}&type={type}");
});

test("a number that only looks like the id is not replaced", () => {
  const r = learnPattern("https://site.example/details?id=13683370&type=movie", odyssey);
  assert.equal(r.ok, false);
});

test("explains what is missing when nothing identifies the title", () => {
  const noToken = learnPattern("https://site.example/details?id=999999&type=movie", { kind: "movie", title: "Zzz Qqq" });
  assert.match(noToken.error, /TMDB token/);
  const noImdb = learnPattern("https://site.example/shows/tt7777777", { kind: "tv", title: "Zzz Qqq" });
  assert.match(noImdb.error, /IMDb id/);
  const random = learnPattern("https://site.example/details/one-piece-n0aido", { kind: "tv", title: "Naruto" });
  assert.match(random.error, /random letters/);
});

test("rejects things that are not a usable address", () => {
  for (const bad of ["", "not a url", "ftp://site.example/x", "javascript:alert(1)", "http://localhost/x", "http://192.168.0.2/x"]) {
    assert.equal(learnPattern(bad, odyssey).ok, false, bad);
  }
});

test("rejects a movie address for a series title and the other way round", () => {
  assert.match(learnPattern("https://site.example/details?id=5920&type=movie", mentalist).error, /movie page/);
  assert.match(learnPattern("https://site.example/details?id=1368337&type=tv", odyssey).error, /series page/);
});

test("two examples give both type words, and must follow the same pattern", () => {
  const movie = learn("https://site.example/details?id=1368337&type=movie", odyssey);
  const show = learn("https://site.example/details?id=5920&type=tv", mentalist);
  const r = siteFromLearned(movie, show);
  assert.equal(r.ok, true);
  assert.deepEqual(r.site, { host: "site.example", template: "https://site.example/details?id={tmdb_id}&type={type}", typeWords: { movie: "movie", tv: "tv" } });

  const other = learn("https://site.example/watch/tt1196946", mentalist);
  assert.match(siteFromLearned(movie, other).error, /same pattern/);
});

test("builds the exact page for other titles", () => {
  const { site } = siteFromLearned(
    learn("https://site.example/details?id=1368337&type=movie", odyssey),
    learn("https://site.example/details?id=5920&type=tv", mentalist)
  );
  assert.equal(buildWatchUrl(site, { tmdbId: 603, kind: "movie", title: "The Matrix" }), "https://site.example/details?id=603&type=movie");
  assert.equal(buildWatchUrl(site, { tmdbId: 1396, kind: "tv", title: "Breaking Bad" }), "https://site.example/details?id=1396&type=tv");
  assert.equal(buildWatchUrl(site, { kind: "tv", title: "Breaking Bad" }), undefined);
});

test("an IMDb id site works from the id alone, and a title-in-path site from the title", () => {
  const imdb = siteFromLearned(learn("https://app.example.com/shows/tt1196946", mentalist)).site;
  assert.equal(buildWatchUrl(imdb, { imdbId: "tt0903747", kind: "tv", title: "Breaking Bad" }), "https://app.example.com/shows/tt0903747");
  // Only the series word was seen, so movies get no link rather than a wrong one.
  assert.equal(buildWatchUrl(imdb, { imdbId: "tt0133093", kind: "movie", title: "The Matrix" }), undefined);
  assert.deepEqual(supportedKinds(imdb), ["tv"]);

  const slug = siteFromLearned(learn("https://app.example.com/movies/heart-of-the-beast-2026", { kind: "movie", title: "Heart of the Beast", year: "2026" })).site;
  assert.equal(buildWatchUrl(slug, { kind: "movie", title: "Kohrra: The Movie!", year: "2023" }), "https://app.example.com/movies/kohrra-the-movie-2023");
  assert.equal(buildWatchUrl(slug, { kind: "movie", title: "No Year" }), undefined);
});

test("titleFacts reads ids from TMDB info or an IMDb source address, and skips books and notes", () => {
  const fromTmdb = titleFacts({ type: "series", title: "The Mentalist", year: "2008", sourceUrl: "", tmdb: { id: 5920, kind: "tv", imdbId: "tt1196946", genres: [], fetchedAt: 1 } });
  assert.deepEqual(fromTmdb, { tmdbId: 5920, imdbId: "tt1196946", kind: "tv", title: "The Mentalist", year: "2008" });
  const fromImdb = titleFacts({ type: "movie", title: "Inception", year: "2010", sourceUrl: "https://www.imdb.com/title/tt1375666/" });
  assert.equal(fromImdb.imdbId, "tt1375666");
  assert.equal(fromImdb.tmdbId, undefined);
  assert.equal(fromImdb.kind, "movie");
  assert.equal(titleFacts({ type: "book", title: "Dune", sourceUrl: "" }), undefined);
  assert.equal(titleFacts({ type: "note", title: "x", sourceUrl: "" }), undefined);
});

test("watchLinks lists a link per site that can build one", () => {
  const a = siteFromLearned(learn("https://a.example/details?id=1368337&type=movie", odyssey), learn("https://a.example/details?id=5920&type=tv", mentalist)).site;
  const b = siteFromLearned(learn("https://b.example/shows/tt1196946", mentalist)).site;
  const item = { type: "series", title: "Breaking Bad", sourceUrl: "https://www.imdb.com/title/tt0903747/" };
  // No TMDB id yet: only the IMDb-based site can link.
  assert.deepEqual(watchLinks(item, [a, b]), [{ host: "b.example", url: "https://b.example/shows/tt0903747" }]);
  const withTmdb = { ...item, tmdb: { id: 1396, kind: "tv", genres: [], fetchedAt: 1 } };
  assert.deepEqual(watchLinks(withTmdb, [a, b]).map((l) => l.url), ["https://a.example/details?id=1396&type=tv", "https://b.example/shows/tt0903747"]);
  assert.deepEqual(watchLinks({ type: "book", title: "Dune", sourceUrl: "" }, [a, b]), []);
});

test("describePattern is plain words", () => {
  const site = siteFromLearned(learn("https://site.example/details?id=1368337&type=movie", odyssey)).site;
  assert.equal(describePattern(site), "site.example/details?id=‹TMDB id›&type=‹movie or series›");
});

test("sanitizeWatchSites drops damaged entries and duplicates", () => {
  const good = { template: "https://a.example/{type}/{imdb_id}", typeWords: { movie: "movies", tv: "shows" } };
  assert.deepEqual(
    sanitizeWatchSites([good, { ...good }, { template: "https://b.example/nothing", typeWords: {} }, { template: 5 }, null, "x",
      { template: "https://c.example/{slug}", typeWords: { movie: "<script>", tv: 3 } }]),
    [{ host: "a.example", ...good }, { host: "c.example", template: "https://c.example/{slug}", typeWords: {} }]
  );
  assert.deepEqual(sanitizeWatchSites(undefined), []);
});

test("save, replace and remove, with a limit", async () => {
  const mk = (n) => ({ host: `s${n}.example`, template: `https://s${n}.example/{imdb_id}`, typeWords: {} });
  await saveWatchSite(mk(1));
  await saveWatchSite({ ...mk(1), template: "https://s1.example/x/{imdb_id}" });
  assert.deepEqual((await getWatchSites()).map((s) => s.template), ["https://s1.example/x/{imdb_id}"]);
  for (const n of [2, 3, 4]) await saveWatchSite(mk(n));
  await assert.rejects(() => saveWatchSite(mk(5)), /up to 4/);
  await removeWatchSite("s2.example");
  assert.deepEqual((await getWatchSites()).map((s) => s.host), ["s1.example", "s3.example", "s4.example"]);
  assert.ok(WATCH_SITES_KEY in store);
});

test("a type-less IMDb address works for movies and series from a single example", () => {
  // The shape of a site route that looks the title up by IMDb id and decides movie or series itself.
  const learned = learn("https://app.example.com/title/tt1196946", mentalist);
  assert.deepEqual(learned, { template: "https://app.example.com/title/{imdb_id}", typeWord: undefined, kind: "tv" });
  const { site } = siteFromLearned(learned);
  assert.deepEqual(supportedKinds(site), ["movie", "tv"]);
  assert.equal(buildWatchUrl(site, { imdbId: "tt0133093", kind: "movie", title: "The Matrix" }), "https://app.example.com/title/tt0133093");
  assert.equal(buildWatchUrl(site, { imdbId: "tt0903747", kind: "tv", title: "Breaking Bad" }), "https://app.example.com/title/tt0903747");
});

test("explains when one address has the year and the other doesn't", () => {
  const show = learn("https://app.example.com/shows/the-mentalist", mentalist);
  const movie = learn("https://app.example.com/movies/avengers-endgame-2019", { kind: "movie", title: "Avengers: Endgame", year: "2019" });
  assert.equal(show.template, "https://app.example.com/{type}/{slug}");
  assert.equal(movie.template, "https://app.example.com/{type}/{slug}-{year}");
  const r = siteFromLearned(show, movie);
  assert.equal(r.ok, false);
  assert.match(r.error, /year in it and the other doesn't/);
  assert.match(r.error, /\/title\//);
});
