import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  addExampleToSite, appliesTo, isEnabled, MAX_WATCH_SITES, buildWatchUrl, defaultTypesFor, normalizeTypes, describePattern, isSearchSite, mainTitle, missingKind, searchText, getWatchSites, learnPattern, removeWatchSite, sanitizeWatchSites, saveWatchSite,
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
  assert.deepEqual(watchLinks(item, [a, b]), [{ host: "b.example", url: "https://b.example/shows/tt0903747", search: false }]);
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
  for (let n = 2; n <= MAX_WATCH_SITES; n++) await saveWatchSite(mk(n));
  await assert.rejects(() => saveWatchSite(mk(99)), new RegExp(`up to ${MAX_WATCH_SITES}`));
  // Replacing a site that is already saved is fine even when the list is full.
  await saveWatchSite({ ...mk(3), template: "https://s3.example/x/{imdb_id}" });
  await removeWatchSite("s2.example");
  const hosts = (await getWatchSites()).map((s) => s.host);
  assert.equal(hosts.length, MAX_WATCH_SITES - 1);
  assert.equal(hosts.includes("s2.example"), false);
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

test("searchText writes a title the two common ways", () => {
  assert.equal(searchText("One Piece", "plus"), "One+Piece");
  assert.equal(searchText("One Piece", "percent"), "One%20Piece");
  assert.equal(searchText("Spider-Man: Homecoming", "plus"), "Spider-Man%3A+Homecoming");
  assert.equal(searchText("  Dune  ", "percent"), "Dune");
});

test("learns a search page: the title as text in the query", () => {
  const onePiece = { kind: "tv", title: "One Piece" };
  const learned = learn("https://anime.example/search?keyword=one+piece", onePiece);
  assert.equal(learned.template, "https://anime.example/search?keyword={q_plus}");
  const { site } = siteFromLearned(learned);
  assert.equal(isSearchSite(site), true);
  assert.equal(buildWatchUrl(site, { kind: "tv", title: "Attack on Titan" }), "https://anime.example/search?keyword=Attack+on+Titan");
  assert.equal(buildWatchUrl(site, { kind: "tv", title: "Spider-Man: Homecoming" }), "https://anime.example/search?keyword=Spider-Man%3A+Homecoming");
  assert.equal(describePattern(site), "anime.example/search?keyword=‹title›");
  assert.deepEqual(supportedKinds(site), ["movie", "tv"]);
});

test("learns a search page written with %20, in the query or the path", () => {
  const facts = { kind: "tv", title: "One Piece" };
  assert.equal(learn("https://a.example/search?q=one%20piece&page=1", facts).template, "https://a.example/search?q={q_pct}&page=1");
  assert.equal(learn("https://a.example/search/One%20Piece", facts).template, "https://a.example/search/{q_pct}");
});

test("a one-word title in a query is read as search text", () => {
  const learned = learn("https://a.example/search?keyword=naruto", { kind: "tv", title: "Naruto" });
  assert.equal(learned.template, "https://a.example/search?keyword={q_plus}");
});

test("a search path with dashes is read as the title slug", () => {
  assert.equal(learn("https://a.example/search/one-piece", { kind: "tv", title: "One Piece" }).template, "https://a.example/search/{slug}");
});

test("a search page needs the title that was picked, and the error says what to search for", () => {
  const r = learnPattern("https://a.example/search?keyword=piece", { kind: "tv", title: "One Piece" });
  assert.equal(r.ok, false);
  assert.match(r.error, /search for "One Piece"/);
  const sub = learnPattern("https://a.example/search?keyword=piece", { kind: "tv", title: "One Piece: Wan pîsu" });
  assert.match(sub.error, /search for "One Piece" instead/);
});

test("mainTitle is the part before a colon or spaced dash", () => {
  assert.equal(mainTitle("One Piece: Wan pîsu"), "One Piece");
  assert.equal(mainTitle("Avengers: Endgame"), "Avengers");
  assert.equal(mainTitle("Spider-Man - Homecoming"), "Spider-Man");
  assert.equal(mainTitle("Spider-Man"), undefined);
  assert.equal(mainTitle("Dune"), undefined);
  assert.equal(mainTitle(": Oops"), undefined);
});

