import { test, before } from "node:test";
import assert from "node:assert/strict";

// A fake chrome: real storage behaviour, and every other API quietly does nothing.
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
globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.hostname !== "api.themoviedb.org") throw new Error("unexpected host " + u.hostname);
  calls.push(u.pathname);
  const id = Number(u.pathname.split("/").pop());
  return {
    ok: true, status: 200,
    json: async () => ({
      id, genres: [{ name: "Drama" }], number_of_seasons: 3, number_of_episodes: 24,
      seasons: [{ season_number: 0, episode_count: 5 }, { season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 8 }, { season_number: 3, episode_count: 6 }],
    }),
  };
};

const send = (message) => new Promise((resolve) => { onMessage(message, {}, resolve); });
const base = { subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1 };
const FAKE_KEY = "0123456789abcdef0123456789abcdef";

before(async () => { await import("../dist-test/background-main.js"); });

test("a show saved before seasons existed gets them on the next refresh, and fresh ones are left alone", async () => {
  const now = Date.now();
  store.keepshelf_tmdb_token = FAKE_KEY;
  store.trackbuddy_items = [
    { ...base, id: "old", title: "Old Show", type: "series", tmdb: { id: 11, kind: "tv", genres: [], seasons: 3, episodes: 24, fetchedAt: now - 1000 } },
    { ...base, id: "new", title: "New Show", type: "series", tmdb: { id: 22, kind: "tv", genres: [], seasons: 3, episodes: 24, seasonEpisodes: [10, 8, 6], fetchedAt: now - 1000 } },
    { ...base, id: "film", title: "A Film", type: "movie", tmdb: { id: 33, kind: "movie", genres: [], fetchedAt: now - 1000 } },
  ];
  const res = await send({ action: "refreshStaleTmdb" });
  assert.equal(res.ok, true);
  assert.deepEqual(calls, ["/3/tv/11"], "only the show without seasons is fetched");
  const byId = Object.fromEntries(res.items.map((i) => [i.id, i]));
  assert.deepEqual(byId.old.tmdb.seasonEpisodes, [10, 8, 6], "specials left out, seasons in order");
  assert.deepEqual(byId.new.tmdb.seasonEpisodes, [10, 8, 6]);
  assert.equal(byId.film.tmdb.seasonEpisodes, undefined);

  calls.length = 0;
  await send({ action: "refreshStaleTmdb" });
  assert.deepEqual(calls, [], "once filled in, it is not fetched again");
});

test("updating season progress through the background keeps the overall count in step and validates against TMDB", async () => {
  const ok = await send({ action: "update", id: "new", changes: { seasonProgress: [10, 3, 0] } });
  assert.equal(ok.ok, true);
  const item = ok.items.find((i) => i.id === "new");
  assert.deepEqual(item.seasonProgress, [10, 3, 0]);
  assert.equal(item.progressCurrent, 13);

  const bad = await send({ action: "update", id: "new", changes: { seasonProgress: [10, 9, 0] } });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Season 2 has 8 episodes/);
  assert.deepEqual((await send({ action: "getAll" })).items.find((i) => i.id === "new").seasonProgress, [10, 3, 0], "a rejected update changes nothing");
});
