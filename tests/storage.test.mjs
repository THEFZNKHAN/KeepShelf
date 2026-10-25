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
