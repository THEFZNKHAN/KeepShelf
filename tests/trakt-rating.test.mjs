import { test } from "node:test";
import assert from "node:assert/strict";
import { RATING_FRESH_MS, parseTraktRating, ratingPath, ratingText, sanitizeCachedRating, traktIdFromSearch } from "../dist-test/trakt-rating.js";

test("Trakt's rating is shown as a percentage, and only with votes behind it", () => {
  assert.deepEqual(parseTraktRating({ rating: 8.4123, votes: 2500, distribution: {} }), { percent: 84, votes: 2500 });
  assert.equal(ratingText({ percent: 84, votes: 2500 }), "Trakt 84%");
  assert.equal(parseTraktRating({ rating: 8, votes: 0 }), undefined);
  assert.equal(parseTraktRating({ rating: 0, votes: 10 }), undefined);
  assert.equal(parseTraktRating({ rating: 11, votes: 10 }), undefined);
  assert.equal(parseTraktRating(null), undefined);
});

test("titles are asked about by IMDb id, or by the Trakt id found from TMDB's", () => {
  assert.equal(ratingPath("movie", "tt0113277"), "/movies/tt0113277/ratings");
  assert.equal(ratingPath("tv", "1388"), "/shows/1388/ratings");
  assert.equal(ratingPath("tv", "../x"), "/shows/..%2Fx/ratings");
  const search = [{ type: "show", show: { title: "Dark", ids: { trakt: 120, tmdb: 70523 } } }];
  assert.equal(traktIdFromSearch(search, "tv"), "120");
  assert.equal(traktIdFromSearch(search, "movie"), undefined);
  assert.equal(traktIdFromSearch("junk", "tv"), undefined);
});

test("a cached rating is used for a day, then fetched again", () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(sanitizeCachedRating({ at: now - 1000, rating: { percent: 84, votes: 10 } }, now), { rating: { percent: 84, votes: 10 } });
  assert.deepEqual(sanitizeCachedRating({ at: now - 1000, rating: null }, now), { rating: null });
  assert.equal(sanitizeCachedRating({ at: now - RATING_FRESH_MS - 1, rating: null }, now), undefined);
  assert.equal(sanitizeCachedRating({ at: now + 5000, rating: null }, now), undefined);
  assert.equal(sanitizeCachedRating({ at: now, rating: { percent: "x" } }, now), undefined);
});
