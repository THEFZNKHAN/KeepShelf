import { test } from "node:test";
import assert from "node:assert/strict";
import { batches, buildBodies, buildPreview, entryTmdb, seasonsFromProgress, traktShowId, changeKey, describeChange, keepTraktRatings, notFoundIn, pendingChange, pendingChanges, ratingsFrom, seedFromWatched, traktIds } from "../dist-test/trakt-sync.js";

const OPTS = { watchlist: false };
const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
const movie = (extra = {}) => ({
  id: "m", title: "Heat", type: "movie", year: "1995", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1,
  tmdb: { id: 949, kind: "movie", genres: [], fetchedAt: 1, imdbId: "tt0113277" },
  ...extra,
});
const show = (extra = {}) => ({
  id: "s", title: "Dark", type: "series", year: "2017", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1,
  tmdb: { id: 70523, kind: "tv", genres: [], fetchedAt: 1, seasons: 3, seasonEpisodes: [10, 8, 8] },
  ...extra,
});

test("only TMDB-matched movies, series and anime can be sent", () => {
  assert.deepEqual(traktIds(movie()), { tmdb: 949, imdb: "tt0113277" });
  assert.equal(traktIds({ ...movie(), tmdb: undefined }), undefined);
  assert.equal(traktIds({ ...movie(), type: "book" }), undefined);
  assert.deepEqual(traktIds(show()), { tmdb: 70523 });
});

test("a finished movie is sent once", () => {
  const c = pendingChange(movie({ status: "done", done: true }), OPTS);
  assert.equal(c.movie, true);
  assert.equal(c.next.movie, true);
  assert.equal(pendingChange(movie({ status: "done", done: true, trakt: { sent: { movie: true } } }), OPTS), undefined);
  assert.equal(pendingChange(movie({ status: "plan" }), OPTS), undefined);
});

test("only the episodes not sent yet go out", () => {
  const c = pendingChange(show({ status: "in_progress", seasonProgress: [10, 3, 0] }), OPTS);
  assert.deepEqual(c.episodes, [[1, 1, 10], [2, 1, 3]]);
  const later = pendingChange(show({ status: "in_progress", seasonProgress: [10, 5, 0], trakt: { sent: { seasons: [10, 3, 0] } } }), OPTS);
  assert.deepEqual(later.episodes, [[2, 4, 5]]);
  assert.deepEqual(later.next.seasons, [10, 5, 0]);
});

test("unwatching never removes from Trakt, and watching again doesn't send a second play", () => {
  const back = show({ status: "in_progress", seasonProgress: [10, 1, 0], trakt: { sent: { seasons: [10, 5, 0] } } });
  assert.equal(pendingChange(back, OPTS), undefined);
  const again = show({ status: "in_progress", seasonProgress: [10, 6, 0], trakt: { sent: { seasons: [10, 5, 0] } } });
  assert.deepEqual(pendingChange(again, OPTS).episodes, [[2, 6, 6]]);
});

test("a show marked finished sends every episode of the seasons it had then", () => {
  const c = pendingChange(show({ status: "done", done: true, seasonsAtFinish: 2 }), OPTS);
  assert.deepEqual(c.episodes, [[1, 1, 10], [2, 1, 8]]);
});

test("without TMDB episode counts no episodes are sent", () => {
  const s = show({ status: "done", done: true });
  delete s.tmdb.seasonEpisodes;
  assert.equal(pendingChange(s, OPTS), undefined);
});

test("ratings are set, changed and removed", () => {
  assert.equal(pendingChange(movie({ myRating: 8 }), OPTS).rating, 8);
  assert.equal(pendingChange(movie({ myRating: 8, trakt: { sent: { rating: 8 } } }), OPTS), undefined);
  assert.equal(pendingChange(movie({ myRating: 9, trakt: { sent: { rating: 8 } } }), OPTS).rating, 9);
  const removed = pendingChange(movie({ trakt: { sent: { rating: 8 } } }), OPTS);
  assert.equal(removed.rating, null);
  assert.equal("rating" in removed.next, false);
});

test("the watchlist follows 'To watch' only when switched on", () => {
  assert.equal(pendingChange(movie({ status: "plan" }), { watchlist: true }).watchlist, "add");
  assert.equal(pendingChange(movie({ status: "plan" }), OPTS), undefined);
  const started = pendingChange(show({ status: "in_progress", seasonProgress: [1], trakt: { sent: { watchlist: true } } }), { watchlist: true });
  assert.equal(started.watchlist, "remove");
});

test("a title with a problem still sends what changes later", () => {
  const noted = show({ status: "in_progress", seasonProgress: [10, 2, 0], trakt: { sent: { seasons: [10, 1, 0] }, problem: "Some episodes weren't found on Trakt" } });
  assert.deepEqual(pendingChanges([noted], OPTS)[0].episodes, [[2, 2, 2]]);
});

