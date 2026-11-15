import { test, before } from "node:test";
import assert from "node:assert/strict";

// A fake chrome with real storage and a fake Trakt. Fake values only.
const store = {};
let onMessage, onAlarm;
const REDIRECT = "https://fakeextensionid.chromiumapp.org/trakt";
const CLIENT = "fakeclientid0123456789abcdef0123456789abcdef0123456789abcdef0123";
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
let authCancelled = false;
globalThis.chrome = new Proxy({}, {
  get(_, key) {
    if (key === "storage") {
      return {
        local: {
          get: async (k) => (typeof k === "string" ? { [k]: store[k] } : { ...store }),
          set: async (v) => { Object.assign(store, JSON.parse(JSON.stringify(v))); },
          remove: async (k) => { for (const one of [k].flat()) delete store[one]; },
        },
        onChanged: { addListener() {} },
      };
    }
    if (key === "runtime") return { onMessage: { addListener: (fn) => { onMessage = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, getURL: (p) => `chrome-extension://fake/${p}` };
    if (key === "alarms") return { onAlarm: { addListener: (fn) => { onAlarm = fn; } }, get: async () => undefined, create: () => {}, clear: async () => true };
    if (key === "identity") {
      return {
        getRedirectURL: (path) => `https://fakeextensionid.chromiumapp.org/${path}`,
        launchWebAuthFlow: async ({ url }) => {
          if (authCancelled) throw new Error("The user did not approve access.");
          const state = new URL(url).searchParams.get("state");
          authUrls.push(url);
          return `${REDIRECT}?code=fakecode123&state=${state}`;
        },
      };
    }
    if (key === "tabs") return { create: async () => {}, query: async () => [], onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
    return noop;
  },
});

// The fake Trakt: records every request and answers like the real one.
const authUrls = [];
const requests = [];
const fail = {}; // path -> status to answer once
let watchedShows = [];
let watchedMovies = [];
let tokenCount = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const body = init.body ? JSON.parse(init.body) : undefined;
  requests.push({ host: u.hostname, path: u.pathname, method: init.method ?? "GET", body, headers: init.headers });
  const json = (status, value) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => value, text: async () => JSON.stringify(value) });
  if (u.hostname === "auth.trakt.tv") {
    if (u.pathname === "/oauth/token") {
      tokenCount++;
      return json(200, { access_token: `access-token-${tokenCount}`, refresh_token: `refresh-token-${tokenCount}`, expires_in: 604800, created_at: Math.floor(Date.now() / 1000), token_type: "bearer", scope: "public" });
    }
    if (u.pathname === "/oauth/revoke") return json(200, {});
  }
  if (u.hostname !== "api.trakt.tv") throw new Error("unexpected host " + u.hostname);
  if (fail[u.pathname]) {
    const status = fail[u.pathname];
    delete fail[u.pathname];
    return json(status, {});
  }
  if (u.pathname === "/users/settings") return json(200, { user: { username: "fakeuser" } });
  if (u.pathname === "/sync/watched/movies") return json(200, watchedMovies);
  if (u.pathname === "/sync/watched/shows") return json(200, watchedShows);
  if (u.pathname === "/sync/ratings/movies" && (init.method ?? "GET") === "GET") return json(200, [{ rating: 8, movie: { ids: { tmdb: 777 } } }]);
  if (u.pathname === "/sync/ratings/shows" && (init.method ?? "GET") === "GET") return json(200, []);
  if (u.pathname.startsWith("/sync/")) return json(201, { added: {}, not_found: { movies: (body?.movies ?? []).filter((m) => m.ids.tmdb === 404).map((m) => ({ ids: m.ids })), shows: [] } });
  return json(404, {});
};

const send = (message) => new Promise((resolve) => { onMessage(message, {}, resolve); });
const posts = (path) => requests.filter((r) => r.method === "POST" && r.path === path);
const items = () => store.trackbuddy_items;

const movie = (id, tmdbId, extra = {}) => ({
  id, title: id, type: "movie", year: "2020", subtitle: "", googleQuery: id, sourceUrl: "", savedAt: 1,
  tmdb: { id: tmdbId, kind: "movie", genres: [], fetchedAt: Date.now() }, ...extra,
});
const show = (id, tmdbId, extra = {}) => ({
  id, title: id, type: "series", year: "2020", subtitle: "", googleQuery: id, sourceUrl: "", savedAt: 1,
  tmdb: { id: tmdbId, kind: "tv", genres: [], fetchedAt: Date.now(), seasons: 2, seasonEpisodes: [3, 3] }, ...extra,
});

