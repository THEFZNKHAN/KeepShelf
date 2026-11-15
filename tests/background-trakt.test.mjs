import { test, before } from "node:test";
import assert from "node:assert/strict";

// A fake chrome with real storage and a fake Trakt. Fake values only.
const store = {};
const session = {};
let traktLists = [];
let onMessage, onAlarm;
const REDIRECT = "https://fakeextensionid.chromiumapp.org/trakt";
const CLIENT = "fakeclientid0123456789abcdef0123456789abcdef0123456789abcdef0123";
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
let authCancelled = false;
const alarms = new Map();
let activities = { episodes: { watched_at: "2026-11-15T10:00:00.000Z" }, movies: { watched_at: "2026-11-15T10:00:00.000Z" } };
globalThis.chrome = new Proxy({}, {
  get(_, key) {
    if (key === "storage") {
      return {
        local: {
          get: async (k) => (typeof k === "string" ? { [k]: store[k] } : { ...store }),
          set: async (v) => { Object.assign(store, JSON.parse(JSON.stringify(v))); },
          remove: async (k) => { for (const one of [k].flat()) delete store[one]; },
        },
        session: {
          get: async (k) => ({ [k]: session[k] }),
          set: async (v) => { Object.assign(session, JSON.parse(JSON.stringify(v))); },
        },
        onChanged: { addListener() {} },
      };
    }
    if (key === "runtime") return { onMessage: { addListener: (fn) => { onMessage = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, getURL: (p) => `chrome-extension://fake/${p}` };
    if (key === "alarms") {
      return {
        onAlarm: { addListener: (fn) => { onAlarm = fn; } },
        get: async (name) => alarms.get(name),
        create: async (name, info) => { alarms.set(name, info); },
        clear: async (name) => { alarms.delete(name); return true; },
      };
    }
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
  requests.push({ host: u.hostname, path: u.pathname, method: init.method ?? "GET", body, headers: init.headers, cache: init.cache });
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
  if (u.pathname === "/sync/last_activities") return json(200, activities);
  if (u.pathname === "/users/me/lists") return json(200, traktLists.map((l) => ({ name: l.name, ids: { trakt: l.id } })));
  const listItems = /^\/users\/me\/lists\/(\d+)\/items$/.exec(u.pathname);
  if (listItems) return json(200, traktLists.find((l) => String(l.id) === listItems[1])?.items ?? []);
  if (u.pathname === "/movies/tt0113277/ratings") return json(200, { rating: 8.4123, votes: 2500 });
  if (u.pathname === "/recommendations/movies") return json(200, [{ title: "Collateral", year: 2004, ids: { tmdb: 1538 } }]);
  if (u.pathname === "/recommendations/shows") return json(200, [{ title: "Frieren", year: 2023, ids: { tmdb: 209867 }, genres: ["anime"] }]);
  if (u.pathname === "/search/tmdb/70523") return json(200, [{ type: "show", show: { ids: { trakt: 120, tmdb: 70523 } } }]);
  if (u.pathname === "/shows/120/ratings") return json(200, { rating: 8.9, votes: 900 });
  if (u.pathname === "/sync/watched/movies") return json(200, watchedMovies);
  if (u.pathname === "/sync/watched/shows") {
    // Like Trakt now: the watched list has no seasons; each show's episodes are on its progress page.
    return json(200, watchedShows.map(({ seasons: _s, ...rest }) => ({ ...rest, show: { ...rest.show, ids: { ...rest.show.ids, trakt: rest.show.ids.tmdb } } })));
  }
  const progress = /^\/shows\/(\d+)\/progress\/watched$/.exec(u.pathname);
  if (progress) {
    const entry = watchedShows.find((e) => String(e.show.ids.tmdb) === progress[1]);
    if (!entry) return json(404, {});
    return json(200, { seasons: entry.seasons.map((x) => ({ number: x.number, episodes: x.episodes.map((e) => ({ number: e.number, completed: true })) })) });
  }
  if (u.pathname === "/sync/ratings/movies" && (init.method ?? "GET") === "GET") return json(200, [{ rating: 8, movie: { ids: { tmdb: 777 } } }]);
  if (u.pathname === "/sync/ratings/shows" && (init.method ?? "GET") === "GET") return json(200, []);
  if (u.pathname === "/sync/watchlist/movies" && (init.method ?? "GET") === "GET") return json(200, []);
  if (u.pathname === "/sync/watchlist/shows" && (init.method ?? "GET") === "GET") {
    return json(200, [{ show: { title: "Frieren", year: 2023, ids: { tmdb: 209867 }, genres: ["anime", "animation"] } }]);
  }
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
  watchedShows = [{ show: { ids: { tmdb: 70523 } }, last_watched_at: "2026-01-01T00:00:00.000Z", seasons: [{ number: 1, episodes: [{ number: 1 }] }] }];
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
  assert.ok(requests.some((r) => r.path === "/shows/70523/progress/watched"), "episodes come from the show's progress page");
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

test("Get from Trakt: the preview only reads, and lists the titles that would be added", async () => {
  // Watched only on Trakt: its episodes are on its progress page, not in the watched list.
  watchedShows.push({ show: { title: "Naruto", year: 2002, ids: { tmdb: 46260 } }, seasons: [{ number: 1, episodes: [{ number: 1 }, { number: 2 }, { number: 3 }] }] });
  const before = requests.length;
  const shelf = JSON.stringify(items());
  const res = await send({ action: "traktPullPreview" });
  assert.equal(res.ok, true, res.error);
  assert.equal(requests.slice(before).some((r) => r.method !== "GET"), false);
  assert.equal(JSON.stringify(items()), shelf);
  assert.deepEqual(res.traktPull.additions.map((a) => a.title), ["Frieren (2023)", "Naruto (2002)"]);
  assert.deepEqual(res.traktPull.additions[0].parts, ["anime", "to watch"]);
  assert.deepEqual(res.traktPull.additions[1].parts, ["series", "3 episodes watched"]);
  // Every read goes to Trakt itself, never to an old copy in the browser's cache.
  assert.equal(requests.slice(before).every((r) => r.cache === "no-store"), true);
});

test("applying adds it as To watch, and the next send doesn't push it back to Trakt", async () => {
  const res = await send({ action: "traktPullApply" });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.added, 2);
  assert.equal(items().find((i) => i.title === "Naruto").progressCurrent, 3);
  const frieren = items().find((i) => i.title === "Frieren");
  assert.equal(frieren.type, "anime");
  assert.equal(frieren.status, "plan");
  assert.equal(frieren.trakt.sent.watchlist, true);
  const before = requests.length;
  await send({ action: "traktSync" });
  const posted = requests.slice(before).filter((r) => r.method === "POST");
  assert.equal(posted.some((r) => JSON.stringify(r.body).includes("209867")), false, "a pulled title must not be sent back");
  assert.equal(posted.some((r) => JSON.stringify(r.body).includes("46260")), false, "pulled episodes must not be sent back");
});

const waitForCheck = async (before) => {
  for (let i = 0; i < 100; i++) {
    const st = (await send({ action: "traktStatus" })).trakt;
    if (!st.running && st.pullAt && st.pullAt !== before) return st;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("the automatic check didn't finish");
};

test("a fixed match reads Trakt for that title again, so nothing is sent twice", async () => {
  // Pretend "Unknown film" (not found on Trakt) is matched to Heat's TMDB entry, which Trakt already has watched.
  const item = store.trackbuddy_items.find((i) => i.id === "Unknown film");
  item.tmdb = { id: 777, kind: "movie", genres: [], fetchedAt: Date.now() };
  item.trakt = { reseed: true };
  const before = requests.length;
  const res = await send({ action: "traktSync" });
  assert.equal(res.ok, true, res.error);
  const after = requests.slice(before);
  assert.ok(after.some((r) => r.path === "/sync/watched/movies"), "Trakt is read for the new match");
  assert.equal(after.some((r) => r.method === "POST" && JSON.stringify(r.body).includes("777")), false, "Trakt already had it");
  const fixed = items().find((i) => i.id === "Unknown film");
  assert.equal(fixed.trakt.reseed, undefined);
  assert.equal(fixed.trakt.sent.movie, true);
});

test("Trakt lists come in as tags, and a listed title not on the shelf is added as To watch", async () => {
  traktLists = [{ id: 7, name: "Favourites", items: [
    { type: "movie", movie: { title: "Heat", year: 1995, ids: { tmdb: 949 } } },
    { type: "show", show: { title: "Mindhunter", year: 2017, ids: { tmdb: 67744 } } },
    { type: "episode", show: { title: "Dark", year: 2017, ids: { tmdb: 70523 } }, episode: { season: 1, number: 1 } },
  ] }];
  const preview = await send({ action: "traktPullPreview" });
  assert.equal(preview.ok, true, preview.error);
  assert.ok(preview.traktPull.updates.some((u) => u.title === "Heat" && u.parts.includes("tagged trakt: favourites")));
  assert.ok(preview.traktPull.updates.some((u) => u.title === "Dark" && u.parts.includes("tagged trakt: favourites")), "an episode on a list tags its show");
  const added = preview.traktPull.additions.find((a) => a.title.startsWith("Mindhunter"));
  assert.deepEqual(added.parts, ["series", "to watch", "tagged trakt: favourites"]);
  const res = await send({ action: "traktPullApply" });
  assert.equal(res.ok, true, res.error);
  assert.ok(items().find((i) => i.id === "Heat").tags.includes("trakt: favourites"));
  assert.equal(items().find((i) => i.title === "Mindhunter").status, "plan");
  traktLists = [];
});

test("Recommended for you lists Trakt's picks, shows and movies in turn", async () => {
  const res = await send({ action: "traktForYou" });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(res.tmdbResults.map((r) => [r.title, r.type, r.group]), [["Frieren", "anime", "trakt"], ["Collateral", "movie", "trakt"]]);
  const asked = requests.filter((r) => r.path.startsWith("/recommendations/"));
  assert.match(asked[0].headers.Authorization, /^Bearer /, "personal picks need the sign-in");
});

test("the automatic check is an alarm that follows the setting", async () => {
  let res = await send({ action: "traktSetOptions", pull: "6h" });
  assert.equal(res.trakt.pull, "6h");
  assert.equal(alarms.get("keepshelf-trakt-pull").periodInMinutes, 360);
  res = await send({ action: "traktSetOptions", pull: "every minute" });
  assert.equal(res.trakt.pull, "off", "only the offered choices are accepted");
  assert.equal(alarms.has("keepshelf-trakt-pull"), false);
  await send({ action: "traktSetOptions", pull: "1h" });
  assert.equal(alarms.get("keepshelf-trakt-pull").periodInMinutes, 60);
});

test("with nothing new on Trakt, a check costs one request", async () => {
  // The last Get from Trakt recorded Trakt's activity; nothing has happened since.
  const before = (await send({ action: "traktStatus" })).trakt.pullAt;
  const count = requests.length;
  onAlarm({ name: "keepshelf-trakt-pull" });
  await waitForCheck(before);
  assert.deepEqual(requests.slice(count).map((r) => r.path), ["/sync/last_activities"]);
});

test("after something changes on Trakt, the check applies it and reads only what changed", async () => {
  const naruto = watchedShows.find((e) => e.show.ids.tmdb === 46260);
  naruto.seasons[0].episodes.push({ number: 4 }, { number: 5 });
  naruto.last_watched_at = new Date().toISOString();
  activities = { ...activities, episodes: { watched_at: new Date().toISOString() } };
  const before = (await send({ action: "traktStatus" })).trakt.pullAt;
  const count = requests.length;
  onAlarm({ name: "keepshelf-trakt-pull" });
  const st = await waitForCheck(before);
  assert.equal(items().find((i) => i.title === "Naruto").progressCurrent, 5);
  const progressReads = requests.slice(count).filter((r) => r.path.endsWith("/progress/watched")).map((r) => r.path);
  assert.deepEqual(progressReads, ["/shows/46260/progress/watched"], "shows unchanged since the last check aren't read again");
  assert.equal(requests.slice(count).filter((r) => r.path === "/sync/last_activities").length, 1, "Trakt's activity is read once per check");
  assert.equal(requests.slice(count).some((r) => r.method === "POST"), false, "a check never writes to Trakt");
  assert.match(st.pullMessage, /by itself: 1 updated/);
});

test("disconnecting revokes the token and forgets what was sent", async () => {
  const res = await send({ action: "traktDisconnect" });
  assert.equal(res.ok, true);
  assert.equal(res.trakt.connected, false);
  const revoke = requests.find((r) => r.path === "/oauth/revoke");
  assert.equal(revoke.body.client_id, CLIENT);
  assert.ok(revoke.body.token);
  assert.equal(items().some((i) => i.trakt), false);
  assert.equal(alarms.has("keepshelf-trakt-pull"), false, "no automatic checks once disconnected");
});

test("a card's Trakt rating needs only the Client ID, and is kept for a day", async () => {
  // Disconnected by now: ratings are public.
  store.trackbuddy_items.find((i) => i.id === "Heat").tmdb.imdbId = "tt0113277";
  const res = await send({ action: "traktRating", id: "Heat" });
  assert.deepEqual(res.traktRating, { percent: 84, votes: 2500 });
  const sent = requests.filter((r) => r.path === "/movies/tt0113277/ratings");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].headers.Authorization, undefined, "no sign-in is sent for a public read");
  await send({ action: "traktRating", id: "Heat" });
  assert.equal(requests.filter((r) => r.path === "/movies/tt0113277/ratings").length, 1, "the second card open uses the cache");
  // Without an IMDb id, the Trakt id is found from TMDB's.
  const dark = await send({ action: "traktRating", id: "Dark" });
  assert.deepEqual(dark.traktRating, { percent: 89, votes: 900 });
});
