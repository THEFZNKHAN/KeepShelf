import { test } from "node:test";
import assert from "node:assert/strict";
import {
  distributeProgress, lastWatched, markSeasonDone, mergeSeasonProgress, nextToWatch,
  seasonTotals, statusFromSeasons, sumProgress, validateSeasonProgress,
} from "../dist-test/seasons.js";

const totals = [10, 8, 6];

test("seasonTotals reads TMDB's per-season counts and is undefined without them", () => {
  assert.deepEqual(seasonTotals({ tmdb: { seasonEpisodes: [3, 4] } }), [3, 4]);
  assert.equal(seasonTotals({ tmdb: { seasonEpisodes: [] } }), undefined);
  assert.equal(seasonTotals({ tmdb: {} }), undefined);
  assert.equal(seasonTotals({}), undefined);
});

test("sumProgress adds the seasons up", () => {
  assert.equal(sumProgress([10, 3]), 13);
  assert.equal(sumProgress([]), 0);
  assert.equal(sumProgress(undefined), 0);
});

test("distributeProgress fills seasons in order and never overflows", () => {
  assert.deepEqual(distributeProgress(0, totals), [0, 0, 0]);
  assert.deepEqual(distributeProgress(13, totals), [10, 3, 0]);
  assert.deepEqual(distributeProgress(24, totals), [10, 8, 6]);
  assert.deepEqual(distributeProgress(99, totals), [10, 8, 6]);
  assert.deepEqual(distributeProgress(-5, totals), [0, 0, 0]);
});

test("markSeasonDone fills one season, pads missing ones and ignores bad numbers", () => {
  assert.deepEqual(markSeasonDone([2], totals, 2), [2, 8, 0]);
  assert.deepEqual(markSeasonDone([], totals, 1), [10, 0, 0]);
  assert.deepEqual(markSeasonDone([1, 1, 1], totals, 0), [1, 1, 1]);
  assert.deepEqual(markSeasonDone([1, 1, 1], totals, 4), [1, 1, 1]);
});

test("nextToWatch finds the first unwatched episode, or nothing when all are watched", () => {
  assert.deepEqual(nextToWatch([], totals), { season: 1, episode: 1 });
  assert.deepEqual(nextToWatch([10, 4], totals), { season: 2, episode: 5 });
  assert.deepEqual(nextToWatch([10, 8, 0], totals), { season: 3, episode: 1 });
  assert.equal(nextToWatch([10, 8, 6], totals), undefined);
});

test("lastWatched names the latest season with progress", () => {
  assert.equal(lastWatched([10, 5, 0]), "S2 E5");
  assert.equal(lastWatched([0, 0, 0]), undefined);
  assert.equal(lastWatched([]), undefined);
  assert.equal(lastWatched(undefined), undefined);
  assert.equal(lastWatched([3, 0, 2]), "S3 E2");
});

test("statusFromSeasons: everything watched is done, some is in progress, none leaves the status alone", () => {
  assert.equal(statusFromSeasons([10, 8, 6], totals, "plan"), "done");
  assert.equal(statusFromSeasons([10, 2, 0], totals, "plan"), "in_progress");
  assert.equal(statusFromSeasons([10, 2, 0], totals, "in_progress"), "in_progress");
  assert.equal(statusFromSeasons([10, 2, 0], totals, "dropped"), "dropped");
  // Un-ticking an episode of a finished show reopens it.
  assert.equal(statusFromSeasons([10, 8, 5], totals, "done"), "in_progress");
  assert.equal(statusFromSeasons([0, 0, 0], totals, "plan"), "plan");
  // Without totals it can never be "done".
  assert.equal(statusFromSeasons([5], undefined, "plan"), "in_progress");
});

test("validateSeasonProgress accepts good counts and explains bad ones", () => {
  assert.deepEqual(validateSeasonProgress([10, "3", ""], totals), [10, 3, 0]);
  assert.deepEqual(validateSeasonProgress([99], undefined), [99]);
  assert.throws(() => validateSeasonProgress([11], totals), /Season 1 has 10 episodes, so 11 is too many/);
  assert.throws(() => validateSeasonProgress([0, 9], totals), /Season 2 has 8 episodes/);
  assert.throws(() => validateSeasonProgress([1.5], totals), /Season 1 must be a whole number/);
  assert.throws(() => validateSeasonProgress([-1], totals), /whole number/);
  assert.throws(() => validateSeasonProgress(["x"], totals), /whole number/);
  assert.throws(() => validateSeasonProgress("nope", totals), /list of numbers/);
  assert.throws(() => validateSeasonProgress(new Array(101).fill(0), undefined), /Too many/);
  assert.throws(() => validateSeasonProgress([1], [1]) && validateSeasonProgress([2], [1]), /too many/);
});

test("mergeSeasonProgress takes the best of each season and tolerates different lengths", () => {
  assert.deepEqual(mergeSeasonProgress([[3, 1], [2, 5, 4]]), [3, 5, 4]);
  assert.deepEqual(mergeSeasonProgress([undefined, [1]]), [1]);
  assert.equal(mergeSeasonProgress([undefined, undefined]), undefined);
  assert.equal(mergeSeasonProgress([]), undefined);
});