before(async () => {
  store.trackbuddy_items = [
    movie("Heat", 949, { status: "done", done: true, myRating: 8 }),
    movie("Unknown film", 404, { status: "done", done: true }),
    show("Dark", 70523, { status: "in_progress", seasonProgress: [2, 0] }),
    // Already watched and rated 8 on Trakt: its rating of 6 here must not overwrite Trakt's on the first send.
    movie("Rated elsewhere", 777, { status: "done", done: true, myRating: 6 }),
  ];
  watchedMovies = [{ movie: { ids: { tmdb: 777 } } }];
  // Trakt already has S1E1 of Dark (an earlier import): it must not be sent again.
  watchedShows = [{ show: { ids: { tmdb: 70523 } }, seasons: [{ number: 1, episodes: [{ number: 1 }] }] }];
  await import("../dist-test/background-main.js");
});

test("a Client ID is checked before it is saved", async () => {
  const bad = await send({ action: "traktSetClientId", clientId: "not valid!" });
  assert.equal(bad.ok, false);
  const good = await send({ action: "traktSetClientId", clientId: ` ${CLIENT} ` });
  assert.equal(good.ok, true);
  assert.equal(good.trakt.clientId, CLIENT);
  assert.equal(good.trakt.connected, false);
  assert.equal(good.trakt.redirectUri, REDIRECT);
});

test("a cancelled sign-in says so and stays disconnected", async () => {
  authCancelled = true;
  const res = await send({ action: "traktConnect" });
  authCancelled = false;
  assert.equal(res.ok, false);
  assert.match(res.error, /cancelled/i);
});

test("connecting uses PKCE: a challenge in the address, the verifier in the exchange, no secret", async () => {
  const res = await send({ action: "traktConnect" });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.trakt.connected, true);
  assert.equal(res.trakt.username, "fakeuser");
  assert.equal(res.trakt.ready, false);
  const auth = new URL(authUrls.at(-1));
  assert.equal(auth.hostname, "auth.trakt.tv");
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  assert.ok(auth.searchParams.get("code_challenge"));
  const exchange = requests.find((r) => r.path === "/oauth/token").body;
  assert.equal(exchange.grant_type, "authorization_code");
  assert.equal(exchange.code, "fakecode123");
  assert.equal(exchange.redirect_uri, REDIRECT);
  assert.match(exchange.code_verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal("client_secret" in exchange, false);
  // Tokens never end up on the items.
  assert.equal(JSON.stringify(items()).includes("access-token"), false);
});

test("nothing is sent automatically before the first Send everything", async () => {
  await send({ action: "update", id: "Heat", changes: { myRating: 9 } });
  onAlarm({ name: "keepshelf-trakt-sync" });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(requests.filter((r) => r.path.startsWith("/sync/") && r.method === "POST").length, 0);
});

test("Preview only reads: it lists what would go and which Trakt ratings are kept", async () => {
  const before = requests.length;
  const itemsBefore = JSON.stringify(items());
  const res = await send({ action: "traktPreview" });
  assert.equal(res.ok, true, res.error);
  const made = requests.slice(before);
  assert.ok(made.length > 0);
  assert.equal(made.some((r) => r.method !== "GET"), false, "a preview must not write to Trakt");
  assert.equal(JSON.stringify(items()), itemsBefore, "a preview must not change the shelf");
  const p = res.traktPreview;
  const titles = p.rows.map((r) => r.title).sort();
  assert.deepEqual(titles, ["Dark", "Heat", "Unknown film"]);
  assert.deepEqual(p.rows.find((r) => r.title === "Dark").parts, ["S1 E2 (1 episode)"]);
  assert.equal(p.movies, 2);
  assert.equal(p.episodes, 1);
  assert.deepEqual(p.kept.map((k) => [k.title, k.trakt, k.yours]), [["Rated elsewhere", 8, 6]]);
  const status = await send({ action: "traktStatus" });
  assert.equal(status.trakt.ready, false);
});

