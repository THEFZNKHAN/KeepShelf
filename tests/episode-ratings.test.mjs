import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RATING_BANDS, buildGrid, collectSeasons, describeCell, episodeCode, formatRating, hasAnyRating, isFresh, longDate,
  ratingBand, sanitizeRatings, sanitizeSeason,
} from "../dist-test/episode-ratings.js";

const ep = (episode, vote_average, vote_count = 100, extra = {}) => ({ episode_number: episode, name: `Ep ${episode}`, vote_average, vote_count, ...extra });
const season = (n, ...episodes) => ({ season_number: n, episodes });

test("ratingBand uses the seriesgraph tiers at every edge", () => {
  const at = (r) => ratingBand(r);
  assert.equal(at(10), "absolute");
  assert.equal(at(9.7), "absolute");
  assert.equal(at(9.6), "awesome");
  assert.equal(at(9), "awesome");
  assert.equal(at(8.9), "great");
  assert.equal(at(8), "great");
  assert.equal(at(7.9), "good");
  assert.equal(at(7), "good");
  assert.equal(at(6.9), "average");
  assert.equal(at(6), "average");
  assert.equal(at(5.9), "bad");
  assert.equal(at(4), "bad");
  assert.equal(at(3.9), "garbage");
  assert.equal(at(0.1), "garbage");
  assert.deepEqual(RATING_BANDS.map((b) => b.band), ["absolute", "awesome", "great", "good", "average", "bad", "garbage"]);
});

test("ratingBand says none for anything that is not a real rating", () => {
  for (const v of [undefined, 0, -1, NaN, Infinity, "8", null]) assert.equal(ratingBand(v), "none", String(v));
});

test("sanitizeSeason keeps a rating with votes, rounds it, and treats zero votes as unrated", () => {
  const s = sanitizeSeason(season(2, ep(1, 8.64, 1203, { air_date: "2017-03-12" }), ep(2, 0, 0), ep(3, 7.5, 0), ep(4, 8, 12)));
  assert.equal(s.season, 2);
  assert.deepEqual(s.episodes[0], { episode: 1, name: "Ep 1", rating: 8.6, votes: 1203, airDate: "2017-03-12" });
  assert.deepEqual(s.episodes[1], { episode: 2, name: "Ep 2" });
  assert.deepEqual(s.episodes[2], { episode: 3, name: "Ep 3" }, "a rating with no votes is not trusted");
  assert.deepEqual(s.episodes[3], { episode: 4, name: "Ep 4", rating: 8, votes: 12 });
});

test("sanitizeSeason drops junk: bad shapes, duplicate and out-of-range episodes, odd dates and names", () => {
  assert.equal(sanitizeSeason(null), undefined);
  assert.equal(sanitizeSeason("x"), undefined);
  assert.equal(sanitizeSeason({ season_number: 0, episodes: [] }), undefined, "specials are not shown");
  assert.equal(sanitizeSeason({ season_number: 1 }), undefined);
  assert.equal(sanitizeSeason({ episodes: [] }), undefined, "no season number");
  assert.equal(sanitizeSeason({ episodes: [] }, 3).season, 3, "falls back to the season it was asked for");
  const s = sanitizeSeason(season(1,
    ep(1, 8, 10), ep(1, 9, 10), ep(0, 8, 10), ep(1.5, 8, 10), ep(9999, 8, 10), null, "x",
    { episode_number: 2, name: "bad\u0000name\n" + "x".repeat(300), vote_average: 11, vote_count: 5, air_date: "soon" },
    { episode_number: 3, name: 5, vote_average: "8", vote_count: "5" }));
  assert.deepEqual(s.episodes.map((e) => e.episode), [1, 2, 3]);
  assert.equal(s.episodes[0].rating, 8, "first duplicate wins");
  assert.equal(s.episodes[1].rating, 10, "capped at 10");
  assert.equal(s.episodes[1].airDate, undefined);
  assert.ok(s.episodes[1].name.length <= 200 && !/[\u0000\n]/.test(s.episodes[1].name));
  assert.deepEqual(s.episodes[2], { episode: 3, name: "" });
});

