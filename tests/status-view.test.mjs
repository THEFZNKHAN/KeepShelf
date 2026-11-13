import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VIEWS, START_MODES, STATUS_FILTERS, defaultStatusFilter, effectiveStatusFilter, matchesStatusFilter,
} from "../dist-test/status-view.js";

const STATUSES = ["plan", "in_progress", "done", "dropped"];
const kept = (filter) => STATUSES.filter((s) => matchesStatusFilter(s, filter));

test("each filter keeps the statuses it says", () => {
  assert.deepEqual(kept("all"), STATUSES);
  assert.deepEqual(kept("pending"), ["plan", "in_progress"]);
  assert.deepEqual(kept("todo"), ["plan"]);
  assert.deepEqual(kept("progress"), ["in_progress"]);
  assert.deepEqual(kept("done"), ["done"]);
  assert.deepEqual(kept("dropped"), ["dropped"]);
});

test("Not watched hides watched and dropped, and nothing else", () => {
  assert.equal(matchesStatusFilter("done", "pending"), false);
  assert.equal(matchesStatusFilter("dropped", "pending"), false);
  assert.equal(matchesStatusFilter("plan", "pending"), true);
  assert.equal(matchesStatusFilter("in_progress", "pending"), true);
});

test("every filter is listed once, with All first", () => {
  assert.equal(STATUS_FILTERS[0], "all");
  assert.equal(new Set(STATUS_FILTERS).size, STATUS_FILTERS.length);
  for (const f of STATUS_FILTERS) assert.ok(Array.isArray(kept(f)), f);
});

test("the default view hides watched items unless told to show everything", () => {
  assert.equal(defaultStatusFilter("hide"), "pending");
  assert.equal(defaultStatusFilter("all"), "all");
  assert.deepEqual(DEFAULT_VIEWS, ["hide", "all"]);
  assert.deepEqual(START_MODES, ["fresh", "remember"]);
});

test("a shelf that doesn't offer a filter falls back sensibly", () => {
  const tabs = ["all", "todo", "done"];
  assert.equal(effectiveStatusFilter("pending", tabs), "todo");
  assert.equal(effectiveStatusFilter("progress", tabs), "all");
  assert.equal(effectiveStatusFilter("dropped", tabs), "all");
  assert.equal(effectiveStatusFilter("done", tabs), "done");
  assert.equal(effectiveStatusFilter("pending", STATUS_FILTERS), "pending");
  assert.equal(effectiveStatusFilter("all", tabs), "all");
});
