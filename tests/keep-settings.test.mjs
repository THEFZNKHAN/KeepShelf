import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getKeepTargetForType,
  isLikelyValidKeepNoteId,
  normalizeKeepSettings,
  parseKeepNoteId,
} from "../dist-test/keep-settings.js";

const LONG_ID = "1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v";

test("parseKeepNoteId reads LIST and NOTE URLs", () => {
  assert.equal(parseKeepNoteId(`https://keep.google.com/u/0/#LIST/${LONG_ID}`), LONG_ID);
  assert.equal(parseKeepNoteId(`https://keep.google.com/#NOTE/${LONG_ID}?x=1`), LONG_ID);
  assert.equal(parseKeepNoteId("https://keep.google.com/"), undefined);
  assert.equal(parseKeepNoteId(""), undefined);
});

test("isLikelyValidKeepNoteId rejects short or missing ids", () => {
  assert.equal(isLikelyValidKeepNoteId(LONG_ID), true);
  assert.equal(isLikelyValidKeepNoteId("abc"), false);
  assert.equal(isLikelyValidKeepNoteId(undefined), false);
});

test("legacy enabled flag turns on media and books but not tabs", () => {
  const s = normalizeKeepSettings({ enabled: true });
  assert.equal(s.mediaEnabled, true);
  assert.equal(s.booksEnabled, true);
  assert.equal(s.tabsEnabled, false);
});

test("note ids are derived from URLs and cleared when the URL is removed", () => {
  const url = `https://keep.google.com/#LIST/${LONG_ID}`;
  const s = normalizeKeepSettings({ mediaEnabled: true, mediaNoteUrl: ` ${url} ` });
  assert.equal(s.mediaNoteUrl, url);
  assert.equal(s.mediaNoteId, LONG_ID);

  const cleared = normalizeKeepSettings({ ...s, mediaNoteUrl: "" });
  assert.equal(cleared.mediaNoteUrl, undefined);
  assert.equal(cleared.mediaNoteId, undefined);
});

test("items route to the matching Keep note only when enabled and linked", () => {
  const url = `https://keep.google.com/#LIST/${LONG_ID}`;
  const s = normalizeKeepSettings({ tabsEnabled: true, tabsNoteUrl: url, booksNoteUrl: url });
  assert.equal(getKeepTargetForType("note", s)?.target, "tabs");
  assert.equal(getKeepTargetForType("link", s)?.noteId, LONG_ID);
  assert.equal(getKeepTargetForType("book", s), null);
  assert.equal(getKeepTargetForType("movie", s), null);
});
