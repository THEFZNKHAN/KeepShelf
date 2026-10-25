import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { isImdbTitlePage, parseImdbPage } from "../dist-test/imdb.js";

function page(title, jsonLd, url = "https://www.imdb.com/title/tt1375666/") {
  const html = `<html><head><title>${title}</title>
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    </head><body></body></html>`;
  return new JSDOM(html, { url }).window.document;
}

test("parses a movie from JSON-LD", () => {
  const doc = page("Inception (2010) - IMDb", {
    "@type": "Movie",
    name: "Inception",
    datePublished: "2010-07-16",
    genre: ["Action", "Sci-Fi"],
    aggregateRating: { ratingValue: 8.8 },
    duration: "PT2H28M",
  });
  assert.equal(isImdbTitlePage(doc), true);
  assert.deepEqual(parseImdbPage(doc), {
    title: "Inception",
    type: "movie",
    subtitle: "2010 · Action/Sci-Fi · 2h 28m",
    year: "2010",
    genre: "Action/Sci-Fi",
    durationOrSeasons: "2h 28m",
    imdbRating: "8.8",
  });
});

test("animated series are classified as anime with a season count", () => {
  const doc = page("Frieren (TV Series 2023– ) - IMDb", {
    "@type": "TVSeries",
    name: "Frieren",
    datePublished: "2023-09-29",
    genre: ["Animation", "Adventure"],
    numberOfSeasons: 1,
  });
  const parsed = parseImdbPage(doc);
  assert.equal(parsed?.type, "anime");
  assert.equal(parsed?.durationOrSeasons, "1 season");
});

test("non-title pages are not IMDb title pages", () => {
  const doc = new JSDOM("<html></html>", { url: "https://www.imdb.com/chart/top/" }).window.document;
  assert.equal(isImdbTitlePage(doc), false);
});
