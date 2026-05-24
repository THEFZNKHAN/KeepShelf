import { initBookFilter, teardownBookFilter, getReadyToSave as getBookFilterReady } from "./book-filter.js";
import { initGoogle, teardownGoogle, getReadyToSave as getGoogleReady } from "./google.js";
import { initGoodreads, teardownGoodreads, getReadyToSave as getGoodreadsReady } from "./goodreads.js";
import { initImdb, teardownImdb, getReadyToSave as getImdbReady } from "./imdb.js";
import { initLetterboxd, teardownLetterboxd, getReadyToSave as getLetterboxdReady } from "./letterboxd.js";
import { initMal, teardownMal, getReadyToSave as getMalReady } from "./mal.js";
import { initSeriesGraph, teardownSeriesGraph, getReadyToSave as getSeriesGraphReady } from "./seriesgraph.js";
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== "getPageData") return false;
  const item =
    getGoogleReady() ??
    getImdbReady() ??
    getGoodreadsReady() ??
    getBookFilterReady() ??
    getSeriesGraphReady() ??
    getMalReady() ??
    getLetterboxdReady() ??
    null;
  sendResponse({ item });
  return false;
});

init();

window.addEventListener("popstate", onNavigation);
