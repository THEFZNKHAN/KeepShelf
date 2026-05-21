import { initBookFilter, teardownBookFilter } from "./book-filter.js";
import { initGoogle, teardownGoogle } from "./google.js";
import { initGoodreads, teardownGoodreads } from "./goodreads.js";
import { initImdb, teardownImdb } from "./imdb.js";
import { initSeriesGraph, teardownSeriesGraph } from "./seriesgraph.js";
import { isBookFilterPage } from "../shared/book-filter.js";
import { isGoodreadsBookPage } from "../shared/goodreads.js";
import { isImdbTitlePage } from "../shared/imdb.js";
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
  init();
}

init();

window.addEventListener("popstate", onNavigation);
