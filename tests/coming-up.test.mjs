import { test } from "node:test";
import assert from "node:assert/strict";
import { COMING_UP_DAYS, COMING_UP_WINDOWS, airingWithoutDate, sanitizeWindow, streamingStatuses, comingUp, dayHeading, digitalDate, groupByDay, regionsFor, shortDate, streamingNote } from "../dist-test/coming-up.js";

const iso = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const base = { subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1 };
const show = (title, offset, extra = {}) => ({
  ...base, id: title, title, type: "series",
  tmdb: { id: 1, kind: "tv", genres: [], fetchedAt: 1, nextEpisode: { airDate: iso(offset), season: 2, episode: 6 } },
  ...extra,
});
const film = (title, offset, extra = {}) => ({
  ...base, id: title, title, type: "movie", tmdb: { id: 2, kind: "movie", genres: [], fetchedAt: 1, releaseDate: iso(offset) }, ...extra,
});
const now = Date.now();

test("lists what is airing or releasing in the next two weeks, soonest first", () => {
  const entries = comingUp([show("Later", 9), film("Tomorrow film", 1), show("Today show", 0), film("Soon", 4)], now);
  assert.deepEqual(entries.map((e) => [e.item.title, e.days, e.label]), [
    ["Today show", 0, "S2 E6"], ["Tomorrow film", 1, "release"], ["Soon", 4, "release"], ["Later", 9, "S2 E6"],
  ]);
  assert.equal(COMING_UP_DAYS, 14);
});

test("the window is today through day 14, and nothing outside it", () => {
  const titles = (offsets) => comingUp(offsets.map((o) => show(`d${o}`, o)), now).map((e) => e.item.title);
  assert.deepEqual(titles([-3, -1, 0, 14, 15, 40]), ["d0", "d14"]);
  assert.deepEqual(comingUp([show("a", 20)], now, 30).map((e) => e.item.title), ["a"]);
});

test("watched and dropped titles are left out, and so is anything without a date", () => {
  const items = [
    show("Watched", 1, { status: "done", done: true }), show("Dropped", 1, { status: "dropped" }), show("Going", 1, { status: "in_progress" }),
    show("Planned", 2), film("Seen film", 1, { done: true }), { ...base, id: "x", title: "No info", type: "movie" },
    { ...base, id: "y", title: "Ended show", type: "series", tmdb: { id: 3, kind: "tv", genres: [], fetchedAt: 1 } },
    { ...base, id: "b", title: "A book", type: "book" },
  ];
  assert.deepEqual(comingUp(items, now).map((e) => e.item.title), ["Going", "Planned"]);
});

test("ties on the same day are alphabetical", () => {
  assert.deepEqual(comingUp([show("Zeta", 2), film("Alpha", 2), show("Mid", 2)], now).map((e) => e.item.title), ["Alpha", "Mid", "Zeta"]);
});

test("dayHeading", () => {
  assert.equal(dayHeading(0, "2026-11-10"), "Today");
  assert.equal(dayHeading(1, "2026-11-11"), "Tomorrow");
  assert.equal(dayHeading(3, "2026-11-13"), "Fri 13 Nov");
  assert.equal(dayHeading(11, "2026-11-21"), "Sat 21 Nov");
  assert.equal(dayHeading(30, "2027-01-02"), "Sat 2 Jan");
  assert.equal(dayHeading(5, "not a date"), "not a date");
});

test("entries on the same day share a heading, in order", () => {
  const groups = groupByDay(comingUp([show("B", 2), film("A", 2), show("C", 0), film("D", 5)], now));
  assert.deepEqual(groups.map((g) => [g.heading === "Today" ? "Today" : "later", g.days, g.entries.map((e) => e.item.title)]), [
    ["Today", 0, ["C"]], ["later", 2, ["A", "B"]], ["later", 5, ["D"]],
  ]);
  assert.deepEqual(groupByDay([]), []);
});

const airing = (title, extra = {}, tmdbExtra = {}) => ({
  ...base, id: title, title, type: "series", ...extra,
  tmdb: { id: 1, kind: "tv", genres: [], fetchedAt: 1, status: "Returning Series", ...tmdbExtra },
});

