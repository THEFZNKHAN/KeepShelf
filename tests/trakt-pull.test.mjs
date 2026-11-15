import { test } from "node:test";
import assert from "node:assert/strict";
import { describePull, findItemFor, itemForAddition, mapSeasons, parseTraktLibrary, planPull } from "../dist-test/trakt-pull.js";
import { pendingChanges } from "../dist-test/trakt-sync.js";

const NOW = Date.UTC(2026, 10, 16);
const ep = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1 }));
const movie = (extra = {}) => ({
  id: "m", title: "Heat", type: "movie", year: "1995", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1,
  tmdb: { id: 949, kind: "movie", genres: [], fetchedAt: 1, imdbId: "tt0113277" }, ...extra,
});
const show = (extra = {}) => ({
  id: "s", title: "Dark", type: "series", year: "2017", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1,
  tmdb: { id: 70523, kind: "tv", genres: [], fetchedAt: 1, seasons: 3, seasonEpisodes: [10, 8, 8] }, ...extra,
});

const library = (over = {}) => parseTraktLibrary({
  watchedMovies: [{ movie: { title: "Heat", year: 1995, ids: { tmdb: 949, imdb: "tt0113277" } }, last_watched_at: "2024-03-01T20:00:00.000Z" }],
  watchedShows: [{ show: { title: "Dark", year: 2017, ids: { tmdb: 70523 }, aired_episodes: 26 }, seasons: [{ number: 1, episodes: ep(10) }, { number: 2, episodes: ep(4) }] }],
  ratedMovies: [{ rating: 8, movie: { title: "Heat", year: 1995, ids: { tmdb: 949 } } }],
  ratedShows: [],
  watchlistMovies: [{ movie: { title: "Inception", year: 2010, ids: { tmdb: 27205 } } }],
  watchlistShows: [{ show: { title: "Frieren", year: 2023, ids: { tmdb: 209867 }, genres: ["anime", "animation"] } }],
  ...over,
});

test("Trakt's lists become one entry per title", () => {
  const lib = library();
  const heat = lib.find((t) => t.title === "Heat");
  assert.equal(heat.watched, true);
  assert.equal(heat.rating, 8);
  const dark = lib.find((t) => t.title === "Dark");
  assert.deepEqual(dark.seasons, [10, 4]);
  assert.equal(dark.episodes, 14);
  assert.equal(dark.aired, 26);
  assert.equal(lib.find((t) => t.title === "Frieren").anime, true);
  assert.equal(lib.find((t) => t.title === "Inception").watchlist, true);
  assert.deepEqual(parseTraktLibrary({ watchedMovies: "junk", watchedShows: [{ show: {} }] }), []);
});

test("titles are matched by TMDB id, then IMDb id, then name and year", () => {
  const [heat] = library();
  assert.equal(findItemFor(heat, [movie()])?.id, "m");
  assert.equal(findItemFor({ ...heat, tmdb: undefined }, [movie()])?.id, "m");
  assert.equal(findItemFor({ ...heat, tmdb: undefined, imdb: undefined }, [movie({ tmdb: undefined })])?.id, "m");
  assert.equal(findItemFor({ ...heat, tmdb: undefined, imdb: undefined, year: 2009 }, [movie({ tmdb: undefined })]), undefined);
  // A movie never matches a series of the same name.
  assert.equal(findItemFor({ kind: "movie", title: "Dark", anime: false }, [show({ tmdb: undefined })]), undefined);
});

test("Trakt's seasons are placed season by season when they fit, else counted from the start", () => {
  assert.deepEqual(mapSeasons([10, 4], 14, [10, 8, 8]), [10, 4, 0]);
  // One long Trakt season on a show TMDB splits: counted from episode 1.
  assert.deepEqual(mapSeasons([25], 25, [10, 8, 8]), [10, 8, 7]);
});

test("watched on Trakt marks a movie watched here, and fills a missing rating", () => {
  const plan = planPull([movie({ status: "plan" })], library(), NOW);
  const u = plan.updates.find((x) => x.id === "m");
  assert.equal(u.patch.status, "done");
  assert.equal(u.patch.doneAt, Date.parse("2024-03-01T20:00:00.000Z"));
  assert.equal(u.patch.myRating, 8);
  assert.deepEqual(u.parts, ["marked watched", "rating 8 from Trakt"]);
});

test("your own rating is kept", () => {
  const u = planPull([movie({ status: "done", done: true, myRating: 6 })], library(), NOW).updates.find((x) => x.id === "m");
  assert.equal(u?.patch.myRating, undefined);
  assert.equal(u.patch.trakt.sent.rating, 6);
});

