import { test } from "node:test";
import assert from "node:assert/strict";
import { THEME_KEY, applyTheme, normalizeTheme, readTheme } from "../dist-test/theme.js";

test("known choices are kept, anything else follows the system", () => {
  assert.equal(normalizeTheme("light"), "light");
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(normalizeTheme("system"), "system");
  assert.equal(normalizeTheme("sepia"), "system");
  assert.equal(normalizeTheme(null), "system");
});

test("reading the stored theme survives storage that throws", () => {
  assert.equal(readTheme({ getItem: (k) => (k === THEME_KEY ? "dark" : null) }), "dark");
  assert.equal(readTheme({ getItem: () => { throw new Error("blocked"); } }), "system");
  assert.equal(readTheme(undefined), "system");
});

test("the root element carries the theme only when one is forced", () => {
  const root = { dataset: {} };
  applyTheme(root, "dark");
  assert.equal(root.dataset.theme, "dark");
  applyTheme(root, "system");
  assert.equal("theme" in root.dataset, false);
});