test("airing shows with no next date are listed, so the screen can say why they are missing", () => {
  const items = [
    airing("No date"), airing("Date passed", {}, { nextEpisode: { airDate: iso(-4), season: 1, episode: 1 } }),
    airing("Has a date", {}, { nextEpisode: { airDate: iso(3), season: 1, episode: 2 } }),
    airing("Date far off", {}, { nextEpisode: { airDate: iso(40), season: 1, episode: 2 } }),
    airing("Ended", {}, { status: "Ended" }), airing("Cancelled", {}, { status: "Canceled" }),
    airing("Finished", { status: "done", done: true }), airing("Dropped", { status: "dropped" }),
    airing("Unknown status", {}, { status: undefined }),
    { ...base, id: "m", title: "A movie", type: "movie", tmdb: { id: 2, kind: "movie", genres: [], fetchedAt: 1 } },
    { ...base, id: "x", title: "No info", type: "series" },
  ];
  // Watching comes before planned, then A to Z.
  const watching = airing("Watching, no date", { status: "in_progress" });
  assert.deepEqual(airingWithoutDate([...items, watching], now).map((i) => i.title), ["Watching, no date", "Date passed", "No date"]);
});

test("a show with a date inside the window is on the list and not in the no-date list", () => {
  const dated = airing("Dated", {}, { nextEpisode: { airDate: iso(2), season: 3, episode: 1 } });
  assert.deepEqual(comingUp([dated], now).map((e) => e.item.title), ["Dated"]);
  assert.deepEqual(airingWithoutDate([dated], now), []);
});

const withDigital = (title, releaseOffset, digital) => ({
  ...base, id: title, title, type: "movie",
  tmdb: { id: 9, kind: "movie", genres: [], fetchedAt: 1, ...(releaseOffset === undefined ? {} : { releaseDate: iso(releaseOffset) }), digitalDates: Object.fromEntries(Object.entries(digital).map(([c, o]) => [c, iso(o)])) },
});

test("regionsFor puts the user's country first, then the US", () => {
  assert.deepEqual(regionsFor("en-IN"), ["IN", "US"]);
  assert.deepEqual(regionsFor("en-US"), ["US"]);
  assert.deepEqual(regionsFor("pt_BR"), ["BR", "US"]);
  assert.deepEqual(regionsFor("fr-ca"), ["CA", "US"]);
  assert.deepEqual(regionsFor("en"), ["US"]);
  assert.deepEqual(regionsFor(""), ["US"]);
  assert.deepEqual(regionsFor(undefined), ["US"]);
  assert.deepEqual(regionsFor("zh-Hant-TW"), ["TW", "US"]);
});

test("digitalDate takes the user's country, then the US, and never a country they didn't ask for", () => {
  const film = withDigital("F", -5, { IN: 12, US: 9, DE: 3 });
  assert.equal(digitalDate(film, ["IN", "US"]).region, "IN");
  assert.equal(digitalDate(film, ["BR", "US"]).region, "US");
  assert.equal(digitalDate(film, ["BR"]), undefined);
  assert.equal(digitalDate(film, ["IN", "US"]).date, iso(12));
  assert.equal(digitalDate(withDigital("E", -5, {}), ["US"]), undefined);
  assert.equal(digitalDate({ ...base, id: "x", title: "x", type: "movie" }, ["US"]), undefined);
  assert.equal(digitalDate(show("S", 1), ["US"]), undefined, "a series has no streaming date of its own");
});

test("shortDate and streamingNote", () => {
  assert.equal(shortDate("2026-12-09"), "9 Dec");
  assert.equal(shortDate("2026-01-31"), "31 Jan");
  assert.equal(shortDate("soon"), "soon");
  assert.equal(streamingNote(withDigital("F", -5, { US: 0 }), now, ["US"]), "Streaming today");
  assert.equal(streamingNote(withDigital("F", -5, { US: 1 }), now, ["US"]), "Streaming tomorrow");
  assert.match(streamingNote(withDigital("F", -5, { US: 20 }), now, ["US"]), /^Streaming \d{1,2} [A-Z][a-z]{2}$/);
  assert.equal(streamingNote(withDigital("F", -50, { US: -3 }), now, ["US"]), undefined, "already on streaming");
  assert.equal(streamingNote(withDigital("F", -5, {}), now, ["US"]), undefined);
});

test("a movie already in cinemas shows up when it reaches streaming", () => {
  const entries = comingUp([withDigital("Out now", -20, { US: 6 })], now);
  assert.deepEqual(entries.map((e) => [e.item.title, e.days, e.label, e.region]), [["Out now", 6, "streaming", "US"]]);
});

test("a movie can appear twice: its release, then its streaming date", () => {
  const entries = comingUp([withDigital("Both", 2, { US: 10 })], now);
  assert.deepEqual(entries.map((e) => [e.days, e.label]), [[2, "release"], [10, "streaming"]]);
});

test("a film released straight to streaming has one entry, and it says streaming", () => {
  const entries = comingUp([withDigital("Original", 3, { US: 3 })], now);
  assert.deepEqual(entries.map((e) => [e.days, e.label]), [[3, "streaming"]]);
});