test("sends are split by titles and episodes", () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ ...pendingChange(movie({ id: `m${i}`, status: "done", done: true }), OPTS) }));
  assert.deepEqual(batches(many).map((b) => b.length), [50, 50, 20]);
  const big = [{ episodes: [[1, 1, 900]] }, { episodes: [[1, 1, 200]] }, { episodes: [[1, 1, 5]] }];
  assert.deepEqual(batches(big).map((b) => b.length), [1, 2]);
});

test("bodies: real dates when just watched, air dates for a catch-up", () => {
  const changes = [
    pendingChange(movie({ status: "done", done: true, myRating: 8, doneAt: Date.UTC(2024, 0, 2) }), OPTS),
    pendingChange(show({ status: "in_progress", seasonProgress: [2] }), OPTS),
  ];
  const live = buildBodies(changes, "now", NOW);
  assert.equal(live.history.movies[0].watched_at, "2026-11-15T12:00:00.000Z");
  assert.deepEqual(live.history.movies[0].ids, { tmdb: 949, imdb: "tt0113277" });
  assert.deepEqual(live.history.shows[0].seasons, [{ number: 1, episodes: [{ number: 1, watched_at: "2026-11-15T12:00:00.000Z" }, { number: 2, watched_at: "2026-11-15T12:00:00.000Z" }] }]);
  assert.deepEqual(live.ratings.movies[0], { ids: { tmdb: 949, imdb: "tt0113277" }, rating: 8, rated_at: "2026-11-15T12:00:00.000Z" });
  assert.equal(live.watchlist, undefined);
  const catchup = buildBodies(changes, "catchup", NOW);
  assert.equal(catchup.history.movies[0].watched_at, "2024-01-02T00:00:00.000Z");
  assert.equal(catchup.history.shows[0].seasons[0].episodes[0].watched_at, "released");
});

test("Trakt's not-found answer is mapped back to titles", () => {
  const keys = notFoundIn({ not_found: { movies: [{ ids: { tmdb: 949 } }], shows: [{ ids: { tmdb: 1 } }], episodes: [] } });
  assert.deepEqual([...keys].sort(), ["movie:949", "show:1"]);
  assert.equal(changeKey({ kind: "movie", ids: { tmdb: 949 } }), "movie:949");
  assert.equal(notFoundIn(null).size, 0);
});

test("what is already on Trakt counts as sent, so the first sync adds no second plays", () => {
  const items = [
    movie({ status: "done", done: true }),
    show({ status: "in_progress", seasonProgress: [10, 5, 0] }),
    show({ id: "s2", tmdb: { id: 2, kind: "tv", genres: [], fetchedAt: 1, seasonEpisodes: [10, 8] }, status: "in_progress", seasonProgress: [10, 8] }),
  ];
  const watchedMovies = [{ movie: { ids: { tmdb: 949 } } }];
  const ep = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1 }));
  const watchedShows = [
    { show: { ids: { tmdb: 70523 } }, seasons: [{ number: 1, episodes: ep(10) }, { number: 2, episodes: ep(2) }] },
    // Numbered differently on Trakt, but with at least as many episodes: taken as up to date.
    { show: { ids: { tmdb: 2 } }, seasons: [{ number: 1, episodes: ep(18) }] },
  ];
  const seed = seedFromWatched(items, watchedMovies, watchedShows, OPTS);
  assert.equal(seed.get("m").movie, true);
  assert.deepEqual(seed.get("s").seasons, [10, 2, 0]);
  assert.deepEqual(seed.get("s2").seasons, [10, 8]);
  const after = items.map((i) => ({ ...i, trakt: { sent: seed.get(i.id) } }));
  assert.deepEqual(pendingChanges(after, OPTS).map((c) => [c.id, c.episodes]), [["s", [[2, 3, 5]]]]);
});

test("ratings already on Trakt are read by TMDB and IMDb id", () => {
  const r = ratingsFrom([{ rating: 8, movie: { ids: { tmdb: 949, imdb: "tt0113277" } } }, { rating: 0, movie: { ids: { tmdb: 1 } } }], [{ rating: 7, show: { ids: { tmdb: 70523 } } }], null);
  assert.equal(r.get("movie:tmdb:949"), 8);
  assert.equal(r.get("movie:imdb:tt0113277"), 8);
  assert.equal(r.get("show:tmdb:70523"), 7);
  assert.equal(r.has("movie:tmdb:1"), false);
  assert.equal(ratingsFrom("junk", undefined).size, 0);
});

