import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeYear } from "../dist-test/year.js";

test("extracts a four-digit year from common date formats", () => {
  assert.equal(normalizeYear("1988"), "1988");
  assert.equal(normalizeYear("21 April 2021"), "2021");
  assert.equal(normalizeYear("April 21, 2021"), "2021");
  assert.equal(normalizeYear("2010-07-16"), "2010");
});

test("returns undefined when there is no year", () => {
  assert.equal(normalizeYear(undefined), undefined);
  assert.equal(normalizeYear("   "), undefined);
  assert.equal(normalizeYear("no date"), undefined);
});
