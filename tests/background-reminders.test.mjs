import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

// A fake chrome: real storage, capturable alarms and notifications, everything else quietly does nothing.
const store = {};
let onMessage, onAlarm, onNotificationClick;
const alarms = new Map();
const calls = { alarmCreate: [], alarmClear: [], notifications: [], tabs: [], cleared: [] };
let notificationFails = false;
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
globalThis.chrome = new Proxy({}, {
  get(_, key) {
    if (key === "storage") {
      return {
        local: {
          get: async (k) => (typeof k === "string" ? { [k]: store[k] } : { ...store }),
          set: async (v) => { Object.assign(store, JSON.parse(JSON.stringify(v))); },
          remove: async (k) => { delete store[k]; },
        },
        onChanged: { addListener() {} },
      };
    }
    if (key === "runtime") return { onMessage: { addListener: (fn) => { onMessage = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, getURL: (p) => `chrome-extension://fake/${p}` };
    if (key === "alarms") {
      return {
        onAlarm: { addListener: (fn) => { onAlarm = fn; } },
        get: async (name) => alarms.get(name),
        create: (name, info) => { alarms.set(name, info); calls.alarmCreate.push({ name, info }); },
        clear: async (name) => { alarms.delete(name); calls.alarmClear.push(name); return true; },
      };
    }
    if (key === "notifications") {
      return {
        onClicked: { addListener: (fn) => { onNotificationClick = fn; } },
        create: async (id, options) => { if (notificationFails) throw new Error("blocked"); calls.notifications.push({ id, options }); return id; },
        clear: async (id) => { calls.cleared.push(id); return true; },
      };
    }
    if (key === "tabs") return { create: async (o) => { calls.tabs.push(o); }, query: async () => [], onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
    return noop;
  },
});

const fetched = [];
let fetchBehaviour = "ok";
let nextOnRefresh;
globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.hostname !== "api.themoviedb.org") throw new Error("unexpected host " + u.hostname);
  fetched.push(u.pathname);
  if (fetchBehaviour === "down") throw new Error("network down");
  const id = Number(u.pathname.split("/").pop());
  return { ok: true, status: 200, json: async () => ({ id, genres: [], status: "Returning Series", next_episode_to_air: nextOnRefresh }) };
};

const send = (message) => new Promise((resolve) => { onMessage(message, {}, resolve); });
/** Fires the alarm, then waits for the queued work (a serial no-op runs after it). */
const fireAlarm = async (name = "keepshelf-reminders") => { onAlarm({ name }); await send({ action: "delete", ids: [] }); };
const FAKE_KEY = "0123456789abcdef0123456789abcdef";
const iso = (offset) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const DAY = 24 * 60 * 60 * 1000;
const base = { subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1 };
const show = (id, offset, extra = {}) => ({ ...base, id, title: id, type: "series", tmdb: { id: 100 + id.length, kind: "tv", genres: [], fetchedAt: Date.now(), status: "Returning Series", nextEpisode: { airDate: iso(offset), season: 3, episode: 4 } }, ...extra });
const film = (id, offset) => ({ ...base, id, title: id, type: "movie", tmdb: { id: 900, kind: "movie", genres: [], fetchedAt: Date.now(), releaseDate: iso(offset) } });

before(async () => { await import("../dist-test/background-main.js"); });
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  alarms.clear();
  for (const list of Object.values(calls)) list.length = 0;
  fetched.length = 0;
  fetchBehaviour = "ok"; nextOnRefresh = undefined; notificationFails = false;
});

test("reminders are off by default: no alarm work, no notification, no request", async () => {
  store.trackbuddy_items = [show("Severance", 0)];
  assert.equal((await send({ action: "getReminderSettings" })).reminders.enabled, false);
  await fireAlarm();
  assert.equal(calls.notifications.length, 0);
  assert.equal(fetched.length, 0);
  const manual = await send({ action: "checkReminders" });
  assert.equal(manual.ok, false);
  assert.match(manual.error, /Turn on release reminders/);
});

test("turning it on creates a repeating alarm once, and turning it off removes it", async () => {
  const on = await send({ action: "setRemindersEnabled", enabled: true });
  assert.equal(on.reminders.enabled, true);
  assert.equal(calls.alarmCreate.length, 1);
  assert.equal(calls.alarmCreate[0].name, "keepshelf-reminders");
  assert.equal(calls.alarmCreate[0].info.periodInMinutes, 360);
  await send({ action: "setRemindersEnabled", enabled: true });
  assert.equal(calls.alarmCreate.length, 1, "an existing alarm is kept, not duplicated");
  const off = await send({ action: "setRemindersEnabled", enabled: false });
  assert.equal(off.reminders.enabled, false);
  assert.ok(calls.alarmClear.includes("keepshelf-reminders"));
  assert.equal(alarms.size, 0);
});

