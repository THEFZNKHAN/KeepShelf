import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHomeRows, featuredRow, progressFraction, soonText } from "../dist-test/home-rows.js";

const item = (id, status, savedAt = 0) => ({ id, status, done: status === "done", savedAt });
const shelf = [
  item("a", "in_progress", 1),
  item("b", "in_progress", 5),
  item("c", "plan", 2),
  item("d", "plan", 9),
  item("e", "done", 3),
  item("f", "dropped", 4),
];
const keys = (rows) => rows.map((r) => r.key);
const ids = (row) => row.items.map((i) => i.id);

test("rows come in order: continue, coming up, new seasons, my list", () => {
  const { rows } = buildHomeRows(shelf, { shelf: "media", defaultView: "hide", soonIds: ["c"], newSeasonIds: ["e"] });
  assert.deepEqual(keys(rows), ["progress", "soon", "new-seasons", "plan"]);
  assert.equal(rows[0].title, "Continue watching");
  assert.equal(rows[3].title, "My list");
});

test("each status row is newest first", () => {
  const { rows } = buildHomeRows(shelf, { shelf: "media", defaultView: "hide" });
  assert.deepEqual(ids(rows[0]), ["b", "a"]);
  assert.deepEqual(ids(rows[1]), ["d", "c"]);
});

test("the hide view turns watched and dropped into links, with counts", () => {
  const { rows, links } = buildHomeRows(shelf, { shelf: "media", defaultView: "hide" });
  assert.ok(!keys(rows).includes("done"));
  assert.deepEqual(links, [
    { filter: "done", label: "Watched", count: 1 },
    { filter: "dropped", label: "Dropped", count: 1 },
  ]);
});

test("the show-everything view gives watched and dropped their own rows", () => {
  const { rows, links } = buildHomeRows(shelf, { shelf: "media", defaultView: "all" });
  assert.deepEqual(keys(rows), ["progress", "plan", "done", "dropped"]);
  assert.deepEqual(links, []);
});

test("empty rows and empty links are left out", () => {
  const { rows, links } = buildHomeRows([item("x", "plan")], { shelf: "media", defaultView: "hide", soonIds: [] });
  assert.deepEqual(keys(rows), ["plan"]);
  assert.deepEqual(links, []);
});

test("coming up keeps its own order, skips unknown ids and repeats", () => {
  const { rows } = buildHomeRows(shelf, { shelf: "media", defaultView: "hide", soonIds: ["d", "zzz", "a", "d"] });
  assert.deepEqual(ids(rows.find((r) => r.key === "soon")), ["d", "a"]);
});

test("books use reading words and never get coming up rows", () => {
  const { rows, links } = buildHomeRows(shelf, { shelf: "books", defaultView: "hide", soonIds: ["c"] });
  assert.deepEqual(rows.map((r) => r.title), ["Continue reading", "Want to read"]);
  assert.equal(links[0].label, "Read");
});

test("a row is cut to the limit but keeps its total", () => {
  const many = Array.from({ length: 30 }, (_, i) => item(`p${i}`, "plan", i));
  const { rows } = buildHomeRows(many, { shelf: "media", defaultView: "hide", limit: 5 });
  assert.equal(rows[0].items.length, 5);
  assert.equal(rows[0].total, 30);
  assert.equal(rows[0].seeAll, "todo");
});

test("an item without a status counts as done or to watch from its done flag", () => {
  const { rows } = buildHomeRows([{ id: "o", done: true, savedAt: 1 }, { id: "n", savedAt: 2 }], { shelf: "media", defaultView: "all" });
  assert.deepEqual(keys(rows), ["plan", "done"]);
});

test("progress fraction is clamped and empty when unknown", () => {
  assert.equal(progressFraction(5, 10), 0.5);
  assert.equal(progressFraction(12, 10), 1);
  assert.equal(progressFraction(undefined, 10), undefined);
  assert.equal(progressFraction(3, undefined), undefined);
  assert.equal(progressFraction(0, 10), undefined);
});

test("the billboard features what you are watching first, then what's coming, then your list", () => {
  const row = (key, n = 1) => ({ key, title: key, items: Array.from({ length: n }, (_, i) => ({ id: `${key}${i}` })), total: n, seeAll: "all" });
  assert.equal(featuredRow([row("plan"), row("soon"), row("progress")]).key, "progress");
  assert.equal(featuredRow([row("plan"), row("soon")]).key, "soon");
  assert.equal(featuredRow([row("done"), row("plan")]).key, "plan");
  assert.equal(featuredRow([row("done"), row("dropped")]), undefined);
  assert.equal(featuredRow([row("progress", 0), row("plan")]).key, "plan");
});

test("coming up text says when, then what", () => {
  assert.equal(soonText(0, "S3 E2"), "Today · S3 E2");
  assert.equal(soonText(1, "release"), "Tomorrow · Release");
  assert.equal(soonText(5, "streaming"), "In 5 days · Streaming");
  assert.equal(soonText(3, ""), "In 3 days");
});