test("sanitizeSeason caps the number of episodes", () => {
  const many = Array.from({ length: 500 }, (_, i) => ep(i + 1, 8, 5));
  assert.equal(sanitizeSeason(season(1, ...many)).episodes.length, 300);
});

test("collectSeasons orders seasons, drops junk and keeps the first of a duplicate", () => {
  const out = collectSeasons([season(3, ep(1, 8)), null, season(1, ep(1, 9)), { season_number: 0, episodes: [] }, season(3, ep(1, 5))]);
  assert.deepEqual(out.map((s) => s.season), [1, 3]);
  assert.equal(out[1].episodes[0].rating, 8);
});

test("ratings survive being saved and read back from the cache unchanged", () => {
  const original = {
    fetchedAt: 123,
    seasons: [
      { season: 1, episodes: [{ episode: 1, name: "Pilot", rating: 8.2, votes: 1203, airDate: "2017-03-12" }, { episode: 2, name: "No votes yet" }] },
      { season: 3, episodes: [{ episode: 1, name: "Back", rating: 9.7, votes: 50 }] },
    ],
  };
  const stored = JSON.parse(JSON.stringify(original));
  assert.deepEqual(sanitizeRatings(stored), original, "this is what the second open of a card reads");
  // And what the fetch actually produces, end to end.
  const fetched = { fetchedAt: 5, seasons: collectSeasons([season(1, ep(1, 8.64, 12, { air_date: "2020-01-02" }), ep(2, 0, 0)), season(2, ep(1, 7, 3))]) };
  assert.deepEqual(sanitizeRatings(JSON.parse(JSON.stringify(fetched))), fetched);
});

test("sanitizeRatings checks what comes back from the cache", () => {
  assert.equal(sanitizeRatings(undefined), undefined);
  assert.equal(sanitizeRatings(null), undefined);
  assert.equal(sanitizeRatings({ fetchedAt: "now", seasons: [] }), undefined);
  assert.equal(sanitizeRatings({ fetchedAt: 5, seasons: "x" }), undefined);
  assert.equal(sanitizeRatings({ fetchedAt: 5, seasons: [] }), undefined, "nothing in it: fetch again rather than show an empty grid");
  assert.equal(sanitizeRatings({ fetchedAt: 5, seasons: [{ season: 0, episodes: [] }, null, "x", { episodes: [] }] }), undefined);
  const messy = sanitizeRatings({
    fetchedAt: 5,
    seasons: [
      { season: 2, episodes: [{ episode: 1, name: "ok", rating: 8, votes: 3 }, { episode: 1, name: "dup" }, { episode: 0 }, { episode: 2, name: "bad\u0000", rating: 99, votes: -4, airDate: "soon" }, null] },
      { season: 1, episodes: [{ episode: 1, name: "first season", rating: "8" }] },
      { season: 1, episodes: [{ episode: 9, name: "duplicate season" }] },
    ],
  });
  assert.deepEqual(messy.seasons.map((s) => s.season), [1, 2], "ordered, first duplicate kept");
  assert.deepEqual(messy.seasons[0].episodes, [{ episode: 1, name: "first season" }], "a rating that is not a number is dropped");
  assert.deepEqual(messy.seasons[1].episodes.map((e) => e.name), ["ok", "bad"]);
  assert.equal(messy.seasons[1].episodes[1].rating, undefined, "out-of-range rating dropped");
  assert.equal(messy.seasons[1].episodes[1].votes, undefined);
  assert.equal(messy.seasons[1].episodes[1].airDate, undefined);
});

test("isFresh is true inside the window only, and never for the future or nothing", () => {
  const e = { fetchedAt: 1000 };
  assert.equal(isFresh(e, 1000), true);
  assert.equal(isFresh(e, 1000 + 24 * 3600 * 1000 - 1), true);
  assert.equal(isFresh(e, 1000 + 24 * 3600 * 1000), false);
  assert.equal(isFresh(e, 999), false, "clock went backwards");
  assert.equal(isFresh(undefined, 1000), false);
  assert.equal(isFresh(e, 1500, 400), false);
});