test("Send everything reads Trakt first and sends only what is missing, with air dates", async () => {
  const res = await send({ action: "traktSync" });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.trakt.ready, true);
  const history = posts("/sync/history");
  assert.equal(history.length, 1);
  const body = history[0].body;
  assert.deepEqual(body.movies.map((m) => m.ids.tmdb).sort(), [404, 949]);
  assert.deepEqual(body.shows, [{ ids: { tmdb: 70523 }, seasons: [{ number: 1, episodes: [{ number: 2, watched_at: "released" }] }] }]);
  assert.equal(posts("/sync/ratings")[0].body.movies[0].rating, 9);
  // The title Trakt had already rated keeps Trakt's rating.
  assert.equal(posts("/sync/ratings")[0].body.movies.some((m) => m.ids.tmdb === 777), false);
  // Every call carries the key, the version and the token.
  assert.equal(history[0].headers["trakt-api-key"], CLIENT);
  assert.equal(history[0].headers["trakt-api-version"], "2");
  assert.match(history[0].headers.Authorization, /^Bearer access-token-/);
  // What went through is remembered; what Trakt didn't know is listed.
  const dark = items().find((i) => i.id === "Dark");
  assert.deepEqual(dark.trakt.sent.seasons, [2, 0]);
  assert.deepEqual(res.trakt.problems.map((p) => p.title), ["Unknown film"]);
  assert.equal(res.trakt.pending, 0);
});

test("sending again sends nothing twice", async () => {
  const before = requests.length;
  const res = await send({ action: "traktSync" });
  assert.equal(res.ok, true);
  assert.equal(requests.slice(before).filter((r) => r.method === "POST").length, 0);
  assert.match(res.trakt.lastMessage, /up to date/);
});

test("a later change sends just that episode", async () => {
  await send({ action: "update", id: "Dark", changes: { seasonProgress: [3, 0] } });
  await send({ action: "traktSync" });
  const last = posts("/sync/history").at(-1).body;
  assert.deepEqual(last.shows[0].seasons[0].episodes.map((e) => e.number), [3]);
});

test("if ratings fail after history went through, history is still recorded and never resent", async () => {
  await send({ action: "update", id: "Dark", changes: { seasonProgress: [3, 1], myRating: 7 } });
  fail["/sync/ratings"] = 500;
  const failed = await send({ action: "traktSync" });
  assert.equal(failed.ok, false);
  assert.deepEqual(items().find((i) => i.id === "Dark").trakt.sent.seasons, [3, 1]);
  const historyBefore = posts("/sync/history").length;
  const retry = await send({ action: "traktSync" });
  assert.equal(retry.ok, true, retry.error);
  assert.equal(posts("/sync/history").length, historyBefore, "history must not be sent again");
  assert.equal(posts("/sync/ratings").at(-1).body.shows[0].rating, 7);
});

test("an expired token is refreshed once and the call retried", async () => {
  await send({ action: "update", id: "Heat", changes: { myRating: 10 } });
  fail["/sync/ratings"] = 401;
  const tokensBefore = requests.filter((r) => r.path === "/oauth/token").length;
  const res = await send({ action: "traktSync" });
  assert.equal(res.ok, true, res.error);
  const refresh = requests.filter((r) => r.path === "/oauth/token").slice(tokensBefore);
  assert.equal(refresh.length, 1);
  assert.equal(refresh[0].body.grant_type, "refresh_token");
  assert.equal(posts("/sync/ratings").at(-1).body.movies[0].rating, 10);
});

test("after the first send, a change goes automatically and is dated now", async () => {
  const before = posts("/sync/history").length;
  await send({ action: "update", id: "Dark", changes: { seasonProgress: [3, 2] } });
  onAlarm({ name: "keepshelf-trakt-sync" });
  for (let i = 0; i < 100 && posts("/sync/history").length === before; i++) await new Promise((r) => setTimeout(r, 50));
  const sent = posts("/sync/history").at(-1).body.shows[0].seasons[0];
  assert.equal(sent.number, 2);
  assert.deepEqual(sent.episodes.map((e) => e.number), [2]);
  assert.match(sent.episodes[0].watched_at, /^\d{4}-\d{2}-\d{2}T/);
  await new Promise((r) => setTimeout(r, 1300));
});

test("a full account limit stops with a clear message", async () => {
  await send({ action: "traktSetOptions", watchlist: true });
  store.trackbuddy_items.push(movie("Later", 555, { status: "plan" }));
  fail["/sync/watchlist"] = 420;
  const res = await send({ action: "traktSync" });
  assert.equal(res.ok, false);
  assert.match(res.error, /limit/i);
  const status = await send({ action: "traktStatus" });
  assert.match(status.trakt.lastError, /limit/i);
});

test("disconnecting revokes the token and forgets what was sent", async () => {
  const res = await send({ action: "traktDisconnect" });
  assert.equal(res.ok, true);
  assert.equal(res.trakt.connected, false);
  const revoke = requests.find((r) => r.path === "/oauth/revoke");
  assert.equal(revoke.body.client_id, CLIENT);
  assert.ok(revoke.body.token);
  assert.equal(items().some((i) => i.trakt), false);
});
