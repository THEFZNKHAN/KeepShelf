import { test, before } from "node:test";
import assert from "node:assert/strict";

// A fake chrome with real storage behaviour; every other API quietly does nothing.
const store = {};
let onMessage;
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
globalThis.chrome = new Proxy({}, {
  get(_, key) {
    if (key === "storage") {
      return {
        local: {
          get: async (k) => (typeof k === "string" ? { [k]: store[k] } : { ...store }),
          set: async (v) => { Object.assign(store, JSON.parse(JSON.stringify(v))); },
          remove: async (k) => { delete store[k]; },
        },
        onChanged: { addListener() {} },
      };
    }
    if (key === "runtime") return { onMessage: { addListener: (fn) => { onMessage = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, getURL: (p) => p };
    return noop;
  },
});

const calls = [];
let status = 200;
globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.hostname !== "api.themoviedb.org") throw new Error("unexpected host " + u.hostname);
  calls.push({ path: u.pathname, params: Object.fromEntries(u.searchParams) });
  if (status !== 200) return { ok: false, status, json: async () => ({}) };
  if (u.pathname === "/3/search/multi") {
    return { ok: true, status: 200, json: async () => ({ results: [
      { id: 70523, media_type: "tv", name: "Dark", first_air_date: "2017-12-01", poster_path: "/dark.jpg", vote_average: 8.4, vote_count: 9000, genre_ids: [18], original_language: "de" },
      { id: 9, media_type: "person", name: "Someone" },
      { id: 603, media_type: "movie", title: "The Matrix", release_date: "1999-03-30", vote_average: 8.2, vote_count: 20000, genre_ids: [28], original_language: "en" },
    ] }) };
  }
  const id = Number(u.pathname.split("/").pop());
  return { ok: true, status: 200, json: async () => ({ id, genres: [{ name: "Drama" }], number_of_seasons: 3, number_of_episodes: 26, seasons: [{ season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 8 }, { season_number: 3, episode_count: 8 }], poster_path: "/dark.jpg", vote_average: 8.4 }) };
};

const send = (message) => new Promise((resolve) => { onMessage(message, {}, resolve); });
const FAKE_KEY = "0123456789abcdef0123456789abcdef";
const dark = { id: 70523, kind: "tv", type: "series", title: "Dark", year: "2017" };

before(async () => { await import("../dist-test/background-main.js"); });
const reset = () => { calls.length = 0; status = 200; store.trackbuddy_items = []; store.keepshelf_tmdb_token = FAKE_KEY; };

test("searchTmdb returns movies and series from one request, and sends only the typed words", async () => {
  reset();
  const res = await send({ action: "searchTmdb", query: "  dark   matter " });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/3/search/multi");
  assert.equal(calls[0].params.query, "dark matter");
  assert.equal(calls[0].params.include_adult, "false");
  assert.deepEqual(res.tmdbResults.map((r) => r.title), ["Dark", "The Matrix"], "people are left out");
  assert.equal(res.tmdbResults[0].kind, "tv");
});

test("searchTmdb refuses very short searches and needs a token, without calling TMDB", async () => {
  reset();
  for (const query of ["", " ", "d", undefined, 5]) assert.equal((await send({ action: "searchTmdb", query })).ok, false, String(query));
  delete store.keepshelf_tmdb_token;
  assert.deepEqual(await send({ action: "searchTmdb", query: "dark" }), { ok: false, error: "Add your TMDB token in Settings first." });
  assert.equal(calls.length, 0);
});

test("searchTmdb passes TMDB's errors on in plain words", async () => {
  reset();
  status = 401;
  const res = await send({ action: "searchTmdb", query: "dark" });
  assert.equal(res.ok, false);
  assert.match(res.error, /token/i);
});

test("addFromTmdb saves the title with TMDB's info for exactly that title, and looks it up once", async () => {
  reset();
  const res = await send({ action: "addFromTmdb", result: dark });
  assert.equal(res.ok, true);
  assert.equal(res.duplicate, false);
  assert.deepEqual(calls.map((c) => c.path), ["/3/tv/70523"], "details only; no second search that could pick a different match");
  const saved = store.trackbuddy_items;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].title, "Dark");
  assert.equal(saved[0].year, "2017");
  assert.equal(saved[0].type, "series");
  assert.equal(saved[0].tmdb.id, 70523);
  assert.equal(saved[0].tmdb.kind, "tv");
  assert.deepEqual(saved[0].tmdb.seasonEpisodes, [10, 8, 8]);
  assert.equal(saved[0].sourceUrl, "https://www.themoviedb.org/tv/70523");
  assert.equal(saved[0].status, undefined, "starts as to watch");
});

test("adding the same title twice does not make a second copy", async () => {
  reset();
  await send({ action: "addFromTmdb", result: dark });
  const again = await send({ action: "addFromTmdb", result: dark });
  assert.equal(again.ok, true);
  assert.equal(again.duplicate, true);
  assert.equal(store.trackbuddy_items.length, 1);
});

test("addFromTmdb files an anime result as anime", async () => {
  reset();
  await send({ action: "addFromTmdb", result: { id: 209867, kind: "tv", type: "anime", title: "Frieren", year: "2023" } });
  assert.equal(store.trackbuddy_items[0].type, "anime");
});

test("addFromTmdb rejects a bad result and a missing token, saving nothing", async () => {
  reset();
  for (const result of [undefined, {}, { ...dark, id: "x" }, { ...dark, type: "book" }, { ...dark, kind: "person" }, { ...dark, title: "" }]) {
    assert.equal((await send({ action: "addFromTmdb", result })).ok, false, JSON.stringify(result));
  }
  delete store.keepshelf_tmdb_token;
  assert.deepEqual(await send({ action: "addFromTmdb", result: dark }), { ok: false, error: "Add your TMDB token in Settings first." });
  assert.equal(calls.length, 0);
  assert.equal(store.trackbuddy_items.length, 0);
});

test("a TMDB failure while adding saves nothing", async () => {
  reset();
  status = 404;
  const res = await send({ action: "addFromTmdb", result: dark });
  assert.equal(res.ok, false);
  assert.equal(store.trackbuddy_items.length, 0);
});
