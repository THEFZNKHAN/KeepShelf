import { test, before } from "node:test";
import assert from "node:assert/strict";

// A fake chrome: real storage behaviour, and every other API quietly does nothing.
const store = {};
let onMessage;
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
    if (key === "runtime") return { onMessage: { addListener: (fn) => { onMessage = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, getURL: (p) => p };
    return noop;
  },
});

const send = (message) => new Promise((resolve) => { onMessage(message, {}, resolve); });
const all = () => send({ action: "getAll" }).then((r) => r.items);
const note = (body) => ({ type: "note", title: body, body, subtitle: "", googleQuery: "", sourceUrl: "" });

before(async () => { await import("../dist-test/background-main.js"); });

test("restore brings back deleted items with the same ids, in the same order", async () => {
  // Distinct timestamps: items saved in the same millisecond have no defined order to restore.
  store.trackbuddy_items = ["one", "two", "three"].map((body, n) => ({
    ...note(body), id: `id-${body}`, savedAt: 1000 + n, keepStatus: "disabled",
  })).reverse();
  const before = await all();
  assert.equal(before.length, 3);

  const doomed = before.filter((i) => i.body !== "two");
  const deleted = await send({ action: "delete", ids: doomed.map((i) => i.id) });
  assert.equal(deleted.items.length, 1);

  const restored = await send({ action: "restore", items: doomed });
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.items, before);
  assert.deepEqual(await all(), before);
});

test("restore after a merge returns both items and the keeper's own data", async () => {
  const before = await all();
  const [keep, other] = before;
  await send({ action: "update", id: other.id, changes: { tags: ["extra"], myRating: 7 } });
  const original = await all();
  const snapshot = original.filter((i) => i.id === keep.id || i.id === other.id);

  const merged = await send({ action: "merge", keepId: keep.id, removeIds: [other.id] });
  assert.equal(merged.items.length, original.length - 1);

  const restored = await send({ action: "restore", items: snapshot });
  assert.deepEqual(restored.items, original);
});

test("restore is queued with the other writes and doesn't lose a save made at the same time", async () => {
  const base = await all();
  const victim = base[0];
  await send({ action: "delete", ids: [victim.id] });
  const [, saved] = await Promise.all([
    send({ action: "restore", items: [victim] }),
    send({ action: "save", item: note("saved while undoing") }),
  ]);
  assert.equal(saved.ok, true);
  const now = await all();
  assert.equal(now.length, base.length + 1);
  assert.ok(now.some((i) => i.id === victim.id));
  assert.ok(now.some((i) => i.body === "saved while undoing"));
});
