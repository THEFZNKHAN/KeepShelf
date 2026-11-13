import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysUntil, describeReminders, dueReminders, isNewSeason, needsDateRefresh, needsSeasonRecord, pruneNotified, reminderKey, selectForRefresh, upcoming,
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
  assert.equal(needsDateRefresh(stale(film("f", -200)), NOW), false, "out long ago");
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

test("forcing a check skips the once-a-week rule, but only for titles that could have a new date", () => {
  const noDate = show("a", 0);
  noDate.tmdb.nextEpisode = undefined;
  assert.equal(needsDateRefresh(noDate, NOW), false, "looked up today, so not again by itself");
  assert.equal(needsDateRefresh(noDate, NOW, true), true, "the user asked to check now");
  assert.equal(needsDateRefresh(show("a", -2), NOW, true), true, "date passed");
  assert.equal(needsDateRefresh(show("a", 5), NOW, true), false, "a date still ahead needs no look");
  const ended = show("a", -2);
  ended.tmdb.status = "Ended";
  assert.equal(needsDateRefresh(ended, NOW, true), false, "ended shows have no next date");
  assert.equal(needsDateRefresh(show("a", -2, { status: "done" }), NOW, true), false, "finished titles are left alone");
  const items = Array.from({ length: 40 }, (_, n) => show(`s${n}`, -2));
  assert.equal(selectForRefresh(items, NOW).length, 0);
  assert.equal(selectForRefresh(items, NOW, 25, true).length, 25);
});

test("a movie that is already out is looked at again until its streaming date has passed", () => {
  const out = (offset, digital) => {
    const f = film("f", offset);
    f.tmdb.fetchedAt = NOW - 8 * DAY;
    if (digital !== undefined) f.tmdb.digitalDates = digital;
    return f;
  };
  const day = (offset) => iso(offset);
  assert.equal(needsDateRefresh(out(-20), NOW), true, "saved before streaming dates were kept");
  assert.equal(needsDateRefresh(out(-20, {}), NOW), true, "checked, but TMDB had none yet");
  assert.equal(needsDateRefresh(out(-20, { US: day(10) }), NOW), true, "streaming date still ahead, which can move");
  assert.equal(needsDateRefresh(out(-20, { US: day(-3), IN: day(-1) }), NOW), false, "already on streaming everywhere known");
  assert.equal(needsDateRefresh(out(-20, { US: day(-3), IN: day(12) }), NOW), true, "one country still to come");
  assert.equal(needsDateRefresh(out(-151), NOW), false, "out for too long to keep asking");
  assert.equal(needsDateRefresh(out(-150), NOW), true);
  const fresh = out(-20); fresh.tmdb.fetchedAt = NOW - DAY;
  assert.equal(needsDateRefresh(fresh, NOW), false, "looked up this week already");
  assert.equal(needsDateRefresh(fresh, NOW, true), true, "unless the user asked to check now");
  const watched = out(-20); watched.status = "done"; watched.done = true;
  assert.equal(needsDateRefresh(watched, NOW), false, "finished titles are left alone");
});

// A finished series whose next episode is season 2 episode 5 (see show()), having been finished after season N.
const finished = (id, offset, seasonsAtFinish, extra = {}) => show(id, offset, { status: "done", ...(seasonsAtFinish === undefined ? {} : { seasonsAtFinish }), ...extra });

test("isNewSeason: a finished series with a season it didn't have when it was finished", () => {
  assert.equal(isNewSeason(finished("a", 1, 1)), true, "finished after 1 season, season 2 is coming");
  assert.equal(isNewSeason(finished("a", 1, 2)), false, "the tail of a season it had already finished");
  assert.equal(isNewSeason(finished("a", 1, 3)), false);
  assert.equal(isNewSeason(finished("a", 1)), false, "no record of how many seasons it had: nothing to compare with");
  assert.equal(isNewSeason(show("a", 1, { seasonsAtFinish: 1 })), false, "not finished");
  assert.equal(isNewSeason(show("a", 1, { status: "dropped", seasonsAtFinish: 1 })), false);
  assert.equal(isNewSeason(film("f", 1, { status: "done", seasonsAtFinish: 1 })), false, "films have no seasons");
  const noNext = finished("a", 1, 1);
  noNext.tmdb.nextEpisode = undefined;
  assert.equal(isNewSeason(noNext), false, "nothing announced yet");
  assert.equal(isNewSeason({ ...finished("a", 1, 1), tmdb: undefined }), false);
});

test("dueReminders announces a new season of a finished series only when asked to", () => {
  const items = [finished("back", 1, 1), finished("same", 1, 2), finished("unknown", 1), show("airing", 1)];
  assert.deepEqual(dueReminders(items, NOW, {}).map((d) => d.item.id), ["airing"], "off by default: as before");
  const on = dueReminders(items, NOW, {}, undefined, { newSeasons: true });
  assert.deepEqual(on.map((d) => d.item.id).sort(), ["airing", "back"]);
  assert.equal(on.find((d) => d.item.id === "back").newSeason, true);
  assert.equal(on.find((d) => d.item.id === "airing").newSeason, undefined);
});

