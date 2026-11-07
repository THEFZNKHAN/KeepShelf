import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUserPatch, normalizeRating, normalizeTags, sanitizeImportedUserData, statusOf } from "../dist-test/user-data.js";
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
