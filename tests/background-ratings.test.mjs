import { test, before } from "node:test";
import assert from "node:assert/strict";

// A fake chrome with local and session storage; every other API quietly does nothing.
const store = {};
const session = {};
let sessionBroken = false;
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
        session: {
          get: async (k) => { if (sessionBroken) throw new Error("no session storage"); return { [k]: session[k] }; },
          set: async (v) => { if (sessionBroken) throw new Error("no session storage"); Object.assign(session, JSON.parse(JSON.stringify(v))); },
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
  calls.push(u.pathname + "?" + (u.searchParams.get("append_to_response") ?? ""));
  if (status !== 200) return { ok: false, status, json: async () => ({}) };
  const body = { id: 1, seasons: [{ season_number: 1 }, { season_number: 2 }] };
  for (const part of (u.searchParams.get("append_to_response") ?? "").split(",").filter(Boolean)) {
    const n = Number(part.split("/")[1]);
    if (n <= 2) body[part] = { season_number: n, episodes: [{ episode_number: 1, name: `S${n}E1`, vote_average: 8.4, vote_count: 99 }] };
  }
  return { ok: true, status: 200, json: async () => body };
};

const send = (message) => new Promise((resolve) => { onMessage(message, {}, resolve); });
const base = { subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1 };
const FAKE_KEY = "0123456789abcdef0123456789abcdef";
const items = () => [
  { ...base, id: "show", title: "Show", type: "series", tmdb: { id: 70523, kind: "tv", genres: [], seasons: 2, fetchedAt: Date.now() } },
  { ...base, id: "anime", title: "Anime", type: "anime", tmdb: { id: 31, kind: "tv", genres: [], seasons: 2, fetchedAt: Date.now() } },
  { ...base, id: "film", title: "Film", type: "movie", tmdb: { id: 9, kind: "movie", genres: [], fetchedAt: Date.now() } },
  { ...base, id: "plain", title: "No info", type: "series" },
  { ...base, id: "book", title: "Book", type: "book" },
];

before(async () => { await import("../dist-test/background-main.js"); });
const reset = () => {
  for (const k of Object.keys(session)) delete session[k];
  calls.length = 0; status = 200; sessionBroken = false;
  store.trackbuddy_items = items();
  store.keepshelf_tmdb_token = FAKE_KEY;
};

test("episodeRatings fetches a show's grid in one request and returns it", async () => {
  reset();
  const res = await send({ action: "episodeRatings", id: "show" });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\/3\/tv\/70523\?season\/1,season\/2$/);
  assert.deepEqual(res.episodeRatings.seasons.map((s) => s.season), [1, 2]);
  assert.equal(res.episodeRatings.seasons[0].episodes[0].rating, 8.4);
});

test("anime series get ratings too", async () => {
  reset();
  const res = await send({ action: "episodeRatings", id: "anime" });
  assert.equal(res.ok, true);
  assert.match(calls[0], /\/tv\/31\?/);
});

test("a second request is served from the session cache without asking TMDB again", async () => {
  reset();
  const first = await send({ action: "episodeRatings", id: "show" });
  const again = await send({ action: "episodeRatings", id: "show" });
  const third = await send({ action: "episodeRatings", id: "show" });
  assert.equal(again.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(again.episodeRatings, first.episodeRatings, "the cached copy is the same grid, not an emptied one");
  assert.deepEqual(third.episodeRatings, first.episodeRatings, "and it stays that way on every later open");
  assert.equal(again.episodeRatings.seasons[0].episodes[0].rating, 8.4);
  assert.ok(session.keepshelf_er_70523, "kept per show, in session storage only");
  assert.equal(store.keepshelf_er_70523, undefined, "never in the saved shelf data");
  assert.equal(JSON.stringify(store.trackbuddy_items).includes("episodes"), false, "nothing added to the items");
});

test("force asks TMDB again, and an old cache entry is refreshed", async () => {
  reset();
  await send({ action: "episodeRatings", id: "show" });
  await send({ action: "episodeRatings", id: "show", force: true });
  assert.equal(calls.length, 2);
  session.keepshelf_er_70523.fetchedAt = Date.now() - 25 * 3600 * 1000;
  await send({ action: "episodeRatings", id: "show" });
  assert.equal(calls.length, 3, "older than a day");
});

test("a damaged cache entry is ignored", async () => {
  reset();
  session.keepshelf_er_70523 = { fetchedAt: "yesterday", seasons: 5 };
  const res = await send({ action: "episodeRatings", id: "show" });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
});

test("without session storage it still works, just without a cache", async () => {
  reset();
  sessionBroken = true;
  const first = await send({ action: "episodeRatings", id: "show" });
  assert.equal(first.ok, true);
  await send({ action: "episodeRatings", id: "show" });
  assert.equal(calls.length, 2);
});

test("titles without TMDB series info get a clear error and no request", async () => {
  reset();
  for (const id of ["film", "plain", "book", "missing"]) {
    const res = await send({ action: "episodeRatings", id });
    assert.equal(res.ok, false, id);
    assert.match(res.error, /no TMDB series info/);
  }
  assert.equal(calls.length, 0);
});

test("no token asks for one", async () => {
  reset();
  delete store.keepshelf_tmdb_token;
  const res = await send({ action: "episodeRatings", id: "show" });
  assert.deepEqual(res, { ok: false, error: "Add your TMDB token in Settings first." });
  assert.equal(calls.length, 0);
});

test("TMDB failures come back as plain errors and are not cached", async () => {
  reset();
  status = 401;
  const bad = await send({ action: "episodeRatings", id: "show" });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /token/i);
  assert.equal(session.keepshelf_er_70523, undefined);
  status = 200;
  assert.equal((await send({ action: "episodeRatings", id: "show" })).ok, true);
});
