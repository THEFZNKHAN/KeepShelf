import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTags } from "../dist-test/tag-filter.js";

const book = (subjects, tags) => ({ tags, bookInfo: { workKey: "/works/OL1W", subjects, fetchedAt: 1 } });

test("every tag is offered, alphabetically, with its count", () => {
  const { manual, genres } = groupTags([book(["Fantasy", "Epic"]), book(["Fantasy"]), book(["Business"])]);
  assert.deepEqual(manual, []);
  assert.deepEqual(genres.map((t) => [t.tag, t.count]), [["business", 1], ["epic", 1], ["fantasy", 2]]);
});

test("there is no cap: a long list is returned in full, for the picker to scroll", () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ tags: [`tag${String(i).padStart(2, "0")}`] }));
  const { manual } = groupTags(items);
  assert.equal(manual.length, 60);
  assert.equal(manual[0].tag, "tag00");
  assert.equal(manual[59].tag, "tag59");
});

test("your own tags and genre tags are kept in separate groups", () => {
  const { manual, genres } = groupTags([book(["Fantasy"], ["weekend"]), book(["Fantasy", "Epic"])]);
  assert.deepEqual(manual.map((t) => t.tag), ["weekend"]);
  assert.deepEqual(genres.map((t) => [t.tag, t.count]), [["epic", 1], ["fantasy", 2]]);
});

test("a tag you typed that is also a genre appears only under your tags, counting every item", () => {
  const { manual, genres } = groupTags([book(["Fantasy"], ["fantasy"]), book(["Fantasy"])]);
  assert.deepEqual(manual, [{ tag: "fantasy", count: 2, manual: true }]);
  assert.deepEqual(genres, []);
});

test("a tag counts once per item even if two sources name it", () => {
  const { genres } = groupTags([{ genre: "Drama", tmdb: { id: 1, kind: "movie", genres: ["Drama", "Crime"], fetchedAt: 1 } }]);
  assert.deepEqual(genres.map((t) => [t.tag, t.count]), [["crime", 1], ["drama", 1]]);
});

test("no items, no tags", () => {
  assert.deepEqual(groupTags([]), { manual: [], genres: [] });
});