test("a new season is announced once, and its date works like any other", () => {
  const back = finished("back", 0, 1);
  const first = dueReminders([back], NOW, {}, undefined, { newSeasons: true });
  assert.equal(first.length, 1);
  assert.equal(first[0].days, 0);
  assert.deepEqual(dueReminders([back], NOW, { [first[0].key]: first[0].date }, undefined, { newSeasons: true }), []);
  assert.deepEqual(dueReminders([finished("far", 30, 1)], NOW, {}, undefined, { newSeasons: true }), [], "not yet within the window");
  assert.deepEqual(dueReminders([finished("past", -1, 1)], NOW, {}, undefined, { newSeasons: true }), []);
});

test("dropped titles never remind, even with new seasons on", () => {
  const dropped = show("d", 1, { status: "dropped", seasonsAtFinish: 1 });
  assert.deepEqual(dueReminders([dropped], NOW, {}, undefined, { newSeasons: true }), []);
});

test("describeReminders says it is a new season", () => {
  const due = dueReminders([finished("Severance", 1, 1)], NOW, {}, undefined, { newSeasons: true });
  assert.equal(describeReminders(due).message, "Severance: new season, S2 E5 tomorrow");
  const mixed = describeReminders(dueReminders([finished("Severance", 1, 1), film("Dune", 0)], NOW, {}, undefined, { newSeasons: true }));
  assert.equal(mixed.message, "Dune: out today\nSeverance: new season, S2 E5 tomorrow");
});

test("finished series are looked up for dates only when new seasons are on, and only while they may return", () => {
  const old = NOW - 8 * DAY;
  const stale = (item) => ({ ...item, tmdb: { ...item.tmdb, fetchedAt: old } });
  const gone = stale(finished("g", 5, 1));
  gone.tmdb.nextEpisode = undefined;
  assert.equal(needsDateRefresh(gone, NOW), false, "off: finished shows are left alone");
  assert.equal(needsDateRefresh(gone, NOW, false, { newSeasons: true }), true, "between seasons, look again");
  const ended = stale(finished("e", 5, 1));
  ended.tmdb.nextEpisode = undefined;
  ended.tmdb.status = "Ended";
  assert.equal(needsDateRefresh(ended, NOW, false, { newSeasons: true }), false, "an ended show won't have a new season");
  const cancelled = { ...ended, tmdb: { ...ended.tmdb, status: "Canceled" } };
  assert.equal(needsDateRefresh(cancelled, NOW, false, { newSeasons: true }), false);
  assert.equal(needsDateRefresh(stale(finished("future", 5, 1)), NOW, false, { newSeasons: true }), false, "a date still ahead needs no look");
  assert.equal(needsDateRefresh(stale(show("d", -2, { status: "dropped" })), NOW, false, { newSeasons: true }), false, "dropped stays out");
  const recent = finished("r", 5, 1);
  recent.tmdb.nextEpisode = undefined;
  assert.equal(needsDateRefresh(recent, NOW, false, { newSeasons: true }), false, "looked up this week already");
  assert.equal(needsDateRefresh(recent, NOW, true, { newSeasons: true }), true, "unless asked to check now");
  assert.equal(needsDateRefresh(stale(finished("m", 5, 1, { tmdb: undefined })), NOW, false, { newSeasons: true }), false);
});

test("selectForRefresh looks at what is airing before finished series when the cap is tight", () => {
  const old = NOW - 9 * DAY;
  const missingDate = (item) => {
    const copy = { ...item, tmdb: { ...item.tmdb, fetchedAt: old, nextEpisode: undefined } };
    return copy;
  };
  const items = [
    ...Array.from({ length: 5 }, (_, n) => missingDate(finished(`done${n}`, 5, 1))),
    missingDate(show("airing", 5)),
  ];
  assert.deepEqual(selectForRefresh(items, NOW, 3, false, { newSeasons: true }).map((i) => i.id), ["airing", "done0", "done1"]);
  assert.deepEqual(selectForRefresh(items, NOW, 10, false).map((i) => i.id), ["airing"], "finished ones only when asked");
});

test("needsSeasonRecord: a finished series with TMDB info but no record of its seasons", () => {
  const tv = (extra) => ({ ...show("a", 1, { status: "done", ...extra }), tmdb: { ...show("a", 1).tmdb, seasons: 3 } });
  assert.equal(needsSeasonRecord(tv({})), true);
  assert.equal(needsSeasonRecord(tv({ seasonsAtFinish: 2 })), false, "already recorded");
  assert.equal(needsSeasonRecord({ ...tv({}), status: "in_progress" }), false);
  assert.equal(needsSeasonRecord({ ...tv({}), tmdb: { ...tv({}).tmdb, seasons: undefined, nextEpisode: undefined } }), false, "nothing to record yet");
  assert.equal(needsSeasonRecord({ ...tv({}), tmdb: { ...tv({}).tmdb, kind: "movie" } }), false);
  assert.equal(needsSeasonRecord({ ...tv({}), tmdb: undefined }), false);
});