test("the alarm announces what is out today or tomorrow in one notification, then stays quiet", async () => {
  store.keepshelf_tmdb_token = FAKE_KEY;
  store.trackbuddy_items = [
    show("Severance", 1), film("Dune", 0), show("Later", 5), show("Finished", 1, { status: "done", done: true }), show("Aired", -2),
  ];
  await send({ action: "setRemindersEnabled", enabled: true });
  await fireAlarm();
  assert.equal(calls.notifications.length, 1);
  const { options } = calls.notifications[0];
  assert.equal(options.title, "2 things coming up on your shelf");
  assert.equal(options.message, "Dune: out today\nSeverance: S3 E4 tomorrow");
  assert.equal(options.type, "basic");
  assert.match(options.iconUrl, /icons\/icon128\.png$/);
  assert.deepEqual(fetched, [], "fresh data needs no requests");

  await fireAlarm();
  assert.equal(calls.notifications.length, 1, "the same releases are not announced twice");
  assert.equal(Object.keys(store.keepshelf_reminders_notified).length, 2);
});

test("an alarm with another name is ignored", async () => {
  store.trackbuddy_items = [show("Severance", 0)];
  await send({ action: "setRemindersEnabled", enabled: true });
  await fireAlarm("something-else");
  assert.equal(calls.notifications.length, 0);
});

test("'Check now' reports what it did and respects the once-only rule", async () => {
  store.trackbuddy_items = [show("Severance", 0)];
  await send({ action: "setRemindersEnabled", enabled: true });
  const first = await send({ action: "checkReminders" });
  assert.equal(first.message, "Reminded you about 1 release.");
  const second = await send({ action: "checkReminders" });
  assert.equal(second.message, "Nothing is coming out today or tomorrow.");
  assert.equal(calls.notifications.length, 1);
});

test("without a token nothing is requested, but dates already saved still produce reminders", async () => {
  store.trackbuddy_items = [
    show("Severance", 0),
    show("Stale", -3, { tmdb: { ...show("Stale", -3).tmdb, fetchedAt: Date.now() - 9 * DAY } }),
  ];
  await send({ action: "setRemindersEnabled", enabled: true });
  await fireAlarm();
  assert.deepEqual(fetched, []);
  assert.equal(calls.notifications.length, 1);
});

test("a stale series gets its next date refreshed, and is announced if the new date is close", async () => {
  store.keepshelf_tmdb_token = FAKE_KEY;
  store.trackbuddy_items = [show("Stale", -3, { tmdb: { ...show("Stale", -3).tmdb, fetchedAt: Date.now() - 9 * DAY } })];
  nextOnRefresh = { air_date: iso(1), season_number: 3, episode_number: 5 };
  await send({ action: "setRemindersEnabled", enabled: true });
  await fireAlarm();
  assert.equal(fetched.length, 1);
  assert.equal(calls.notifications.length, 1);
  assert.equal(calls.notifications[0].options.message, "Stale: S3 E5 tomorrow");
  const saved = (await send({ action: "getAll" })).items[0];
  assert.deepEqual(saved.tmdb.nextEpisode, { airDate: iso(1), season: 3, episode: 5 });
  assert.ok(Date.now() - saved.tmdb.fetchedAt < 60000, "the refreshed data is dated now, so retention rules still hold");
});

test("if TMDB is unreachable the check still announces from saved dates and doesn't throw", async () => {
  store.keepshelf_tmdb_token = FAKE_KEY;
  store.trackbuddy_items = [
    show("Stale", -3, { tmdb: { ...show("Stale", -3).tmdb, fetchedAt: Date.now() - 9 * DAY } }),
    show("Severance", 0),
  ];
  fetchBehaviour = "down";
  await send({ action: "setRemindersEnabled", enabled: true });
  await fireAlarm();
  assert.equal(fetched.length, 1);
  assert.equal(calls.notifications.length, 1);
  assert.equal(calls.notifications[0].options.message, "Severance: S3 E4 today");
});

test("if the notification can't be shown nothing is marked as announced, so the next check tries again", async () => {
  store.trackbuddy_items = [show("Severance", 0)];
  await send({ action: "setRemindersEnabled", enabled: true });
  notificationFails = true;
  await fireAlarm();
  assert.equal(store.keepshelf_reminders_notified, undefined);
  notificationFails = false;
  await fireAlarm();
  assert.equal(calls.notifications.length, 1);
});

