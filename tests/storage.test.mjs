import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeKey, normalizeUrl } from "../dist-test/storage.js";

test("normalizeUrl drops hash and trailing slash, lowercases host", () => {
  assert.equal(normalizeUrl("https://Example.com/path/#section"), "https://example.com/path");
  assert.equal(normalizeUrl("https://example.com/?q=1"), "https://example.com/?q=1");
  assert.equal(normalizeUrl("not a url "), "not a url");
});

test("media dedupe ignores title case but respects year and type", () => {
  const a = dedupeKey({ type: "movie", title: "Dune", year: "2021" });
  assert.equal(a, dedupeKey({ type: "movie", title: " dune ", year: "2021" }));
  assert.notEqual(a, dedupeKey({ type: "movie", title: "Dune", year: "1984" }));
  assert.notEqual(a, dedupeKey({ type: "book", title: "Dune", year: "2021" }));
});

test("tabs and links dedupe by normalised URL, separately from each other", () => {
  const tab = dedupeKey({ type: "tab", title: "A", url: "https://example.com/x/" });
  assert.equal(tab, dedupeKey({ type: "tab", title: "B", url: "https://example.com/x#top" }));
  assert.notEqual(tab, dedupeKey({ type: "link", title: "A", url: "https://example.com/x/" }));
});

test("notes dedupe by body text", () => {
  assert.equal(
    dedupeKey({ type: "note", title: "t1", body: "Buy Milk" }),
    dedupeKey({ type: "note", title: "t2", body: " buy milk " })
  );
});

test("mergeItems folds user data into the keeper and removes the rest", async () => {
  const { mergeItems, STORAGE_KEY } = await import("../dist-test/storage.js");
  const base = { subtitle: "", googleQuery: "", sourceUrl: "", type: "movie" };
  const store = {
    [STORAGE_KEY]: [
      { ...base, id: "a", title: "Dune", savedAt: 1, tags: ["x"] },
      { ...base, id: "b", title: "Dune ", savedAt: 2, tags: ["y"], myRating: 9, status: "done", done: true, doneAt: 5 },
      { ...base, id: "c", title: "Other", savedAt: 3 },
    ],
  };
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ ...store }),
        set: async (value) => Object.assign(store, value),
      },
    },
  };
  const result = await mergeItems("a", ["b"]);
  assert.deepEqual(result.map((i) => i.id), ["a", "c"]);
  assert.deepEqual(result[0].tags, ["x", "y"]);
  assert.equal(result[0].myRating, 9);
  assert.equal(result[0].done, true);
  await assert.rejects(() => mergeItems("missing", []));
  delete globalThis.chrome;
});

function fakeChrome(store) {
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => JSON.parse(JSON.stringify(store)),
        set: async (value) => Object.assign(store, value),
      },
    },
  };
}

test("restoreItems puts deleted items back with their original ids and order", async () => {
  const { restoreItems, deleteItems, STORAGE_KEY } = await import("../dist-test/storage.js");
  const base = { subtitle: "", googleQuery: "", sourceUrl: "", type: "movie" };
  const original = [
    { ...base, id: "a", title: "A", savedAt: 30, tags: ["x"], myRating: 8 },
    { ...base, id: "b", title: "B", savedAt: 20 },
    { ...base, id: "c", title: "C", savedAt: 10 },
  ];
  const store = { [STORAGE_KEY]: structuredClone(original) };
  fakeChrome(store);
  const removed = structuredClone(original.filter((i) => i.id !== "b"));
  await deleteItems(["a", "c"]);
  assert.deepEqual(store[STORAGE_KEY].map((i) => i.id), ["b"]);
  const result = await restoreItems(removed);
  assert.deepEqual(result, original);
  assert.deepEqual(store[STORAGE_KEY], original);
  delete globalThis.chrome;
});

test("restoreItems overwrites an item with the same id and never duplicates", async () => {
  const { restoreItems, STORAGE_KEY } = await import("../dist-test/storage.js");
  const base = { subtitle: "", googleQuery: "", sourceUrl: "", type: "movie" };
  const store = { [STORAGE_KEY]: [{ ...base, id: "a", title: "A", savedAt: 5, tags: ["merged"] }] };
  fakeChrome(store);
  const result = await restoreItems([
    { ...base, id: "a", title: "A", savedAt: 5 },
    { ...base, id: "b", title: "B", savedAt: 9 },
  ]);
  assert.deepEqual(result.map((i) => i.id), ["b", "a"]);
  assert.equal(result.find((i) => i.id === "a").tags, undefined);
  await restoreItems([{ ...base, id: "b", title: "B", savedAt: 9 }]);
  assert.equal(store[STORAGE_KEY].length, 2);
  delete globalThis.chrome;
});

test("undoing a merge brings back the removed items and the keeper's original data", async () => {
  const { restoreItems, mergeItems, STORAGE_KEY } = await import("../dist-test/storage.js");
  const { snapshotItems } = await import("../dist-test/undo.js");
  const base = { subtitle: "", googleQuery: "", sourceUrl: "", type: "movie" };
  const original = [
    { ...base, id: "a", title: "Dune", savedAt: 2, tags: ["x"] },
    { ...base, id: "b", title: "Dune ", savedAt: 1, tags: ["y"], myRating: 9, status: "done", done: true, doneAt: 5 },
  ];
  const store = { [STORAGE_KEY]: structuredClone(original) };
  fakeChrome(store);
  const snap = snapshotItems(original, ["a", "b"]);
  await mergeItems("a", ["b"]);
  assert.equal(store[STORAGE_KEY].length, 1);
  await restoreItems(snap);
  assert.deepEqual(store[STORAGE_KEY], original);
  delete globalThis.chrome;
});