const sample = () => ({
  fetchedAt: 1,
  seasons: [
    { season: 1, episodes: [{ episode: 1, name: "A", rating: 8.2, votes: 10 }, { episode: 2, name: "B", rating: 9.1, votes: 10 }, { episode: 3, name: "C" }] },
    { season: 2, episodes: [{ episode: 1, name: "D", rating: 7, votes: 5 }] },
    { season: 4, episodes: [{ episode: 1, name: "E", rating: 5.8, votes: 5 }, { episode: 2, name: "F", rating: 9.7, votes: 5 }] },
  ],
});

test("buildGrid lays out seasons as columns and episodes as rows, with gaps where a season is shorter", () => {
  const g = buildGrid(sample());
  assert.deepEqual(g.seasons, [1, 2, 4], "season numbers are kept, so a missing season 3 does not shift the labels");
  assert.equal(g.rows, 3);
  assert.equal(g.cells.length, 3);
  assert.equal(g.cells[0][0].name, "A");
  assert.equal(g.cells[0][1].name, "D");
  assert.equal(g.cells[1][1], undefined);
  assert.equal(g.cells[2][2], undefined);
  assert.equal(g.cells[2][0].rating, undefined);
  assert.equal(g.cells[2][0].band, "none");
  assert.equal(g.cells[1][2].band, "absolute");
  assert.equal(g.cells[0][2].band, "bad");
});

test("buildGrid works out averages, best, lowest and counts", () => {
  const g = buildGrid(sample());
  assert.deepEqual(g.seasonAverages, [8.7, 7, 7.8]);
  assert.equal(g.average, 8, "39.8 / 5 = 7.96");
  assert.equal(episodeCode(g.best), "S4 E2");
  assert.equal(episodeCode(g.lowest), "S4 E1");
  assert.equal(g.rated, 5);
  assert.equal(g.total, 6);
  assert.equal(hasAnyRating(g), true);
});

test("buildGrid copes with nothing rated and with nothing at all", () => {
  const none = buildGrid({ fetchedAt: 1, seasons: [{ season: 1, episodes: [{ episode: 1, name: "A" }] }] });
  assert.equal(none.average, undefined);
  assert.equal(none.best, undefined);
  assert.deepEqual(none.seasonAverages, [undefined]);
  assert.equal(hasAnyRating(none), false);
  const empty = buildGrid({ fetchedAt: 1, seasons: [] });
  assert.equal(empty.rows, 0);
  assert.deepEqual(empty.cells, []);
  assert.equal(hasAnyRating(empty), false);
});

test("buildGrid handles a Supernatural-sized show", () => {
  const seasons = Array.from({ length: 15 }, (_, s) => ({
    season: s + 1,
    episodes: Array.from({ length: s === 14 ? 20 : 22 + (s % 2) }, (_, e) => ({ episode: e + 1, name: `E${e + 1}`, rating: 7 + ((s + e) % 25) / 10, votes: 50 })),
  }));
  const g = buildGrid({ fetchedAt: 1, seasons });
  assert.equal(g.seasons.length, 15);
  assert.equal(g.rows, 23);
  assert.equal(g.cells[22][14], undefined);
  assert.equal(g.cells[22][1].name, "E23");
  assert.equal(g.total, seasons.reduce((n, s) => n + s.episodes.length, 0));
});

test("formatting helpers", () => {
  assert.equal(formatRating(8), "8.0");
  assert.equal(formatRating(8.66), "8.7");
  assert.equal(formatRating(undefined), "–");
  assert.equal(longDate("2017-03-12"), "12 Mar 2017");
  assert.equal(longDate("2017-12-01"), "1 Dec 2017");
  assert.equal(longDate("nope"), "");
  assert.equal(longDate(undefined), "");
  assert.equal(episodeCode({ season: 2, episode: 5 }), "S2 E5");
});

test("describeCell is one readable line", () => {
  assert.equal(describeCell({ season: 2, episode: 5, name: "Title", rating: 8.6, votes: 1203, airDate: "2017-03-12", band: "great" }), "S2 E5 · Title · 8.6 (1,203 votes) · 12 Mar 2017");
  assert.equal(describeCell({ season: 1, episode: 1, name: "", band: "none" }), "S1 E1 · not rated yet");
  assert.equal(describeCell({ season: 1, episode: 1, name: "X", rating: 7, band: "good" }), "S1 E1 · X · 7.0");
});
