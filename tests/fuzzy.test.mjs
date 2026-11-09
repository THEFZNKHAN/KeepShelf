import { test } from "node:test";
import assert from "node:assert/strict";
import { areLikelyDuplicates, findDuplicateGroups, mergeUserData, normalizeTitle, pickKeeper } from "../dist-test/fuzzy.js";

const item = (over) => ({ id: over.title, type: "movie", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1, ...over });

test("normalizeTitle drops qualifiers, articles, accents and punctuation", () => {
  assert.equal(normalizeTitle("The Office (US)"), "office");
  assert.equal(normalizeTitle("Amélie"), "amelie");
  assert.equal(normalizeTitle("Fast & Furious: 7"), "fast and furious 7");
});

test("catches qualifier and typo variants of the same title", () => {
  assert.ok(areLikelyDuplicates(item({ title: "The Office (US)", type: "series" }), item({ title: "Office", type: "series" })));
  assert.ok(areLikelyDuplicates(item({ title: "Interstelar", year: "2014" }), item({ title: "Interstellar", year: "2014" })));
});

test("different years, types or short titles are not duplicates", () => {
  assert.ok(!areLikelyDuplicates(item({ title: "Dune", year: "1984" }), item({ title: "Dune", year: "2021" })));
  assert.ok(!areLikelyDuplicates(item({ title: "Dune" }), item({ title: "Dune", type: "book" })));
  assert.ok(!areLikelyDuplicates(item({ title: "Her" }), item({ title: "Heat" })));
});

test("books need compatible authors", () => {
  const a = item({ title: "Project Hail Mary", type: "book", author: "Andy Weir" });
  assert.ok(areLikelyDuplicates(a, item({ title: "Project Hail Mary", type: "book", author: "Weir, Andy" })));
  assert.ok(!areLikelyDuplicates(a, item({ title: "Project Hail Mary", type: "book", author: "Someone Else" })));
});

test("findDuplicateGroups groups transitively and ignores links", () => {
  const items = [
    item({ title: "The Office (US)", type: "series", savedAt: 1 }),
    item({ title: "Office", type: "series", savedAt: 2 }),
    item({ title: "Unrelated", type: "series" }),
    item({ title: "A", type: "link", url: "https://a.com" }),
    item({ title: "A", type: "link", url: "https://a.com/x" }),
  ];
  const groups = findDuplicateGroups(items);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((i) => i.title), ["The Office (US)", "Office"]);
});

test("merge keeps the richest item and unions user data", () => {
  const a = item({ title: "X", savedAt: 5, tags: ["a"], myRating: 8, status: "done", done: true, doneAt: 99, progressCurrent: 2 });
  const b = item({ title: "X ", savedAt: 1, tags: ["b"], review: "ok", progressCurrent: 7, progressTotal: 10 });
  assert.equal(pickKeeper([b, a]).id, a.id);
  const patch = mergeUserData(a, [b]);
  assert.deepEqual(patch.tags, ["a", "b"]);
  assert.equal(patch.myRating, 8);
  assert.equal(patch.review, "ok");
  assert.equal(patch.progressCurrent, 7);
  assert.equal(patch.progressTotal, 10);
  assert.equal(patch.status, "done");
  assert.equal(patch.doneAt, 99);
});

test("mergeUserData takes the best episodes of each season and keeps the overall count equal to their sum", () => {
  const a = item({ title: "Show", type: "series", seasonProgress: [10, 2], progressCurrent: 12 });
  const b = item({ title: "Show", type: "series", seasonProgress: [6, 5, 1], progressCurrent: 12 });
  const patch = mergeUserData(a, [b]);
  assert.deepEqual(patch.seasonProgress, [10, 5, 1]);
  assert.equal(patch.progressCurrent, 16);
  // Items without seasons are untouched by this rule.
  const plain = mergeUserData(item({ title: "X", progressCurrent: 4 }), [item({ title: "X", progressCurrent: 9 })]);
  assert.equal(plain.seasonProgress, undefined);
  assert.equal(plain.progressCurrent, 9);
});
