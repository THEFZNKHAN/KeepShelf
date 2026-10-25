import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  isRottenTomatoesTitlePage,
  parseRottenTomatoesPage,
  rottenTomatoesSlugFromUrl,
} from "../dist-test/rottentomatoes.js";

function page(url, jsonLd, heroProps) {
  const hero = heroProps
    ? `<script id="media-hero-json" type="application/json">${JSON.stringify({ content: { metadataProps: heroProps } })}</script>`
    : "";
  const html = `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body>${hero}</body></html>`;
  return new JSDOM(html, { url }).window.document;
}

test("movie: Tomatometer, year, genres and runtime from the hero data", () => {
  const doc = page(
    "https://www.rottentomatoes.com/m/inception",
    {
      "@type": "Movie",
      name: "Inception",
      dateCreated: "2010-07-16",
      genre: ["Sci-Fi", "Mystery & Thriller", "Action"],
      aggregateRating: { name: "Tomatometer", ratingValue: "86", bestRating: "100" },
    },
    ["PG-13", "2010", "2h 28m"]
  );
  assert.equal(isRottenTomatoesTitlePage(doc), true);
  assert.deepEqual(parseRottenTomatoesPage(doc), {
    title: "Inception",
    type: "movie",
    subtitle: "2010 · Sci-Fi/Mystery & Thriller · 2h 28m",
    year: "2010",
    genre: "Sci-Fi/Mystery & Thriller",
    durationOrSeasons: "2h 28m",
    imdbRating: "86",
  });
});

test("TV series uses numberOfSeasons", () => {
  const doc = page(
    "https://www.rottentomatoes.com/tv/breaking_bad",
    { "@type": "TVSeries", name: "Breaking Bad", dateCreated: "2008-01-20", genre: ["Crime", "Drama"], numberOfSeasons: 5, aggregateRating: { ratingValue: "96" } },
    ["TV-14", "2008 - 2013", "5 Seasons"]
  );
  const parsed = parseRottenTomatoesPage(doc);
  assert.equal(parsed?.type, "series");
  assert.equal(parsed?.durationOrSeasons, "5 seasons");
  assert.equal(parsed?.imdbRating, "96");
});

test("Anime genre marks the title as anime", () => {
  const doc = page("https://www.rottentomatoes.com/tv/frieren", { "@type": "TVSeries", name: "Frieren", genre: ["Anime", "Fantasy"] });
  assert.equal(parseRottenTomatoesPage(doc)?.type, "anime");
});

test("only title pages match, and the slug becomes the query", () => {
  const doc = new JSDOM("", { url: "https://www.rottentomatoes.com/browse/movies_in_theaters" }).window.document;
  assert.equal(isRottenTomatoesTitlePage(doc), false);
  assert.equal(rottenTomatoesSlugFromUrl("https://www.rottentomatoes.com/tv/breaking_bad"), "breaking bad");
});

const fixture = new URL("./fixtures/rt_movie.html", import.meta.url);
test("real saved page (tests/fixtures/rt_movie.html)", { skip: !existsSync(fixture) }, () => {
  const doc = new JSDOM(readFileSync(fixture, "utf8"), { url: "https://www.rottentomatoes.com/m/inception" }).window.document;
  const parsed = parseRottenTomatoesPage(doc);
  assert.equal(parsed?.title, "Inception");
  assert.equal(parsed?.type, "movie");
  assert.equal(parsed?.year, "2010");
  assert.equal(parsed?.durationOrSeasons, "2h 28m");
  assert.match(parsed?.imdbRating ?? "", /^\d+$/);
});
