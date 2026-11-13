import { test } from "node:test";
import assert from "node:assert/strict";
import { TRAILER_LANGUAGES, pickTrailer } from "../dist-test/trailer.js";

const v = (key, extra = {}) => ({ key, site: "YouTube", type: "Trailer", official: true, published_at: "2020-01-01T00:00:00.000Z", name: `Video ${key}`, ...extra });
const url = (key) => `https://www.youtube.com/watch?v=${key}`;

test("pickTrailer returns a YouTube link and the video's name", () => {
  assert.deepEqual(pickTrailer({ results: [v("abc123XYZ_-")] }), { url: url("abc123XYZ_-"), name: "Video abc123XYZ_-" });
});

test("pickTrailer prefers a trailer over a teaser over anything else", () => {
  const results = [v("clip000001", { type: "Clip" }), v("teaser0001", { type: "Teaser" }), v("trailer001", { type: "Trailer" }), v("feature001", { type: "Featurette" })];
  assert.equal(pickTrailer({ results }).url, url("trailer001"));
  assert.equal(pickTrailer({ results: results.filter((r) => r.type !== "Trailer") }).url, url("teaser0001"));
  assert.equal(pickTrailer({ results: [results[0], results[3]] }).url, url("clip000001"), "any YouTube video when there is no trailer or teaser");
});

test("pickTrailer prefers official ones, then the newest", () => {
  const results = [
    v("old0000001", { official: true, published_at: "2018-01-01T00:00:00Z" }),
    v("new0000001", { official: true, published_at: "2022-06-01T00:00:00Z" }),
    v("fan0000001", { official: false, published_at: "2024-01-01T00:00:00Z" }),
  ];
  assert.equal(pickTrailer({ results }).url, url("new0000001"));
  assert.equal(pickTrailer({ results: [results[2], results[0]] }).url, url("old0000001"), "official beats newer but unofficial");
  assert.equal(pickTrailer({ results: [v("nodate0001", { published_at: undefined }), v("dated00001", { published_at: "2000-01-01T00:00:00Z" })] }).url, url("dated00001"));
});

test("pickTrailer ignores other sites and keys that are not well formed", () => {
  const results = [
    v("vimeo00001", { site: "Vimeo" }),
    v("bad key!!!!"),
    v("../../evil"),
    v("x"),
    v("a".repeat(40)),
    v(12345678),
    v(undefined),
    { site: "YouTube", type: "Trailer" },
    null,
    "x",
    v("goodkey123"),
  ];
  assert.equal(pickTrailer({ results }).url, url("goodkey123"), "only the one valid YouTube video can be chosen");
  assert.equal(pickTrailer({ results: results.slice(0, 10) }), undefined);
});

test("pickTrailer copes with nothing, and cleans the name", () => {
  for (const raw of [undefined, null, {}, { results: "x" }, { results: [] }, 5, "x"]) assert.equal(pickTrailer(raw), undefined);
  assert.equal(pickTrailer({ results: [v("goodkey123", { name: "  Official\tTrailer\n  #1 " + "x".repeat(300) })] }).name.length <= 100, true);
  assert.equal(pickTrailer({ results: [v("goodkey123", { name: 7 })] }).name, "");
  assert.match(pickTrailer({ results: [v("goodkey123", { name: "Tab\tand\nbreaks" })] }).name, /^Tab and breaks$/);
});

test("the language list covers English, untagged videos and the main film languages", () => {
  const list = TRAILER_LANGUAGES.split(",");
  for (const code of ["en", "null", "hi", "ja", "ko", "es"]) assert.ok(list.includes(code), code);
});
