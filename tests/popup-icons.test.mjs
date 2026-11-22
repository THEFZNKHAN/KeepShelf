// The icon font is cut down to the names in src/popup/icon-names.txt. An icon used anywhere else would show up as
// its name in plain text, so every icon name in the popup's markup and code must be in that list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const listed = new Set(read("../src/popup/icon-names.txt").split("\n").map((l) => l.trim()).filter(Boolean));

test("every icon in popup.html is in the icon font", () => {
  const doc = new JSDOM(read("../src/popup/popup.html")).window.document;
  const names = [...doc.querySelectorAll(".material-symbols-outlined")].map((el) => el.textContent.trim()).filter(Boolean);
  assert.ok(names.length > 20);
  assert.deepEqual(names.filter((n) => !listed.has(n)), []);
});

test("every icon popup.ts draws is in the icon font", () => {
  const ts = read("../src/popup/popup.ts");
  const found = new Set();
  // Icons written into HTML strings.
  for (const m of ts.matchAll(/material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*</g)) found.add(m[1]);
  // The first argument of createRowAction, and names returned for type icons.
  for (const m of ts.matchAll(/createRowAction\(\s*(?:[^"]*\?\s*)?"([a-z0-9_]+)"(?:\s*:\s*"([a-z0-9_]+)")?/g)) {
    found.add(m[1]);
    if (m[2]) found.add(m[2]);
  }
  for (const m of ts.matchAll(/(?:case "[^"]+":|default:) return "([a-z0-9_]+)";/g)) found.add(m[1]);
  // Any other quoted name that is set as an icon's text.
  for (const m of ts.matchAll(/textContent = "([a-z0-9_]+)"/g)) found.add(m[1]);
  const looksLikeIcon = (n) => /^[a-z][a-z0-9_]+$/.test(n);
  const missing = [...found].filter(looksLikeIcon).filter((n) => !listed.has(n));
  // Plain words like "movie" are icon names too; anything not in the list that is a real icon name fails here.
  const allIcons = new Set(read("./material-symbols-names.txt").split("\n").filter(Boolean));
  assert.deepEqual(missing.filter((n) => allIcons.has(n)), []);
});