test("streaming dates follow the user's country, and a streaming date outside the window is left off", () => {
  const film = withDigital("F", -10, { IN: 4, US: 9 });
  assert.deepEqual(comingUp([film], now, 14, ["IN", "US"]).map((e) => [e.days, e.region]), [[4, "IN"]]);
  assert.deepEqual(comingUp([film], now, 14, ["US"]).map((e) => [e.days, e.region]), [[9, "US"]]);
  assert.deepEqual(comingUp([withDigital("Far", -10, { US: 30 })], now), []);
  assert.deepEqual(comingUp([film], now, 14, ["DE"]), []);
});

test("watched and dropped movies get no streaming entry", () => {
  assert.deepEqual(comingUp([{ ...withDigital("Seen", -10, { US: 3 }), status: "done", done: true }, { ...withDigital("Dropped", -10, { US: 3 }), status: "dropped" }], now), []);
});

test("the windows to choose from, and a saved choice that isn't one of them falls back", () => {
  assert.deepEqual(COMING_UP_WINDOWS.map((w) => w.days), [14, 30, 90]);
  assert.equal(sanitizeWindow(30), 30);
  assert.equal(sanitizeWindow("90"), 90);
  assert.equal(sanitizeWindow("7"), 14);
  assert.equal(sanitizeWindow("lots"), 14);
  assert.equal(sanitizeWindow(undefined), 14);
  assert.equal(sanitizeWindow(null), 14);
});

test("a wider window lists streaming dates a narrow one leaves out", () => {
  const film = withDigital("F", -40, { US: 25 });
  assert.deepEqual(comingUp([film], now), []);
  assert.deepEqual(comingUp([film], now, 30).map((e) => [e.days, e.label]), [[25, "streaming"]]);
  assert.deepEqual(comingUp([film], now, 90).map((e) => e.days), [25]);
});

test("streamingStatuses says where each movie stands, so a missing one is explained", () => {
  const items = [
    withDigital("Already on streaming", -60, { US: -5 }),
    withDigital("Streaming later", -30, { US: 40 }),
    withDigital("In the window", -30, { US: 6 }),
    withDigital("No date", -30, {}),
    { ...film("Never checked", -30), tmdb: { id: 3, kind: "movie", genres: [], fetchedAt: 1, releaseDate: iso(-30) } },
    withDigital("Not out yet", 9, {}),
    withDigital("Out too long ago", -400, {}),
    { ...withDigital("Watched", -30, {}), status: "done", done: true },
    show("A series", 3),
    { ...base, id: "x", title: "No info", type: "movie" },
  ];
  const states = Object.fromEntries(streamingStatuses(items, now, ["US"]).map((s) => [s.item.title, s.state]));
  assert.deepEqual(states, {
    "Already on streaming": "since",
    "Never checked": "unchecked",
    "No date": "none",
    "Not out yet": "none",
    "Streaming later": "later",
  });
  // The one inside the window is in the main list, so it is not repeated here.
  assert.deepEqual(comingUp(items, now, 14, ["US"]).map((e) => e.item.title).filter((t) => t === "In the window"), ["In the window"]);
});

test("streamingStatuses follows the window and the user's country, and is A to Z", () => {
  const f = withDigital("F", -30, { IN: 20, US: 5 });
  assert.equal(streamingStatuses([f], now, ["IN", "US"], 14)[0].state, "later");
  assert.deepEqual(streamingStatuses([f], now, ["IN", "US"], 30), []);
  const us = streamingStatuses([f], now, ["US"], 14);
  assert.deepEqual(us, [], "the US date is inside the window");
  assert.deepEqual(streamingStatuses([withDigital("Zed", -30, {}), withDigital("Abe", -30, {})], now, ["US"]).map((s) => s.item.title), ["Abe", "Zed"]);
  const gone = streamingStatuses([withDigital("G", -30, { IN: -2 })], now, ["IN"])[0];
  assert.deepEqual([gone.state, gone.date, gone.region], ["since", iso(-2), "IN"]);
});

test("a new season of a finished series shows up only when asked to, and only if it really is a new season", () => {
  const back = show("Back", 3, { status: "done", seasonsAtFinish: 1 });
  const tail = show("Tail", 3, { status: "done", seasonsAtFinish: 2 });
  const unknown = show("Unknown", 3, { status: "done" });
  const dropped = show("Dropped", 3, { status: "dropped", seasonsAtFinish: 1 });
  const airing = show("Airing", 5);
  const items = [back, tail, unknown, dropped, airing];
  assert.deepEqual(comingUp(items, now).map((e) => e.item.title), ["Airing"], "off by default: as before");
  const on = comingUp(items, now, 14, ["US"], { newSeasons: true });
  assert.deepEqual(on.map((e) => e.item.title), ["Back", "Airing"]);
  assert.equal(on[0].newSeason, true);
  assert.equal(on[0].label, "S2 E6");
  assert.equal(on[1].newSeason, undefined);
});