test("a search for the main name works when the shelf title has a subtitle", () => {
  const onePiece = { kind: "tv", title: "One Piece: Wan pîsu", year: "1999" };
  // The case that failed: the address has %20 and only the main name.
  const pct = learn("https://anime.example/filter?keyword=one%20piece", onePiece);
  assert.equal(pct.template, "https://anime.example/filter?keyword={qm_pct}");
  const site = siteFromLearned(pct).site;
  assert.equal(isSearchSite(site), true);
  assert.equal(describePattern(site), "anime.example/filter?keyword=‹title›");
  // Other titles are searched by their main name too.
  assert.equal(buildWatchUrl(site, { kind: "tv", title: "Naruto: Shippuden" }), "https://anime.example/filter?keyword=Naruto");
  assert.equal(buildWatchUrl(site, { kind: "tv", title: "Attack on Titan" }), "https://anime.example/filter?keyword=Attack%20on%20Titan");

  const plus = learn("https://anime.example/search?keyword=one+piece", onePiece);
  assert.equal(plus.template, "https://anime.example/search?keyword={qm_plus}");
  // The full title still wins when that is what was searched.
  const full = learn("https://anime.example/search?keyword=One+Piece%3A+Wan+p%C3%AEsu", onePiece);
  assert.equal(full.template, "https://anime.example/search?keyword={q_plus}");
});

test("an address with random letters can't be learned, and the error points to a search page", () => {
  const r = learnPattern("https://anime.example/details/one-piece-n0aido", { kind: "tv", title: "Naruto" });
  assert.equal(r.ok, false);
  assert.match(r.error, /search page/);
});

test("search links work for any title, with no ids, and are marked as searches", () => {
  const search = siteFromLearned(learn("https://anime.example/search?keyword=one+piece", { kind: "tv", title: "One Piece" })).site;
  const imdb = siteFromLearned(learn("https://b.example/title/tt1196946", mentalist)).site;
  const links = watchLinks({ type: "anime", title: "Naruto", sourceUrl: "" }, [search, imdb]);
  assert.deepEqual(links, [{ host: "anime.example", url: "https://anime.example/search?keyword=Naruto", search: true }]);
  assert.equal(isSearchSite(imdb), false);
});

test("search sites survive saving and loading", () => {
  const kept = sanitizeWatchSites([{ template: "https://a.example/search?q={q_plus}", typeWords: {} }, { template: "https://b.example/s/{q_pct}", typeWords: {} }]);
  assert.deepEqual(kept.map((x) => x.host), ["a.example", "b.example"]);
});

test("a site that only knew movies can add a series page later", () => {
  const movie = learn("https://site.example/details?id=1368337&type=movie", odyssey);
  const site = siteFromLearned(movie).site;
  assert.deepEqual(supportedKinds(site), ["movie"]);
  assert.equal(missingKind(site), "tv");

  const show = learn("https://site.example/details?id=5920&type=tv", mentalist);
  const r = addExampleToSite(site, show);
  assert.equal(r.ok, true);
  assert.deepEqual(r.site.typeWords, { movie: "movie", tv: "tv" });
  assert.deepEqual(supportedKinds(r.site), ["movie", "tv"]);
  assert.equal(missingKind(r.site), undefined);
  assert.equal(buildWatchUrl(r.site, { tmdbId: 1396, kind: "tv", title: "Breaking Bad" }), "https://site.example/details?id=1396&type=tv");
  // The original site is untouched.
  assert.deepEqual(site.typeWords, { movie: "movie" });
});

test("adding a page for a kind the site already has changes nothing", () => {
  const site = siteFromLearned(learn("https://site.example/details?id=1368337&type=movie", odyssey)).site;
  const again = addExampleToSite(site, learn("https://site.example/details?id=603&type=movie", { tmdbId: 603, kind: "movie", title: "The Matrix", year: "1999" }));
  assert.equal(again.ok, true);
  assert.deepEqual(again.site.typeWords, { movie: "movie" });
});

test("adding a page from a different pattern, or one with no type word, is refused", () => {
  const site = siteFromLearned(learn("https://site.example/details?id=1368337&type=movie", odyssey)).site;
  const other = learn("https://site.example/watch/tt1196946", mentalist);
  assert.match(addExampleToSite(site, other).error, /same pattern/);
  const noType = siteFromLearned(learn("https://app.example.com/title/tt1196946", mentalist)).site;
  assert.equal(missingKind(noType), undefined);
  assert.match(addExampleToSite(site, { ...learn("https://site.example/details?id=5920&type=tv", mentalist), typeWord: undefined }).error, /nothing to add/);
});

test("defaultTypesFor: an anime example starts as an anime-only site, anything else as all", () => {
  assert.deepEqual(defaultTypesFor("anime"), ["anime"]);
  assert.equal(defaultTypesFor("movie"), undefined);
  assert.equal(defaultTypesFor("series"), undefined);
  assert.equal(defaultTypesFor(undefined), undefined);
});

