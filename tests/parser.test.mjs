import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { findKnowledgePanelRoot, parseKnowledgePanel } from "../dist-test/parser.js";

function searchPage(query, panelHtml, otherResultsHtml) {
  const html = `<body>
    <div id="center_col">${otherResultsHtml}</div>
    <div class="kp-wholepage-osrp">${panelHtml}</div>
  </body>`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  return new JSDOM(html, { url }).window.document;
}

function parse(doc) {
  const root = findKnowledgePanelRoot(doc);
  assert.ok(root, "knowledge panel root should be found");
  return parseKnowledgePanel(root, doc);
}

test("parses a film panel and ignores IMDb ratings from other results", () => {
  const doc = searchPage(
    "inception",
    `<div data-maindata='[null,null,"Inception",null,["FILM"]]'></div>
     <div data-attrid="title">Inception</div>
     <div data-attrid="subtitle">2010 ‧ Sci-fi/Action ‧ 2h 28m</div>
     <span aria-label="IMDb scored 8.8 out of 10"></span>`,
    `<span aria-label="IMDb scored 5.1 out of 10"></span>`
  );
  const parsed = parse(doc);
  assert.equal(parsed?.title, "Inception");
  assert.equal(parsed?.type, "movie");
  assert.equal(parsed?.year, "2010");
  assert.equal(parsed?.genre, "Sci-fi/Action");
  assert.equal(parsed?.durationOrSeasons, "2h 28m");
  assert.equal(parsed?.imdbRating, "8.8");
});

test("falls back to an IMDb rating elsewhere on the page when the panel has none", () => {
  const doc = searchPage(
    "inception",
    `<div data-maindata='[null,null,"Inception",null,["FILM"]]'></div>
     <div data-attrid="title">Inception</div>
     <div data-attrid="subtitle">2010 ‧ Sci-fi/Action ‧ 2h 28m</div>`,
    `<span aria-label="IMDb scored 8.8 out of 10"></span>`
  );
  assert.equal(parse(doc)?.imdbRating, "8.8");
});

test("a plain TV show is a series", () => {
  const doc = searchPage(
    "stranger things",
    `<div data-maindata='[null,null,"Stranger Things",null,["TV"]]'></div>
     <div data-attrid="title">Stranger Things</div>
     <div data-attrid="subtitle">2016 ‧ Drama ‧ 4 seasons</div>`,
    ""
  );
  const parsed = parse(doc);
  assert.equal(parsed?.type, "series");
  assert.equal(parsed?.durationOrSeasons, "4 seasons");
});

test("a MyAnimeList link marks the show as anime", () => {
  const doc = searchPage(
    "frieren",
    `<div data-maindata='[null,null,"Frieren",null,["TV"]]'></div>
     <div data-attrid="title">Frieren</div>
     <div data-attrid="subtitle">2023 ‧ Fantasy ‧ 1 season</div>
     <a href="https://myanimelist.net/anime/52991">MyAnimeList</a>`,
    ""
  );
  assert.equal(parse(doc)?.type, "anime");
});
