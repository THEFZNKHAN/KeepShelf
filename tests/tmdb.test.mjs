import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTmdbClient, genreText, imdbIdFromUrl, isStale, lookupInfo, mustPurge, parseTmdbToken,
  pickBestMatch, sanitizeTmdb, toTmdbInfo, tmdbPosterUrl,
} from "../dist-test/tmdb.js";
import { buildBackup, parseImportFile } from "../dist-test/import.js";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.c2lnbmF0dXJl";
const KEY = "0123456789abcdef0123456789abcdef";

/** A fetch that answers from a path -> body map and records the calls. */
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    const u = new URL(url);
    calls.push({ path: u.pathname.replace("/3", ""), params: Object.fromEntries(u.searchParams), headers: init?.headers });
    const body = routes[u.pathname.replace("/3", "")];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (typeof body === "number") return { ok: false, status: body, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test("parseTmdbToken accepts a read token or a v3 key and rejects anything else", () => {
  assert.deepEqual(parseTmdbToken(` ${JWT} `), { kind: "bearer", value: JWT });
  assert.deepEqual(parseTmdbToken(KEY), { kind: "key", value: KEY });
  assert.equal(parseTmdbToken("hello"), undefined);
  assert.equal(parseTmdbToken(""), undefined);
});

test("client sends a bearer header, or an api_key param for v3 keys", async () => {
  const f = mockFetch({ "/configuration": { ok: 1 } });
  await createTmdbClient({ kind: "bearer", value: JWT }, f).get("/configuration");
  assert.equal(f.calls[0].headers.Authorization, `Bearer ${JWT}`);
  assert.equal(f.calls[0].params.api_key, undefined);
  await createTmdbClient({ kind: "key", value: KEY }, f).get("/configuration", { language: "en-US" });
  assert.equal(f.calls[1].params.api_key, KEY);
  assert.equal(f.calls[1].headers.Authorization, undefined);
  assert.equal(f.calls[1].params.language, "en-US");
});

test("client turns HTTP failures into readable errors", async () => {
  const client = (status) => createTmdbClient({ kind: "bearer", value: JWT }, mockFetch({ "/x": status }));
  await assert.rejects(() => client(401).get("/x"), /rejected this token/);
  await assert.rejects(() => client(429).get("/x"), /rate limiting/);
  await assert.rejects(() => client(500).get("/x"), /error \(500\)/);
  const offline = createTmdbClient({ kind: "bearer", value: JWT }, async () => { throw new Error("net"); });
  await assert.rejects(() => offline.get("/x"), /Could not reach TMDB/);
});

test("imdbIdFromUrl reads title ids", () => {
  assert.equal(imdbIdFromUrl("https://www.imdb.com/title/tt1375666/?ref_=x"), "tt1375666");
  assert.equal(imdbIdFromUrl("https://letterboxd.com/film/inception/"), undefined);
  assert.equal(imdbIdFromUrl(undefined), undefined);
});

test("pickBestMatch prefers close titles, respects the year, and refuses guesses", () => {
  const results = [
    { id: 1, title: "Dune", release_date: "1984-12-14", popularity: 30 },
    { id: 2, title: "Dune", release_date: "2021-09-15", popularity: 90 },
    { id: 3, title: "Dune: Part Two", release_date: "2024-02-27", popularity: 120 },
  ];
  assert.equal(pickBestMatch(results, { title: "Dune", year: "2021" }).id, 2);
  assert.equal(pickBestMatch(results, { title: "Dune", year: "1984" }).id, 1);
  assert.equal(pickBestMatch(results, { title: "Dune" }).id, 2, "no year: most popular exact title");
  assert.equal(pickBestMatch(results, { title: "Completely different" }), undefined);
  assert.equal(pickBestMatch(results, { title: "Dune", year: "1999" }), undefined);
  const anime = [{ id: 9, name: "Shingeki no Kyojin", original_name: "進撃の巨人", first_air_date: "2013-04-07" }];
  assert.equal(pickBestMatch(anime, { title: "Shingeki no Kyojin", year: "2013" }).id, 9);
});

test("toTmdbInfo maps movie and tv details", () => {
  const movie = toTmdbInfo("movie", {
    id: 27205, imdb_id: "tt1375666", genres: [{ name: "Action" }, { name: "Science Fiction" }], overview: " A thief. ",
    vote_average: 8.3714, vote_count: 36000, runtime: 148, poster_path: "/p.jpg", status: "Released",
    release_dates: { results: [{ iso_3166_1: "GB", release_dates: [{ certification: "12A" }] }, { iso_3166_1: "US", release_dates: [{ certification: "" }, { certification: "PG-13" }] }] },
  }, 1000);
  assert.deepEqual(movie, {
    id: 27205, kind: "movie", genres: ["Action", "Science Fiction"], fetchedAt: 1000, imdbId: "tt1375666",
    overview: "A thief.", rating: 8.4, votes: 36000, certification: "PG-13", runtimeMinutes: 148, status: "Released", posterPath: "/p.jpg",
  });
  const tv = toTmdbInfo("tv", {
    id: 1396, genres: [{ name: "Drama" }], vote_average: 8.9, vote_count: 14000, episode_run_time: [47], number_of_seasons: 5,
    number_of_episodes: 62, external_ids: { imdb_id: "tt0903747" }, content_ratings: { results: [{ iso_3166_1: "US", rating: "TV-MA" }] },
  }, 1000);
  assert.equal(tv.seasons, 5);
  assert.equal(tv.episodes, 62);
  assert.equal(tv.imdbId, "tt0903747");
  assert.equal(tv.certification, "TV-MA");
  assert.equal(tv.runtimeMinutes, 47);
});

test("tv runtime falls back to the latest episode when episode_run_time is empty", () => {
  assert.equal(toTmdbInfo("tv", { id: 1, episode_run_time: [], last_episode_to_air: { runtime: 52 } }).runtimeMinutes, 52);
  assert.equal(toTmdbInfo("tv", { id: 1, episode_run_time: [47], last_episode_to_air: { runtime: 52 } }).runtimeMinutes, 47);
  assert.equal(toTmdbInfo("tv", { id: 1, episode_run_time: [] }).runtimeMinutes, undefined);
});

test("an unrated title has no rating rather than 0", () => {
  assert.equal(toTmdbInfo("movie", { id: 1, vote_average: 0, vote_count: 0 }).rating, undefined);
});

test("lookupInfo uses the IMDb id when the source URL has one", async () => {
  const f = mockFetch({
    "/find/tt1375666": { movie_results: [{ id: 27205 }], tv_results: [] },
    "/movie/27205": { id: 27205, genres: [{ name: "Action" }], vote_average: 8.4, vote_count: 10 },
  });
  const info = await lookupInfo(createTmdbClient({ kind: "bearer", value: JWT }, f),
    { type: "movie", title: "Inception", year: "2010", sourceUrl: "https://www.imdb.com/title/tt1375666/" });
  assert.equal(info.id, 27205);
  assert.deepEqual(f.calls.map((c) => c.path), ["/find/tt1375666", "/movie/27205"]);
  assert.equal(f.calls[0].params.external_source, "imdb_id");
});

test("lookupInfo searches by title and year otherwise, with the right year param", async () => {
  const f = mockFetch({
    "/search/tv": { results: [{ id: 70523, name: "Dark", first_air_date: "2017-12-01" }] },
    "/tv/70523": { id: 70523, genres: [{ name: "Drama" }] },
  });
  const info = await lookupInfo(createTmdbClient({ kind: "bearer", value: JWT }, f),
    { type: "series", title: "Dark", year: "2017", sourceUrl: "" });
  assert.equal(info.id, 70523);
  assert.equal(f.calls[0].params.first_air_date_year, "2017");
  assert.equal(f.calls[0].params.query, "Dark");
});

test("anime falls back from tv to movie, and no match gives undefined", async () => {
  const f = mockFetch({
    "/search/tv": { results: [] },
    "/search/movie": { results: [{ id: 129, title: "Spirited Away", release_date: "2001-07-20" }] },
    "/movie/129": { id: 129, genres: [{ name: "Animation" }] },
  });
  const client = createTmdbClient({ kind: "bearer", value: JWT }, f);
  assert.equal((await lookupInfo(client, { type: "anime", title: "Spirited Away", year: "2001", sourceUrl: "" })).kind, "movie");
  assert.equal(await lookupInfo(client, { type: "anime", title: "Zzzz Nothing", sourceUrl: "" }), undefined);
});

test("six-month retention: stale at 150 days, purged after 180", () => {
  const day = 86400000;
  assert.equal(isStale({ fetchedAt: 0 }, 149 * day), false);
  assert.equal(isStale({ fetchedAt: 0 }, 151 * day), true);
  assert.equal(mustPurge({ fetchedAt: 0 }, 179 * day), false);
  assert.equal(mustPurge({ fetchedAt: 0 }, 181 * day), true);
});

test("sanitizeTmdb keeps valid data and drops bad or expired data", () => {
  const good = { id: 1, kind: "tv", genres: ["Drama", 5], fetchedAt: 1000, rating: 8, junk: "x" };
  assert.deepEqual(sanitizeTmdb(good, 2000), { id: 1, kind: "tv", genres: ["Drama"], fetchedAt: 1000, rating: 8 });
  assert.equal(sanitizeTmdb({ ...good, kind: "book" }, 2000), undefined);
  assert.equal(sanitizeTmdb({ ...good, fetchedAt: undefined }, 2000), undefined);
  assert.equal(sanitizeTmdb(good, 1000 + 181 * 86400000), undefined);
  assert.equal(sanitizeTmdb("nope"), undefined);
});

test("backups keep fresh TMDB data and drop expired data", () => {
  const base = { id: "1", title: "Dune", type: "movie", subtitle: "", googleQuery: "Dune", sourceUrl: "", savedAt: 1 };
  const fresh = { ...base, tmdb: { id: 5, kind: "movie", genres: ["Sci-Fi"], fetchedAt: Date.now() } };
  const old = { ...base, id: "2", title: "Old", tmdb: { id: 6, kind: "movie", genres: [], fetchedAt: Date.now() - 200 * 86400000 } };
  const { items } = parseImportFile(buildBackup([fresh, old]), "b.json");
  assert.equal(items[0].tmdb.id, 5);
  assert.equal(items[1].tmdb, undefined);
});

test("genreText prefers the source page, then TMDB; poster urls come from TMDB paths", () => {
  assert.equal(genreText({ genre: "Drama" , tmdb: { genres: ["Crime"] } }), "Drama");
  assert.equal(genreText({ tmdb: { genres: ["Crime", "Drama"] } }), "Crime, Drama");
  assert.equal(genreText({}), "");
  assert.equal(tmdbPosterUrl({ tmdb: { posterPath: "/a.jpg" } }), "https://image.tmdb.org/t/p/w92/a.jpg");
  assert.equal(tmdbPosterUrl({}), undefined);
});

import { allTags, durationText, formatMinutes, genreTags, tmdbDuration, totalEpisodes } from "../dist-test/tmdb.js";
import { formatItemLine } from "../dist-test/format.js";

test("formatMinutes writes runtimes like the page parsers do", () => {
  assert.equal(formatMinutes(148), "2h 28m");
  assert.equal(formatMinutes(120), "2h");
  assert.equal(formatMinutes(47), "47m");
});

test("tmdbDuration: movies get a runtime, anime episodes, series seasons", () => {
  assert.equal(tmdbDuration({ type: "movie", tmdb: { kind: "movie", runtimeMinutes: 148 } }), "2h 28m");
  assert.equal(tmdbDuration({ type: "anime", tmdb: { kind: "tv", episodes: 37, seasons: 1 } }), "37 eps");
  assert.equal(tmdbDuration({ type: "series", tmdb: { kind: "tv", seasons: 5, episodes: 62 } }), "5 seasons");
  assert.equal(tmdbDuration({ type: "series", tmdb: { kind: "tv", seasons: 1 } }), "1 season");
  assert.equal(tmdbDuration({ type: "anime", tmdb: { kind: "movie", runtimeMinutes: 125 } }), "2h 5m", "an anime film uses its runtime");
  assert.equal(tmdbDuration({ type: "movie" }), undefined);
  assert.equal(tmdbDuration({ type: "movie", tmdb: { kind: "movie" } }), undefined);
});

test("the page's own value wins over TMDB's", () => {
  const tmdb = { kind: "movie", runtimeMinutes: 100 };
  assert.equal(durationText({ type: "movie", durationOrSeasons: "2h 28m", tmdb }), "2h 28m");
  assert.equal(durationText({ type: "movie", durationOrSeasons: " ", tmdb }), "1h 40m");
  assert.equal(durationText({ type: "movie" }), undefined);
});

test("copied and Keep lines get the TMDB runtime when the page had none", () => {
  const base = { id: "1", title: "Inception", year: "2010", type: "movie", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1 };
  assert.equal(formatItemLine(base), "Inception (2010)");
  assert.equal(formatItemLine({ ...base, tmdb: { id: 1, kind: "movie", genres: [], runtimeMinutes: 148, fetchedAt: 1 } }), "Inception (2010) | 2h 28m");
  assert.equal(
    formatItemLine({ ...base, type: "anime", title: "Death Note", year: "2006", tmdb: { id: 2, kind: "tv", genres: [], episodes: 37, fetchedAt: 1 } }),
    "Death Note (2006) | 37 eps (A)"
  );
  assert.equal(
    formatItemLine({ ...base, type: "series", title: "Dark", year: "2017", tmdb: { id: 3, kind: "tv", genres: [], seasons: 3, fetchedAt: 1 } }),
    "Dark (2017) | S03"
  );
});

test("totalEpisodes: your number, then TMDB, then the page", () => {
  assert.equal(totalEpisodes({ progressTotal: 10, tmdb: { episodes: 62 }, durationOrSeasons: "37 eps" }), 10);
  assert.equal(totalEpisodes({ tmdb: { episodes: 62 }, durationOrSeasons: "37 eps" }), 62);
  assert.equal(totalEpisodes({ durationOrSeasons: "37 eps" }), 37);
  assert.equal(totalEpisodes({ durationOrSeasons: "1 ep" }), 1);
  assert.equal(totalEpisodes({ durationOrSeasons: "2h 28m" }), undefined);
  assert.equal(totalEpisodes({}), undefined);
});

test("genres become tags automatically, merged with the ones you typed", () => {
  assert.deepEqual(genreTags({ tmdb: { genres: ["Sci-Fi & Fantasy", "Action & Adventure", "Drama"] } }), ["sci-fi", "fantasy", "action", "adventure", "drama"]);
  assert.deepEqual(genreTags({ genre: "Crime / Fantasy" }), ["crime", "fantasy"]);
  assert.deepEqual(genreTags({ genre: "Drama", tmdb: { genres: ["Drama", "Crime"] } }), ["drama", "crime"], "no duplicates");
  assert.deepEqual(allTags({ tags: ["weekend", "drama"], tmdb: { genres: ["Drama", "Crime"] } }), ["weekend", "drama", "crime"]);
  assert.deepEqual(allTags({}), []);
});
