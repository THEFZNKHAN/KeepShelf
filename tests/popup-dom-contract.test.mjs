// popup.ts looks up its elements by id with a non-null assertion, so one missing id throws and the whole popup
// goes blank. These checks keep popup.html and popup.ts in step through any redesign.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../src/popup/popup.html", import.meta.url), "utf8");
const doc = new JSDOM(html).window.document;
const sources = ["popup.ts", "stats-view.ts", "tag-picker.ts"].map((name) =>
  readFileSync(new URL(`../src/popup/${name}`, import.meta.url), "utf8")
);
const ts = sources.join("\n");

test("every id popup.ts looks up exists exactly once in popup.html", () => {
  const ids = new Set([...ts.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]));
  assert.ok(ids.size > 100, "expected the popup to look up many elements");
  const missing = [];
  const repeated = [];
  for (const id of ids) {
    const count = doc.querySelectorAll(`[id="${id}"]`).length;
    if (count === 0) missing.push(id);
    if (count > 1) repeated.push(id);
  }
  assert.deepEqual(missing, [], `ids missing from popup.html: ${missing.join(", ")}`);
  assert.deepEqual(repeated, [], `ids used more than once: ${repeated.join(", ")}`);
});

test("no id appears twice in popup.html", () => {
  const seen = new Map();
  for (const el of doc.querySelectorAll("[id]")) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  assert.deepEqual(dupes, []);
});

test("each dialog keeps the backdrop that closes it", () => {
  for (const [dialog, attr] of [
    ["status-dialog", "data-status-dismiss"],
    ["confirm-dialog", "data-confirm-dismiss"],
    ["pick-dialog", "data-pick-dismiss"],
    ["rate-dialog", "data-rate-dismiss"],
    ["edit-dialog", "data-edit-dismiss"],
  ]) {
    assert.ok(doc.querySelector(`#${dialog} [${attr}]`), `#${dialog} has no [${attr}]`);
  }
});

test("selectors popup.ts queries inside the markup still match", () => {
  const shelfTabs = doc.getElementById("shelf-tabs");
  for (const tab of ["media", "books", "tabs"]) {
    assert.ok(shelfTabs.querySelector(`.shelf-tab[data-tab="${tab}"]`), `shelf tab ${tab}`);
    assert.ok(shelfTabs.querySelector(`[data-count="${tab}"]`), `count for ${tab}`);
  }
  for (const filter of ["all", "movie", "series", "anime"]) {
    assert.ok(doc.querySelector(`#filters .filter[data-filter="${filter}"]`), `type filter ${filter}`);
  }
  assert.ok(doc.querySelectorAll("#settings-view details.s-card").length >= 9, "settings cards");
  assert.ok(doc.querySelector("#pick-dialog .pick-panel"), "pick panel");
  assert.ok(doc.querySelector("#filter-empty p"), "filter-empty text");
});

test("the popup loads no fonts or styles from the network", () => {
  const external = [...doc.querySelectorAll("link[href], script[src]")]
    .map((el) => el.getAttribute("href") ?? el.getAttribute("src"))
    .filter((url) => /^https?:/.test(url));
  assert.deepEqual(external, []);
  const css = readdirSync(new URL("../src/popup/styles/", import.meta.url))
    .map((name) => readFileSync(new URL(`../src/popup/styles/${name}`, import.meta.url), "utf8"))
    .join("\n");
  assert.doesNotMatch(css, /url\(\s*["']?https?:/);
  assert.doesNotMatch(css, /@import/);
});
