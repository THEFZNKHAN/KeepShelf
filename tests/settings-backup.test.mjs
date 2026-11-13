import { test } from "node:test";
import assert from "node:assert/strict";
import { PREF_CHOICES, collectSettings, describeSettings, sanitizeSettings } from "../dist-test/settings-backup.js";
import { buildBackup, parseImportFile, settingsFromBackupJson } from "../dist-test/import.js";

// Fake values only.
const FAKE_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.c2lnbmF0dXJl";
const LONG_ID = "1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v";
const keep = { mediaEnabled: true, booksEnabled: false, tabsEnabled: false, mediaNoteUrl: `https://keep.google.com/#LIST/${LONG_ID}` };
const site = { host: "player.example", template: "https://player.example/title/{imdb_id}", typeWords: {} };
const source = {
  tmdbToken: FAKE_JWT,
  keep,
  watchSites: [site],
  remindersEnabled: true,
  bookInfoEnabled: false,
  prefs: { "keepshelf.askRating": "off", "keepshelf.startMode": "remember", "keepshelf.defaultView": "all" },
};

test("collects every setting that is set", () => {
  const s = collectSettings(source, { includeToken: true });
  assert.equal(s.tmdbToken, FAKE_JWT);
  assert.equal(s.keep.mediaEnabled, true);
  assert.equal(s.keep.mediaNoteId, LONG_ID);
  assert.deepEqual(s.watchSites, [site]);
  assert.equal(s.remindersEnabled, true);
  assert.equal(s.bookInfoEnabled, false);
  assert.deepEqual(s.prefs, source.prefs);
});

test("the TMDB token is left out unless asked for", () => {
  const s = collectSettings(source, { includeToken: false });
  assert.equal("tmdbToken" in s, false);
  assert.equal(JSON.stringify(s).includes(FAKE_JWT), false);
  assert.equal(s.watchSites.length, 1);
});

test("nothing set means no settings at all", () => {
  assert.equal(collectSettings({}, { includeToken: true }), undefined);
  assert.equal(collectSettings({ keep: { mediaEnabled: false, booksEnabled: false, tabsEnabled: false }, watchSites: [], prefs: {} }, { includeToken: true }), undefined);
  assert.equal(sanitizeSettings(undefined), undefined);
  assert.equal(sanitizeSettings(null), undefined);
  assert.equal(sanitizeSettings("x"), undefined);
  assert.equal(sanitizeSettings([]), undefined);
  assert.equal(sanitizeSettings({}), undefined);
});

test("only values the app would accept survive", () => {
  const s = sanitizeSettings({
    tmdbToken: "not-a-token",
    keep: { mediaEnabled: "yes", mediaNoteUrl: "https://example.com/nope" },
    watchSites: [{ template: "https://x.example/nothing", typeWords: {} }, "junk", null],
    remindersEnabled: "true",
    bookInfoEnabled: 1,
    prefs: { "keepshelf.askRating": "maybe", "keepshelf.startMode": "remember", "other.key": "on", "keepshelf.defaultView": 5 },
    extra: { anything: true },
  });
  // A Keep note address that isn't a Keep link still counts as a link the user typed; it just has no note id.
  assert.equal(s.tmdbToken, undefined);
  assert.equal(s.watchSites, undefined);
  assert.equal(s.remindersEnabled, undefined);
  assert.equal(s.bookInfoEnabled, undefined);
  assert.deepEqual(s.prefs, { "keepshelf.startMode": "remember" });
  assert.equal("extra" in s, false);
});

test("a damaged Keep entry can't smuggle in unknown fields", () => {
  const s = sanitizeSettings({ keep: { ...keep, evil: "x", mediaNoteId: "forged" } });
  assert.equal("evil" in s.keep, false);
  // The note id always comes from the address, never from the file.
  assert.equal(s.keep.mediaNoteId, LONG_ID);
});

test("preferences are limited to the known list", () => {
  assert.deepEqual(Object.keys(PREF_CHOICES).sort(), ["keepshelf.askRating", "keepshelf.defaultView", "keepshelf.searchOnline", "keepshelf.startMode"]);
  assert.equal(sanitizeSettings({ prefs: { "keepshelf.status": "all", "keepshelf.dismissedDuplicates": "[]" } }), undefined);
});

test("describeSettings says what is inside, in plain words", () => {
  assert.deepEqual(describeSettings(collectSettings(source, { includeToken: true })), [
    "your TMDB token", "your Keep links", "1 watch site", "your switches and preferences",
  ]);
  assert.deepEqual(describeSettings({ watchSites: [site, { ...site, host: "b.example", template: "https://b.example/{imdb_id}" }] }), ["2 watch sites"]);
  assert.deepEqual(describeSettings({ remindersEnabled: false }), ["your switches and preferences"]);
  assert.deepEqual(describeSettings({}), []);
});

test("a backup carries settings and gives them back", () => {
  const items = [{ id: "1", title: "Heat", type: "movie", year: "1995", subtitle: "", googleQuery: "Heat 1995", savedAt: 1, sourceUrl: "" }];
  const settings = collectSettings(source, { includeToken: true });
  const text = buildBackup(items, settings);
  assert.deepEqual(settingsFromBackupJson(text), settings);
  // The items come through exactly as before.
  const parsed = parseImportFile(text, "backup.json");
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].title, "Heat");
});

test("a backup without settings still works, and says it has none", () => {
  const text = buildBackup([]);
  assert.equal("settings" in JSON.parse(text), false);
  assert.equal(settingsFromBackupJson(text), undefined);
  assert.equal(settingsFromBackupJson("not json"), undefined);
  assert.equal(settingsFromBackupJson('{"items": []}'), undefined);
  assert.equal(settingsFromBackupJson("[1,2]"), undefined);
});

test("settings in a file are checked again when read back", () => {
  const forged = JSON.stringify({ app: "KeepShelf", version: 1, items: [], settings: { tmdbToken: "bad", prefs: { "keepshelf.askRating": "off", "x": "y" } } });
  assert.deepEqual(settingsFromBackupJson(forged), { prefs: { "keepshelf.askRating": "off" } });
});