test("normalizeTypes keeps valid kinds, and treats all of them (or none) as no limit", () => {
  assert.deepEqual(normalizeTypes(["anime"]), ["anime"]);
  assert.deepEqual(normalizeTypes(["series", "movie"]), ["movie", "series"]);
  assert.equal(normalizeTypes(["movie", "series", "anime"]), undefined);
  assert.equal(normalizeTypes([]), undefined);
  assert.equal(normalizeTypes(["book", "x"]), undefined);
  assert.equal(normalizeTypes("anime"), undefined);
});

test("a site limited to anime only links anime, and search links follow the same rule", () => {
  const search = siteFromLearned(learn("https://anime.example/search?keyword=one+piece", { kind: "tv", title: "One Piece" }), undefined, ["anime"]).site;
  assert.deepEqual(search.types, ["anime"]);
  assert.equal(appliesTo(search, "anime"), true);
  assert.equal(appliesTo(search, "movie"), false);
  const all = siteFromLearned(learn("https://b.example/title/tt1196946", mentalist)).site;
  assert.equal("types" in all, false);
  assert.equal(appliesTo(all, "book"), true);

  const mk = (type, title) => ({ type, title, sourceUrl: "" });
  assert.deepEqual(watchLinks(mk("anime", "Naruto"), [search, all]).map((l) => l.host), ["anime.example"]);
  assert.deepEqual(watchLinks(mk("movie", "Heat"), [search]), []);
  assert.deepEqual(watchLinks(mk("series", "Dark"), [search]), []);
});

test("types survive sanitising, and bad values are dropped", () => {
  const kept = sanitizeWatchSites([
    { template: "https://a.example/search?q={q_plus}", typeWords: {}, types: ["anime"] },
    { template: "https://b.example/search?q={q_plus}", typeWords: {}, types: ["movie", "series", "anime"] },
    { template: "https://c.example/search?q={q_plus}", typeWords: {}, types: ["nope"] },
  ]);
  assert.deepEqual(kept.map((x) => x.types), [["anime"], undefined, undefined]);
  assert.equal("types" in kept[1], false);
});

test("adding another example keeps the site's kinds", () => {
  const site = { ...siteFromLearned(learn("https://site.example/details?id=1368337&type=movie", odyssey)).site, types: ["movie", "series"] };
  const r = addExampleToSite(site, learn("https://site.example/details?id=5920&type=tv", mentalist));
  assert.deepEqual(r.site.types, ["movie", "series"]);
});

test("the limit is ten sites", () => {
  assert.equal(MAX_WATCH_SITES, 10);
});

test("a site that is switched off gives no links but is kept", () => {
  const on = siteFromLearned(learn("https://b.example/title/tt1196946", mentalist)).site;
  const off = { ...on, host: "off.example", template: "https://off.example/title/{imdb_id}", enabled: false };
  assert.equal(isEnabled(on), true);
  assert.equal(isEnabled(off), false);
  const item = { type: "series", title: "Breaking Bad", sourceUrl: "https://www.imdb.com/title/tt0903747/" };
  assert.deepEqual(watchLinks(item, [on, off]).map((l) => l.host), ["b.example"]);
  assert.deepEqual(watchLinks(item, [off]), []);
  // Off survives saving and loading; on is stored as nothing extra.
  const kept = sanitizeWatchSites([off, on]);
  assert.deepEqual(kept.map((s) => s.enabled), [false, undefined]);
  assert.equal("enabled" in kept[1], false);
});

test("switching off keeps the kinds and the pattern", () => {
  const site = siteFromLearned(learn("https://anime.example/search?keyword=one+piece", { kind: "tv", title: "One Piece" }), undefined, ["anime"]).site;
  const [kept] = sanitizeWatchSites([{ ...site, enabled: false }]);
  assert.deepEqual(kept, { ...site, enabled: false });
});

test("changing a saved site keeps it where it is in the list", async () => {
  const mk = (n) => ({ host: `s${n}.example`, template: `https://s${n}.example/{imdb_id}`, typeWords: {} });
  for (const n of [1, 2, 3]) await saveWatchSite(mk(n));
  await saveWatchSite({ ...mk(1), enabled: false });
  await saveWatchSite({ ...mk(2), types: ["anime"] });
  const sites = await getWatchSites();
  assert.deepEqual(sites.map((x) => x.host), ["s1.example", "s2.example", "s3.example"]);
  assert.equal(sites[0].enabled, false);
  assert.deepEqual(sites[1].types, ["anime"]);
});
