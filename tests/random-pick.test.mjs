import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRandom } from "../dist-test/random-pick.js";

const it = (id, status) => ({ id, title: id, type: "movie", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1, status, done: status === "done" });

test("only planned items are picked while any exist", () => {
  const items = [it("a", "plan"), it("b", "done"), it("c", "in_progress"), it("d", "dropped")];
  for (const r of [0, 0.5, 0.99]) assert.equal(pickRandom(items, { random: () => r }).id, "a");
});

test("falls back to in-progress, then nothing", () => {
  assert.equal(pickRandom([it("c", "in_progress"), it("b", "done")]).id, "c");
  assert.equal(pickRandom([it("b", "done"), it("d", "dropped")]), undefined);
  assert.equal(pickRandom([]), undefined);
});

test("pick another avoids the previous pick when possible", () => {
  const items = [it("a", "plan"), it("b", "plan")];
  assert.equal(pickRandom(items, { excludeId: "a", random: () => 0 }).id, "b");
  assert.equal(pickRandom([it("a", "plan")], { excludeId: "a" }).id, "a");
});
