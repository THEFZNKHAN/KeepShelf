import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUserPatch, normalizeRating, normalizeTags, sanitizeImportedUserData, shouldAskForRating, statusOf } from "../dist-test/user-data.js";
import { buildBackup, parseImportFile } from "../dist-test/import.js";

test("normalizeTags lowercases, strips #, dedupes and accepts comma strings", () => {
  assert.deepEqual(normalizeTags("#Sci-Fi, sci-fi , Weekend  night,,"), ["sci-fi", "weekend night"]);
  assert.deepEqual(normalizeTags(["A", "a", 3]), ["a"]);
  assert.deepEqual(normalizeTags(undefined), []);
});

test("normalizeRating accepts 1-10 integers, clears on empty, rejects the rest", () => {
  assert.equal(normalizeRating("7"), 7);
  assert.equal(normalizeRating(null), undefined);
  assert.equal(normalizeRating(""), undefined);
  assert.throws(() => normalizeRating(0));
  assert.throws(() => normalizeRating(11));
  assert.throws(() => normalizeRating(7.5));
});

test("status drives done and doneAt", () => {
  const patch = buildUserPatch({ done: false }, { status: "done" }, 1000);
  assert.deepEqual(patch, { status: "done", done: true, doneAt: 1000 });
  const back = buildUserPatch({ done: true, doneAt: 1000, status: "done" }, { status: "in_progress" }, 2000);
  assert.deepEqual(back, { status: "in_progress", done: false, doneAt: undefined });
});

test("legacy done toggle maps onto status", () => {
  assert.equal(statusOf({ done: true }), "done");
  assert.equal(statusOf({}), "plan");
  assert.equal(buildUserPatch({ done: true, doneAt: 5, status: "done" }, { done: false }).status, "plan");
  assert.equal(buildUserPatch({ done: false, status: "in_progress" }, { done: false }).status, "in_progress");
  assert.equal(buildUserPatch({ done: false }, { done: true }, 9).doneAt, 9);
});

test("progress can't exceed total", () => {
  assert.throws(() => buildUserPatch({}, { progressCurrent: 5, progressTotal: 3 }));
  assert.throws(() => buildUserPatch({ progressTotal: 3 }, { progressCurrent: 4 }));
  assert.equal(buildUserPatch({ progressTotal: 10 }, { progressCurrent: 4 }).progressCurrent, 4);
});

test("empty values clear fields", () => {
  const patch = buildUserPatch({}, { tags: [], review: "  ", myRating: null, list: "" });
  assert.equal(patch.tags, undefined);
  assert.equal(patch.review, undefined);
  assert.equal(patch.myRating, undefined);
  assert.equal(patch.list, undefined);
  assert.ok("tags" in patch && "review" in patch);
});

test("import sanitising drops invalid user data", () => {
  const out = sanitizeImportedUserData({ tags: ["X", "x"], myRating: 99, status: "nope", progressCurrent: -1, review: " hi " });
  assert.deepEqual(out, { tags: ["x"], review: "hi" });
});

test("backup round trip keeps personal fields", () => {
  const item = {
    id: "1", title: "Dune", year: "2021", type: "movie", subtitle: "", googleQuery: "Dune", sourceUrl: "",
    savedAt: 1, tags: ["scifi"], list: "Weekend", myRating: 9, review: "Great", status: "in_progress",
    progressCurrent: 1, progressTotal: 2,
  };
  const { items } = parseImportFile(buildBackup([item]), "b.json");
  assert.equal(items[0].myRating, 9);
  assert.deepEqual(items[0].tags, ["scifi"]);
  assert.equal(items[0].status, "in_progress");
  assert.equal(items[0].done, false);
  assert.equal(items[0].list, "Weekend");
  assert.equal(items[0].progressTotal, 2);
});

test("the rating box is offered for things you watch or read, and only when enabled", () => {
  for (const type of ["movie", "series", "anime", "book"]) {
    assert.equal(shouldAskForRating({ type }, true), true, type);
    assert.equal(shouldAskForRating({ type }, false), false, `${type} when off`);
  }
  for (const type of ["tab", "link", "note"]) assert.equal(shouldAskForRating({ type }, true), false, type);
});

const seasonItem = { status: "plan", done: false, tmdb: { id: 1, kind: "tv", genres: [], fetchedAt: 1, seasonEpisodes: [10, 8, 6] } };

test("buildUserPatch stores season progress and keeps the overall count equal to its sum", () => {
  const patch = buildUserPatch(seasonItem, { seasonProgress: [10, 3, 0] });
  assert.deepEqual(patch.seasonProgress, [10, 3, 0]);
  assert.equal(patch.progressCurrent, 13);
  // The sum wins over a stale overall number sent alongside it.
  assert.equal(buildUserPatch(seasonItem, { seasonProgress: [2], progressCurrent: 99 }).progressCurrent, 2);
});