test("on the first send a title rated on Trakt keeps Trakt's rating; unrated titles get the shelf's", () => {
  const items = [movie({ myRating: 6 }), show({ myRating: 9 }), movie({ id: "m2", title: "Other", tmdb: { id: 5, kind: "movie", genres: [], fetchedAt: 1 }, myRating: 7 })];
  const sent = new Map();
  const kept = keepTraktRatings(items, sent, new Map([["movie:imdb:tt0113277", 8], ["show:tmdb:70523", 9]]));
  assert.deepEqual(kept.map((k) => [k.title, k.trakt, k.yours]), [["Heat", 8, 6]]);
  const after = items.map((i) => ({ ...i, trakt: { sent: sent.get(i.id) } }));
  const changes = pendingChanges(after, OPTS);
  assert.deepEqual(changes.map((c) => [c.title, c.rating]), [["Other", 7]]);
  // A later change on the shelf is sent as usual.
  assert.equal(pendingChange({ ...after[0], myRating: 10 }, OPTS).rating, 10);
});

test("a preview describes each title in words and totals it up", () => {
  const changes = [
    pendingChange(movie({ status: "done", done: true, myRating: 8 }), OPTS),
    pendingChange(show({ status: "in_progress", seasonProgress: [10, 3, 0] }), OPTS),
    pendingChange(movie({ id: "w", status: "plan" }), { watchlist: true }),
  ];
  assert.deepEqual(describeChange(changes[0]), ["watched", "rating 8"]);
  assert.deepEqual(describeChange(changes[1]), ["S1 E1–10, S2 E1–3 (13 episodes)"]);
  assert.deepEqual(describeChange(changes[2]), ["added to watchlist"]);
  assert.deepEqual(describeChange({ ...changes[0], movie: false, rating: null }), ["rating removed"]);
  const p = buildPreview(changes, []);
  assert.deepEqual([p.movies, p.episodes, p.ratings, p.watchlist, p.rows.length], [1, 13, 1, 1, 3]);
});

test("a show's progress page gives its watched episodes, season by season", () => {
  const answer = { aired: 26, completed: 12, seasons: [
    { number: 1, episodes: [{ number: 1, completed: true }, { number: 2, completed: true }, { number: 3, completed: false }] },
    { number: 2, episodes: [{ number: 1, completed: false }] },
    { number: 0, episodes: [{ number: 1, completed: true }] },
  ] };
  assert.deepEqual(seasonsFromProgress(answer), [{ number: 1, episodes: [{ number: 1 }, { number: 2 }] }, { number: 2, episodes: [] }]);
  assert.deepEqual(seasonsFromProgress(null), []);
  // Fed back as a watched-list entry, the first send sees those episodes as already on Trakt.
  const seed = seedFromWatched([show({ status: "in_progress", seasonProgress: [3, 0, 0] })], [], [{ show: { ids: { tmdb: 70523 } }, seasons: seasonsFromProgress(answer) }], OPTS);
  assert.deepEqual(seed.get("s").seasons, [2, 0, 0]);
});

test("shows are asked about by Trakt id or slug", () => {
  assert.equal(traktShowId({ show: { ids: { trakt: 1388, slug: "breaking-bad" } } }), "1388");
  assert.equal(traktShowId({ show: { ids: { slug: "breaking-bad" } } }), "breaking-bad");
  assert.equal(traktShowId({ show: { ids: { slug: "../evil" } } }), undefined);
  assert.equal(entryTmdb({ show: { ids: { tmdb: 1396 } } }), 1396);
});

import { reseedIds, traktBadge } from "../dist-test/trakt-sync.js";

test("a title's Trakt badge says where it stands", () => {
  const link = { connected: true, ready: true, watchlist: false };
  assert.equal(traktBadge(movie({ status: "done", done: true }), { ...link, connected: false }), undefined, "nothing when not connected");
  assert.equal(traktBadge({ ...movie(), type: "book" }, link), undefined);
  assert.equal(traktBadge({ ...movie(), tmdb: undefined }, link).state, "no-info");
  assert.equal(traktBadge(movie({ status: "done", done: true, trakt: { problem: "Not found on Trakt", sent: { movie: true } } }), link).state, "problem");
  assert.equal(traktBadge(movie({ status: "done", done: true }), link).state, "waiting");
  assert.equal(traktBadge(movie({ status: "done", done: true, trakt: { sent: { movie: true } } }), link).state, "synced");
  assert.equal(traktBadge(movie({ status: "done", done: true, trakt: { sent: { movie: true } } }), { ...link, ready: false }).state, "waiting", "before the first send");
  assert.equal(traktBadge(movie({ status: "done", done: true, trakt: { reseed: true } }), link).state, "waiting", "a new match is checked first");
  assert.equal(traktBadge(movie({ status: "plan" }), link), undefined, "nothing to send yet");
});

test("re-matched titles are the ones read again", () => {
  assert.deepEqual([...reseedIds([movie({ trakt: { reseed: true } }), show()])], [949]);
});
