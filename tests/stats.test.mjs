import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats } from "../dist-test/stats.js";

const base = { subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1 };
const NOW = Date.UTC(2026, 10, 15);

test("counts types, statuses, genres, tags and ratings", () => {
  const items = [
    { ...base, id: "1", title: "A", type: "movie", genre: "Drama, Sci-Fi", status: "done", done: true, doneAt: Date.UTC(2026, 10, 2), myRating: 8, tags: ["x"] },
    { ...base, id: "2", title: "B", type: "movie", genre: "drama", myRating: 6, tags: ["x", "y"] },
    { ...base, id: "3", title: "C", type: "book", done: true, doneAt: Date.UTC(2026, 8, 20) },
    { ...base, id: "4", title: "D", type: "link", url: "https://x.com" },
  ];
  const s = computeStats(items, NOW);
  assert.equal(s.total, 4);
  assert.deepEqual(s.byType, { movie: 2, book: 1, link: 1 });
  assert.deepEqual(s.byStatus, { plan: 2, in_progress: 0, done: 2, dropped: 0 });
  assert.deepEqual(s.topGenres[0], { name: "Drama", count: 2 });
  assert.deepEqual(s.topTags[0], { name: "x", count: 2 });
  assert.equal(s.rating.average, 7);
  assert.equal(s.rating.byType.movie, 7);
  assert.equal(s.rating.distribution[7], 1);
  assert.equal(s.completionRate, 67);
});

test("finishedPerMonth covers the last 12 months with zero fill", () => {
  const items = [
    { ...base, id: "1", title: "A", type: "movie", done: true, doneAt: Date.UTC(2026, 10, 2) },
    { ...base, id: "2", title: "B", type: "movie", done: true, doneAt: Date.UTC(2026, 10, 9) },
    { ...base, id: "3", title: "C", type: "movie", done: true, doneAt: Date.UTC(2024, 0, 1) },
  ];
  const months = computeStats(items, NOW).finishedPerMonth;
  assert.equal(months.length, 12);
  assert.deepEqual(months[0], { month: "2025-12", count: 0 });
  assert.deepEqual(months[11], { month: "2026-11", count: 2 });
});

test("empty shelf has no averages", () => {
  const s = computeStats([], NOW);
  assert.equal(s.rating.average, undefined);
  assert.equal(s.completionRate, undefined);
});