test("buildUserPatch rejects a season above its episode count, and an overall count above the total", () => {
  assert.throws(() => buildUserPatch(seasonItem, { seasonProgress: [11] }), /Season 1 has 10 episodes/);
  assert.throws(() => buildUserPatch({ ...seasonItem, progressTotal: 12 }, { seasonProgress: [10, 3] }), /can't be higher than the total/);
  // Without TMDB data there is nothing to check a season against.
  assert.deepEqual(buildUserPatch({ status: "plan" }, { seasonProgress: [40] }).seasonProgress, [40]);
});

test("buildUserPatch clears season progress with null or an empty list, leaving the overall count alone", () => {
  for (const cleared of [null, []]) {
    const patch = buildUserPatch(seasonItem, { seasonProgress: cleared });
    assert.ok("seasonProgress" in patch);
    assert.equal(patch.seasonProgress, undefined);
    assert.ok(!("progressCurrent" in patch));
  }
  assert.ok(!("seasonProgress" in buildUserPatch(seasonItem, { review: "x" })));
});

test("sanitizeImportedUserData keeps valid season progress and drops invalid lists", () => {
  const ok = sanitizeImportedUserData({ seasonProgress: [4, 2] });
  assert.deepEqual(ok.seasonProgress, [4, 2]);
  assert.equal(ok.progressCurrent, 6);
  for (const bad of [[1, "x"], [-1], [1.5], "5", {}, [], new Array(101).fill(1)]) {
    const out = sanitizeImportedUserData({ seasonProgress: bad });
    assert.equal(out.seasonProgress, undefined, JSON.stringify(bad).slice(0, 30));
  }
});

test("season progress survives a backup round trip, and an old backup without it still loads", () => {
  const base = { id: "a", title: "Show", type: "series", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1 };
  const item = { ...base, status: "in_progress", done: false, progressCurrent: 13, seasonProgress: [10, 3] };
  const back = parseImportFile(buildBackup([item]), "b.json").items;
  assert.deepEqual(back[0].seasonProgress, [10, 3]);
  assert.equal(back[0].progressCurrent, 13);
  const old = parseImportFile(buildBackup([{ ...base, progressCurrent: 5 }]), "b.json").items;
  assert.equal(old[0].seasonProgress, undefined);
  assert.equal(old[0].progressCurrent, 5);
  // A tampered backup can't smuggle in a broken list or a mismatched overall count.
  const tampered = parseImportFile(JSON.stringify({ items: [{ ...base, seasonProgress: [3, -1], progressCurrent: 50 }] }), "b.json").items;
  assert.equal(tampered[0].seasonProgress, undefined);
  assert.equal(tampered[0].progressCurrent, 50);
});

const tvItem = (extra = {}) => ({ status: "in_progress", progressCurrent: 3, tmdb: { id: 1, kind: "tv", genres: [], fetchedAt: 1, seasons: 4 }, ...extra });

test("finishing a series records how many seasons it had, so a later season can be told apart", () => {
  assert.equal(buildUserPatch(tvItem(), { status: "done" }).seasonsAtFinish, 4);
  assert.equal(buildUserPatch(tvItem(), { done: true }).seasonsAtFinish, 4, "marking it watched the old way counts too");
});

test("the season record is left alone while a show stays finished, and made again when it is finished again", () => {
  const finishedBefore = tvItem({ status: "done", done: true, seasonsAtFinish: 2 });
  assert.equal("seasonsAtFinish" in buildUserPatch(finishedBefore, { status: "done" }), false, "already finished: nothing to update");
  assert.equal("seasonsAtFinish" in buildUserPatch(finishedBefore, { myRating: 8 }), false);
  assert.equal(buildUserPatch(tvItem({ seasonsAtFinish: 2 }), { status: "done" }).seasonsAtFinish, 4, "finished again after more seasons: the record moves on");
});

test("finishing a series whose next season is already announced records the seasons before it", () => {
  const announced = tvItem({ tmdb: { id: 1, kind: "tv", genres: [], fetchedAt: 1, seasons: 5, nextEpisode: { airDate: "2027-01-01", season: 5, episode: 1 } } });
  assert.equal(buildUserPatch(announced, { status: "done" }).seasonsAtFinish, 4, "season 5 is the new one, not one you finished");
  const midSeason = tvItem({ tmdb: { id: 1, kind: "tv", genres: [], fetchedAt: 1, seasons: 5, nextEpisode: { airDate: "2027-01-01", season: 5, episode: 4 } } });
  assert.equal(buildUserPatch(midSeason, { status: "done" }).seasonsAtFinish, 5, "season 5 is already airing and counts as seen");
});

test("no season record for things that aren't series, aren't finished, or have no season count", () => {
  assert.equal("seasonsAtFinish" in buildUserPatch(tvItem(), { status: "in_progress" }), false);
  assert.equal("seasonsAtFinish" in buildUserPatch(tvItem({ tmdb: { id: 1, kind: "movie", genres: [], fetchedAt: 1 } }), { status: "done" }), false);
  assert.equal("seasonsAtFinish" in buildUserPatch(tvItem({ tmdb: undefined }), { status: "done" }), false, "no TMDB info");
  assert.equal("seasonsAtFinish" in buildUserPatch(tvItem({ tmdb: { id: 1, kind: "tv", genres: [], fetchedAt: 1 } }), { status: "done" }), false, "no season count known");
});

test("an imported season record is kept only when it is a sensible whole number", () => {
  assert.equal(sanitizeImportedUserData({ seasonsAtFinish: 3 }).seasonsAtFinish, 3);
  for (const bad of [0, -1, 1.5, "3", 1000, null, NaN]) assert.equal("seasonsAtFinish" in sanitizeImportedUserData({ seasonsAtFinish: bad }), false, String(bad));
});

test("a backup keeps the season record, and a damaged one is dropped", () => {
  const item = { id: "a", title: "Show", type: "series", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1, status: "done", seasonsAtFinish: 3 };
  const restored = parseImportFile(buildBackup([item]), "backup.json").items[0];
  assert.equal(restored.seasonsAtFinish, 3);
  const bad = parseImportFile(JSON.stringify({ items: [{ ...item, seasonsAtFinish: "lots" }] }), "backup.json").items[0];
  assert.equal("seasonsAtFinish" in bad, false);
});
