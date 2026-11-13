import { test } from "node:test";
import assert from "node:assert/strict";
import { newSeasonEntries, newSeasonOf } from "../dist-test/new-seasons.js";

// 10 Nov 2026.
const NOW = new Date(2026, 10, 10, 15, 30).getTime();
const iso = (offset) => {
  const d = new Date(2026, 10, 10 + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const series = (id, tmdb, extra = {}) => ({
  id, title: id, type: "series", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1,
  status: "done", done: true, seasonsAtFinish: 2,
  tmdb: { id: 1, kind: "tv", genres: [], fetchedAt: NOW, status: "Returning Series", ...tmdb },
  ...extra,
});

test("a season that is already out is listed, with its number", () => {
  const e = newSeasonOf(series("a", { seasons: 3 }), NOW);
  assert.deepEqual(e.out, [3]);
  assert.equal(e.label, "S3 out now");
  assert.equal(e.watched, 2);
  const two = newSeasonOf(series("b", { seasons: 4 }), NOW);
  assert.equal(two.label, "S3–S4 out now");
});

test("a season being released now says airing", () => {
  const e = newSeasonOf(series("a", { seasons: 3, nextEpisode: { airDate: iso(5), season: 3, episode: 4 } }), NOW);
  assert.equal(e.label, "S3 airing now");
  assert.equal(e.airing, true);
});

test("a premiere date is shown, and TMDB's own count does not make it 'out'", () => {
  const e = newSeasonOf(series("a", { seasons: 3, nextEpisode: { airDate: iso(30), season: 3, episode: 1 } }), NOW);
  assert.deepEqual(e.out, []);
  assert.equal(e.premiere.season, 3);
  assert.match(e.label, /^S3 on \d+ \w{3}$/);
});

test("a premiere that has passed counts as out", () => {
  const e = newSeasonOf(series("a", { seasons: 3, nextEpisode: { airDate: iso(-2), season: 3, episode: 1 } }), NOW);
  assert.equal(e.premiere, undefined);
  assert.equal(e.label, "S3 out now");
});

test("a season with no date is announced", () => {
  assert.equal(newSeasonOf(series("a", { seasons: 3 }, { seasonsAtFinish: 3 }), NOW), undefined);
  const beyond = newSeasonOf(series("b", { seasons: 4, nextEpisode: { airDate: iso(40), season: 3, episode: 1 } }), NOW);
  assert.deepEqual(beyond.announced, [4]);
  const only = newSeasonOf(series("c", { seasons: 3, status: "Returning Series" }, { seasonsAtFinish: 2, tmdb: { id: 1, kind: "tv", genres: [], fetchedAt: NOW, seasons: 3, nextEpisode: { airDate: iso(100), season: 3, episode: 1 } } }), NOW);
  assert.equal(only.premiere.season, 3);
});

test("nothing is claimed without the season count from when it was finished", () => {
  assert.equal(newSeasonOf(series("a", { seasons: 5 }, { seasonsAtFinish: undefined }), NOW), undefined);
});

test("only finished series with TMDB info count", () => {
  assert.equal(newSeasonOf(series("a", { seasons: 3 }, { status: "in_progress", done: false }), NOW), undefined);
  assert.equal(newSeasonOf(series("a", { seasons: 3 }, { status: "dropped", done: false }), NOW), undefined);
  assert.equal(newSeasonOf(series("a", { seasons: 3, kind: "movie" }), NOW), undefined);
  assert.equal(newSeasonOf({ ...series("a", {}), tmdb: undefined }, NOW), undefined);
});

test("a show with no new season is not listed", () => {
  assert.equal(newSeasonOf(series("a", { seasons: 2, status: "Ended" }), NOW), undefined);
});

test("out now comes first, then the nearest premiere, then announcements", () => {
  const list = newSeasonEntries([
    series("c-announced", { seasons: 4, nextEpisode: { airDate: iso(90), season: 4, episode: 1 } }, { seasonsAtFinish: 3 }),
    series("b-soon", { seasons: 3, nextEpisode: { airDate: iso(10), season: 3, episode: 1 } }),
    series("a-out", { seasons: 3 }),
    series("d-later", { seasons: 3, nextEpisode: { airDate: iso(60), season: 3, episode: 1 } }),
  ], NOW);
  assert.deepEqual(list.map((e) => e.item.id), ["a-out", "b-soon", "d-later", "c-announced"]);
});