test("clicking a reminder opens KeepShelf and dismisses it; other notifications are ignored", async () => {
  onNotificationClick("keepshelf-reminder-123");
  assert.deepEqual(calls.tabs, [{ url: "chrome-extension://fake/dist/popup.html" }]);
  assert.deepEqual(calls.cleared, ["keepshelf-reminder-123"]);
  onNotificationClick("someone-elses");
  assert.equal(calls.tabs.length, 1);
});

test("old announcement records are cleaned up when the check runs", async () => {
  store.trackbuddy_items = [show("Severance", 0)];
  store.keepshelf_reminders_notified = { "gone:2020-01-01": "2020-01-01" };
  await send({ action: "setRemindersEnabled", enabled: true });
  await fireAlarm();
  assert.deepEqual(Object.keys(store.keepshelf_reminders_notified).sort(), [`Severance:${iso(0)}`]);
});

test("refreshDates quietly refreshes stale dates, even with reminders off, and never notifies", async () => {
  store.keepshelf_tmdb_token = FAKE_KEY;
  const stale = show("Severance", -2);
  stale.tmdb.fetchedAt = Date.now() - 10 * DAY;
  const fresh = show("Fresh", -2);
  store.trackbuddy_items = [stale, fresh];
  nextOnRefresh = { air_date: iso(4), season_number: 4, episode_number: 1 };
  assert.equal((await send({ action: "getReminderSettings" })).reminders.enabled, false);

  const response = await send({ action: "refreshDates" });
  assert.equal(response.ok, true);
  assert.equal(fetched.length, 1, "only the stale title is requested");
  const updated = response.items.find((i) => i.id === "Severance");
  assert.equal(updated.tmdb.nextEpisode.airDate, iso(4));
  assert.equal(updated.tmdb.nextEpisode.season, 4);
  assert.equal(response.items.find((i) => i.id === "Fresh").tmdb.nextEpisode.airDate, iso(-2), "fresh data is left alone");
  assert.equal(calls.notifications.length, 0, "refreshing never announces anything");
});

test("refreshDates without a token, or with TMDB down, just returns the shelf", async () => {
  const stale = show("Severance", -2);
  stale.tmdb.fetchedAt = Date.now() - 10 * DAY;
  store.trackbuddy_items = [stale];
  const noToken = await send({ action: "refreshDates" });
  assert.equal(noToken.ok, true);
  assert.equal(fetched.length, 0);

  store.keepshelf_tmdb_token = FAKE_KEY;
  fetchBehaviour = "down";
  const down = await send({ action: "refreshDates" });
  assert.equal(down.ok, true);
  assert.equal(down.items[0].tmdb.nextEpisode.airDate, iso(-2), "the saved date is kept");
});

test("refreshDates with force looks again even at a title checked today, so a new date shows up", async () => {
  store.keepshelf_tmdb_token = FAKE_KEY;
  const between = show("Between seasons", 0);
  between.tmdb.nextEpisode = undefined;
  store.trackbuddy_items = [between];
  nextOnRefresh = { air_date: iso(3), season_number: 2, episode_number: 1 };

  const normal = await send({ action: "refreshDates" });
  assert.equal(fetched.length, 0, "fetched just now, so the normal check leaves it");
  assert.equal(normal.items[0].tmdb.nextEpisode, undefined);

  const forced = await send({ action: "refreshDates", force: true });
  assert.equal(fetched.length, 1);
  assert.deepEqual(forced.items[0].tmdb.nextEpisode, { airDate: iso(3), season: 2, episode: 1 });
  assert.equal(calls.notifications.length, 0);
});

// A finished series, looked up long ago, with the season it had when it was finished.
const finishedShow = (id, extra = {}) => ({
  ...show(id, 0, { status: "done", done: true, ...extra }),
  tmdb: { id: 321, kind: "tv", genres: [], fetchedAt: Date.now() - 9 * DAY, status: "Returning Series", seasons: 2, ...(extra.tmdb ?? {}) },
});
const tomorrowSeason = (season) => ({ air_date: iso(1), season_number: season, episode_number: 1 });

test("a new season of a finished series is announced as one", async () => {
  store.keepshelf_tmdb_token = FAKE_KEY;
  store.trackbuddy_items = [finishedShow("Severance", { seasonsAtFinish: 2 })];
  nextOnRefresh = tomorrowSeason(3);
  await send({ action: "setRemindersEnabled", enabled: true });
  await fireAlarm();
  assert.equal(calls.notifications.length, 1);
  assert.match(calls.notifications[0].options.message, /Severance: new season, S3 E1 tomorrow/);
  await fireAlarm();
  assert.equal(calls.notifications.length, 1, "once");
});