test("progress only moves forward", () => {
  const ahead = planPull([show({ status: "in_progress", seasonProgress: [10, 2, 0] })], library(), NOW).updates[0];
  assert.deepEqual(ahead.patch.seasonProgress, [10, 4, 0]);
  assert.deepEqual(ahead.parts, ["2 episodes more watched (next: S2 E5)"]);
  const behind = planPull([show({ status: "in_progress", seasonProgress: [10, 6, 0] })], library(), NOW).updates.find((x) => x.id === "s");
  assert.equal(behind?.patch.seasonProgress, undefined);
});

test("a show watched to the end on Trakt is finished here; a newer season started there reopens it", () => {
  const all = library({ watchedShows: [{ show: { title: "Dark", year: 2017, ids: { tmdb: 70523 } }, seasons: [{ number: 1, episodes: ep(10) }, { number: 2, episodes: ep(8) }, { number: 3, episodes: ep(8) }] }] });
  const done = planPull([show({ status: "in_progress", seasonProgress: [10, 8, 2] })], all, NOW).updates[0];
  assert.equal(done.patch.status, "done");
  assert.ok(done.parts.includes("finished"));
  const finishedHere = show({ status: "done", done: true, seasonsAtFinish: 1, tmdb: { ...show().tmdb } });
  const reopened = planPull([finishedHere], library(), NOW).updates[0];
  assert.equal(reopened.patch.status, "in_progress");
});

test("what comes from Trakt is recorded as sent, so nothing is sent back", () => {
  const items = [movie({ status: "plan" }), show({ status: "in_progress", seasonProgress: [10, 2, 0] })];
  const plan = planPull(items, library(), NOW);
  const after = items.map((i) => ({ ...i, ...(plan.updates.find((u) => u.id === i.id)?.patch ?? {}) }));
  assert.deepEqual(pendingChanges(after, { watchlist: false }), []);
  // Episodes watched here beyond Trakt's still go.
  const more = after.map((i) => (i.id === "s" ? { ...i, seasonProgress: [10, 6, 0] } : i));
  assert.deepEqual(pendingChanges(more, { watchlist: false }).map((c) => c.episodes), [[[2, 5, 6]]]);
});

test("titles missing from the shelf are added: watched as done, the watchlist as to watch, anime as anime", () => {
  const plan = planPull([], library(), NOW);
  const byTitle = Object.fromEntries(plan.additions.map((a) => [a.title, a]));
  assert.equal(byTitle.Heat.status, "done");
  assert.equal(byTitle.Heat.myRating, 8);
  assert.equal(byTitle.Dark.status, "in_progress");
  assert.equal(byTitle.Dark.episodes, 14);
  assert.equal(byTitle.Inception.status, "plan");
  assert.equal(byTitle.Frieren.type, "anime");
  assert.equal(byTitle.Frieren.status, "plan");
  const words = describePull(plan);
  assert.equal(words.additions.length, 4);
  assert.match(words.additions.find((a) => a.title.startsWith("Dark")).parts.join(" "), /14 episodes watched/);
});

test("an added show gets its episodes on TMDB's seasons, recorded as sent", () => {
  const [dark] = planPull([], library(), NOW).additions.filter((a) => a.title === "Dark");
  const item = itemForAddition(dark, { id: 70523, kind: "tv", genres: [], fetchedAt: NOW, seasons: 3, seasonEpisodes: [10, 8, 8] });
  assert.deepEqual(item.seasonProgress, [10, 4, 0]);
  assert.equal(item.progressCurrent, 14);
  assert.deepEqual(item.trakt.sent.seasons, [10, 4, 0]);
  assert.equal(item.sourceUrl, "https://www.themoviedb.org/tv/70523");
  const bare = itemForAddition(dark, undefined);
  assert.equal(bare.progressCurrent, 14);
  assert.equal(bare.tmdb, undefined);
  assert.deepEqual(pendingChanges([{ ...item, id: "x", savedAt: 1 }], { watchlist: false }), []);
});

test("episodes come from the plain watched list; genres and aired counts from the full one, which has no seasons", () => {
  const lib = parseTraktLibrary({
    watchedShows: [{ show: { title: "Naruto", year: 2002, ids: { tmdb: 46260 } }, seasons: [{ number: 1, episodes: ep(52) }] }],
    watchedShowsInfo: [{ show: { title: "Naruto", year: 2002, ids: { tmdb: 46260 }, genres: ["anime"], aired_episodes: 220 } }],
  });
  assert.equal(lib.length, 1);
  assert.equal(lib[0].episodes, 52);
  assert.equal(lib[0].anime, true);
  assert.equal(lib[0].aired, 220);
  const [naruto] = planPull([], lib, NOW).additions;
  assert.equal(naruto.type, "anime");
  assert.equal(naruto.status, "in_progress");
});
