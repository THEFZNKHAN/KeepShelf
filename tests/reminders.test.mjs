import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysUntil, describeReminders, dueReminders, needsDateRefresh, pruneNotified, reminderKey, selectForRefresh, upcoming,
} from "../dist-test/reminders.js";

// A fixed "now": 10 Nov 2026, 15:30 local time.
const NOW = new Date(2026, 10, 10, 15, 30).getTime();
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays) => {
  const d = new Date(2026, 10, 10 + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const show = (id, offset, extra = {}) => ({
  id, title: id, type: "series", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1,
  tmdb: { id: 1, kind: "tv", genres: [], fetchedAt: NOW, status: "Returning Series", nextEpisode: { airDate: iso(offset), season: 2, episode: 5 } },
  ...extra,
});
const film = (id, offset, extra = {}) => ({
  id, title: id, type: "movie", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1,
  tmdb: { id: 2, kind: "movie", genres: [], fetchedAt: NOW, releaseDate: iso(offset) },
  ...extra,
});

test("daysUntil counts calendar days in local time, whatever the hour", () => {
  assert.equal(daysUntil(iso(0), NOW), 0);
  assert.equal(daysUntil(iso(1), NOW), 1);
  assert.equal(daysUntil(iso(-3), NOW), -3);
  assert.equal(daysUntil(iso(0), new Date(2026, 10, 10, 0, 1).getTime()), 0);
  assert.equal(daysUntil(iso(0), new Date(2026, 10, 10, 23, 59).getTime()), 0);
  assert.equal(daysUntil(iso(1), new Date(2026, 10, 10, 23, 59).getTime()), 1);
});

test("daysUntil ignores anything that isn't a plain date", () => {
  for (const bad of ["", "tomorrow", "2026-11", "2026-11-10T10:00:00Z", "10/11/2026"]) assert.equal(daysUntil(bad, NOW), undefined);
});

test("daysUntil is right across a month and year end and a leap day", () => {
  const dec31 = new Date(2026, 11, 31, 20).getTime();
  assert.equal(daysUntil("2027-01-01", dec31), 1);
  const feb28 = new Date(2028, 1, 28, 9).getTime();
  assert.equal(daysUntil("2028-02-29", feb28), 1);
  assert.equal(daysUntil("2028-03-01", feb28), 2);
});

test("upcoming reads the next episode of a series and the release of a movie", () => {
  assert.deepEqual(upcoming(show("a", 2)), { date: iso(2), label: "S2 E5" });
  assert.deepEqual(upcoming(film("b", 2)), { date: iso(2), label: "release" });
  assert.equal(upcoming({ ...show("c", 2), tmdb: undefined }), undefined);
  assert.equal(upcoming({ ...show("c", 2), tmdb: { ...show("c", 2).tmdb, nextEpisode: undefined } }), undefined);
});

test("dueReminders picks today and tomorrow, and nothing further out or in the past", () => {
  const items = [show("today", 0), show("tomorrow", 1), show("later", 2), show("past", -1), film("filmToday", 0), film("filmLater", 30)];
  const due = dueReminders(items, NOW, {});
  assert.deepEqual(due.map((d) => d.item.id), ["filmToday", "today", "tomorrow"]);
  assert.deepEqual(due.map((d) => d.days), [0, 0, 1]);
  assert.equal(due[1].label, "S2 E5");
});

test("dueReminders skips finished and dropped items, and items without dates", () => {
  const items = [
    show("done", 0, { status: "done", done: true }),
    show("dropped", 0, { status: "dropped" }),
    show("watching", 0, { status: "in_progress" }),
    show("nodate", 0, { tmdb: { id: 1, kind: "tv", genres: [], fetchedAt: NOW } }),
    { id: "tab", title: "t", type: "tab", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1 },
  ];
  assert.deepEqual(dueReminders(items, NOW, {}).map((d) => d.item.id), ["watching"]);
});

test("dueReminders announces each release once, but a new episode of the same show again", () => {
  const a = show("a", 0);
  const first = dueReminders([a], NOW, {});
  assert.equal(first.length, 1);
  assert.equal(first[0].key, reminderKey(a, iso(0)));
  const notified = { [first[0].key]: first[0].date };
  assert.deepEqual(dueReminders([a], NOW, notified), []);
  const nextWeek = show("a", 0, { tmdb: { ...a.tmdb, nextEpisode: { airDate: iso(1), season: 2, episode: 6 } } });
  assert.equal(dueReminders([nextWeek], NOW, notified).length, 1);
});

test("pruneNotified drops old records and anything malformed, and keeps recent and future ones", () => {
  const pruned = pruneNotified(
    { old: iso(-30), recent: iso(-3), future: iso(5), broken: "nope", wrong: 5 },
    NOW
  );
  assert.deepEqual(Object.keys(pruned).sort(), ["future", "recent"]);
});

test("needsDateRefresh only asks for airing series whose next date is missing or past, and unreleased movies", () => {
  const old = NOW - 8 * DAY;
  const stale = (item) => ({ ...item, tmdb: { ...item.tmdb, fetchedAt: old } });
  assert.equal(needsDateRefresh(stale(show("a", -2)), NOW), true, "next episode already aired");
  assert.equal(needsDateRefresh(stale(show("a", 5)), NOW), false, "date is still ahead");
  assert.equal(needsDateRefresh(show("a", -2), NOW), false, "fetched today");
  const noDate = stale(show("a", 0));
  noDate.tmdb.nextEpisode = undefined;
  assert.equal(needsDateRefresh(noDate, NOW), true, "between seasons, look again");
  const ended = stale(show("a", -2));
  ended.tmdb.status = "Ended";
  assert.equal(needsDateRefresh(ended, NOW), false);
  assert.equal(needsDateRefresh(stale(film("f", 20)), NOW), true, "release date may have moved");
  assert.equal(needsDateRefresh(stale(film("f", -20)), NOW), false, "already out");
  assert.equal(needsDateRefresh(stale(show("a", -2, { status: "done" })), NOW), false);
  assert.equal(needsDateRefresh({ ...show("a", -2), tmdb: undefined }, NOW), false);
});

test("selectForRefresh is capped", () => {
  const items = Array.from({ length: 40 }, (_, n) => ({ ...show(`s${n}`, -2), tmdb: { ...show("x", -2).tmdb, fetchedAt: NOW - 9 * DAY } }));
  assert.equal(selectForRefresh(items, NOW).length, 25);
  assert.equal(selectForRefresh(items, NOW, 3).length, 3);
});

test("describeReminders words one release by itself and several as a list", () => {
  const one = describeReminders(dueReminders([show("Severance", 1)], NOW, {}));
  assert.equal(one.title, "Coming up on your shelf");
  assert.equal(one.message, "Severance: S2 E5 tomorrow");
  const many = describeReminders(dueReminders([show("Severance", 1), film("Dune", 0)], NOW, {}));
  assert.equal(many.title, "2 things coming up on your shelf");
  assert.equal(many.message, "Dune: out today\nSeverance: S2 E5 tomorrow");
});