test("the rest of a season it had already finished is not a new season", async () => {
  store.keepshelf_tmdb_token = FAKE_KEY;
  store.trackbuddy_items = [finishedShow("Severance", { seasonsAtFinish: 2 })];
  nextOnRefresh = tomorrowSeason(2);
  await send({ action: "setRemindersEnabled", enabled: true });
  await fireAlarm();
  assert.equal(calls.notifications.length, 0);
});

test("with new seasons switched off, finished series are not looked up or announced", async () => {
  store.keepshelf_tmdb_token = FAKE_KEY;
  store.trackbuddy_items = [finishedShow("Severance", { seasonsAtFinish: 2 })];
  nextOnRefresh = tomorrowSeason(3);
  await send({ action: "setRemindersEnabled", enabled: true });
  const off = await send({ action: "setNewSeasonReminders", enabled: false });
  assert.deepEqual(off.reminders, { enabled: true, newSeasons: false });
  assert.equal(store.keepshelf_reminders_new_seasons, false);
  await fireAlarm();
  assert.equal(fetched.length, 0, "no request for a finished show");
  assert.equal(calls.notifications.length, 0);
  assert.equal("seasonsAtFinish" in store.trackbuddy_items[0] && store.trackbuddy_items[0].seasonsAtFinish !== 2, false);
});

test("new seasons are on by default, and the setting is reported with the reminders", async () => {
  const before = await send({ action: "getReminderSettings" });
  assert.deepEqual(before.reminders, { enabled: false, newSeasons: true });
  await send({ action: "setNewSeasonReminders", enabled: false });
  assert.equal((await send({ action: "getReminderSettings" })).reminders.newSeasons, false);
  await send({ action: "setNewSeasonReminders", enabled: true });
  assert.equal((await send({ action: "getReminderSettings" })).reminders.newSeasons, true);
});

test("a finished series with no record of its seasons gets one from what is saved, and nothing is announced when no season is coming", async () => {
  store.keepshelf_tmdb_token = FAKE_KEY;
  const long = finishedShow("Old show", { tmdb: { seasons: 4 } });
  store.trackbuddy_items = [long, show("Airing", 5)];
  nextOnRefresh = tomorrowSeason(4);
  await send({ action: "setRemindersEnabled", enabled: true });
  await fireAlarm();
  assert.equal(store.trackbuddy_items.find((i) => i.id === "Old show").seasonsAtFinish, 4, "recorded before anything is compared");
  assert.equal(calls.notifications.length, 0, "no new season is announced for it");
  assert.equal("seasonsAtFinish" in store.trackbuddy_items.find((i) => i.id === "Airing"), false, "unfinished shows get no record");
});

test("the Coming up refresh also records seasons, without reminders being on", async () => {
  store.keepshelf_tmdb_token = FAKE_KEY;
  store.trackbuddy_items = [finishedShow("Old show", { tmdb: { seasons: 5 } })];
  nextOnRefresh = undefined;
  const res = await send({ action: "refreshDates" });
  assert.equal(res.ok, true);
  assert.equal(res.items.find((i) => i.id === "Old show").seasonsAtFinish, 5);
});

test("an Ended show is recorded but never looked up again", async () => {
  store.keepshelf_tmdb_token = FAKE_KEY;
  store.trackbuddy_items = [finishedShow("Over", { seasonsAtFinish: 2, tmdb: { status: "Ended" } })];
  await send({ action: "setRemindersEnabled", enabled: true });
  await fireAlarm();
  assert.equal(fetched.length, 0);
});

test("a season premiere already announced when a finished show is first seen is announced as new", async () => {
  store.keepshelf_tmdb_token = FAKE_KEY;
  const back = finishedShow("Returning", { tmdb: { seasons: 3, fetchedAt: Date.now() } });
  back.tmdb.nextEpisode = { airDate: iso(1), season: 3, episode: 1 };
  store.trackbuddy_items = [back];
  await send({ action: "setRemindersEnabled", enabled: true });
  await fireAlarm();
  assert.equal(store.trackbuddy_items[0].seasonsAtFinish, 2, "season 3 is the announced one, so two were finished");
  assert.equal(calls.notifications.length, 1);
  assert.match(calls.notifications[0].options.message, /Returning: new season, S3 E1 tomorrow/);
});

test("the rest of the season a finished show was in is not announced, even when first seen", async () => {
  store.keepshelf_tmdb_token = FAKE_KEY;
  const mid = finishedShow("Midseason", { tmdb: { seasons: 3, fetchedAt: Date.now() } });
  mid.tmdb.nextEpisode = { airDate: iso(1), season: 3, episode: 4 };
  store.trackbuddy_items = [mid];
  await send({ action: "setRemindersEnabled", enabled: true });
  await fireAlarm();
  assert.equal(store.trackbuddy_items[0].seasonsAtFinish, 3);
  assert.equal(calls.notifications.length, 0);
});
