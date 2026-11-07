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
