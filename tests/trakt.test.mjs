import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { isTraktTitlePage, parseTraktPage, traktSlugFromUrl } from "../dist-test/trakt.js";

function page(url, jsonLd) {
  const ld = jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : "";
  return new JSDOM(`<html><head>${ld}</head><body></body></html>`, { url }).window.document;
}

// Shape copied from the rendered app.trakt.tv page.
const inception = {
  "@context": "https://schema.org",
  "@type": "Movie",
  name: "Inception",
  url: "https://app.trakt.tv/movies/inception-2010",
  aggregateRating: { "@type": "AggregateRating", ratingValue: "8.8", ratingCount: 70151, bestRating: "10" },
  datePublished: "2010",
  genre: ["Action", "Science Fiction", "Crime"],
  duration: "PT148M",
};

test("movie: rating, year, genres and runtime", () => {
  const doc = page("https://app.trakt.tv/movies/inception-2010", inception);
  assert.equal(isTraktTitlePage(doc), true);
  assert.deepEqual(parseTraktPage(doc), {
    title: "Inception",
    type: "movie",
    subtitle: "2010 · Action/Science Fiction · 2h 28m",
    year: "2010",
    genre: "Action/Science Fiction",
    durationOrSeasons: "2h 28m",
    imdbRating: "8.8",
  });
});

test("show without a season count", () => {
  const doc = page("https://app.trakt.tv/shows/breaking-bad", {
    "@type": "TVSeries",
    name: "Breaking Bad",
    url: "https://app.trakt.tv/shows/breaking-bad",
    aggregateRating: { ratingValue: "9.3" },
    datePublished: "2008",
    genre: ["Drama", "Crime", "Thriller"],
  });
  const parsed = parseTraktPage(doc);
  assert.equal(parsed?.type, "series");
  assert.equal(parsed?.year, "2008");
  assert.equal(parsed?.durationOrSeasons, undefined);
});

test("ignores JSON-LD left over from the previous title after in-app navigation", () => {
  const doc = page("https://app.trakt.tv/movies/interstellar-2014", inception);
  assert.equal(parseTraktPage(doc), null);
});

test("returns null before the app renders its JSON-LD", () => {
  assert.equal(parseTraktPage(page("https://app.trakt.tv/movies/inception-2010")), null);
});

test("only movie and show pages match", () => {
  const doc = page("https://app.trakt.tv/movies/inception-2010/comments");
  assert.equal(isTraktTitlePage(doc), false);
  assert.equal(traktSlugFromUrl("https://app.trakt.tv/shows/breaking-bad"), "breaking-bad");
});
