import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotItems } from "../dist-test/undo.js";

const item = (id, extra = {}) => ({ id, title: id, type: "movie", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1, ...extra });

test("snapshotItems returns only the requested items", () => {
  const all = [item("a"), item("b"), item("c")];
  assert.deepEqual(snapshotItems(all, ["c", "a"]).map((i) => i.id), ["a", "c"]);
  assert.deepEqual(snapshotItems(all, ["zzz"]), []);
  assert.deepEqual(snapshotItems(all, []), []);
});

test("snapshotItems copies deeply so later edits can't change what Undo restores", () => {
  const all = [item("a", { tags: ["x"], tmdb: { id: 1, kind: "movie", genres: ["Drama"], fetchedAt: 1 } })];
  const snap = snapshotItems(all, ["a"]);
  all[0].tags.push("y");
  all[0].tmdb.genres.push("Comedy");
  all[0].title = "changed";
  assert.deepEqual(snap[0].tags, ["x"]);
  assert.deepEqual(snap[0].tmdb.genres, ["Drama"]);
  assert.equal(snap[0].title, "a");
});
