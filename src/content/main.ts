import { initBookFilter, teardownBookFilter } from "./book-filter.js";
import { initGoogle, teardownGoogle } from "./google.js";
import { initGoodreads, teardownGoodreads } from "./goodreads.js";
import { initImdb, teardownImdb } from "./imdb.js";
import { initLetterboxd, teardownLetterboxd } from "./letterboxd.js";
import { initMal, teardownMal } from "./mal.js";
import { initSeriesGraph, teardownSeriesGraph } from "./seriesgraph.js";
import { isBookFilterPage } from "../shared/book-filter.js";
import { isGoodreadsBookPage } from "../shared/goodreads.js";
import { isImdbTitlePage } from "../shared/imdb.js";
import { isLetterboxdFilmPage } from "../shared/letterboxd.js";
import { isMalAnimePage } from "../shared/mal.js";
import { isSeriesGraphShowPage } from "../shared/seriesgraph.js";

function init(): void {
  if (isGoodreadsBookPage()) {
    initGoodreads();
    return;
  }

  if (isBookFilterPage()) {
    initBookFilter();
    return;
  }

  if (isImdbTitlePage()) {
    initImdb();
    return;
  }

  if (isSeriesGraphShowPage()) {
    initSeriesGraph();
    return;
  }

  if (isMalAnimePage()) {
    initMal();
    return;
  }

  if (isLetterboxdFilmPage()) {
    initLetterboxd();
    return;
  }

  if (
    location.hostname.endsWith("google.com") &&
    location.pathname.startsWith("/search")
  ) {
    initGoogle();
  }
}

function onNavigation(): void {
  teardownGoogle();
  teardownGoodreads();
  teardownBookFilter();
  teardownImdb();
  teardownSeriesGraph();
  teardownMal();
  teardownLetterboxd();
  init();
}

init();

window.addEventListener("popstate", onNavigation);
