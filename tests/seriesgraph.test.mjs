import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { parseSeriesGraphPage, seriesGraphQueryFromUrl } from "../dist-test/seriesgraph.js";

const URL = "https://seriesgraph.com/show/1396-breaking-bad";

test("parses title, year range, rating and season count", () => {
  const html = `<div id="show-chart-container">
    <h3 class="rt-Heading">Breaking Bad</h3>
    <p data-accent-color="gray">2008 - 2013</p>
    <p><strong class="rt-Strong">9.5</strong></p>
    <svg><g class="tick"><text>S1</text></g><g class="tick"><text>S5</text></g></svg>
  </div>`;
  const doc = new JSDOM(html, { url: URL }).window.document;
  assert.deepEqual(parseSeriesGraphPage(doc), {
    title: "Breaking Bad",
    type: "series",
    subtitle: "2008 · 5 seasons",
    year: "2008",
    durationOrSeasons: "5 seasons",
    imdbRating: "9.5",
  });
});

test("returns null without the chart container", () => {
  const doc = new JSDOM("<div></div>", { url: URL }).window.document;
  assert.equal(parseSeriesGraphPage(doc), null);
});

test("query comes from the URL slug", () => {
  assert.equal(seriesGraphQueryFromUrl(URL), "breaking bad");
});
