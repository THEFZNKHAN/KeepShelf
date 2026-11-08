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

// A fake Open Library, keyed by the title searched for. Records when each request arrived.
const catalogue = {
  "Atomic Habits": { key: "/works/OL17930368W", title: "Atomic Habits", author_name: ["James Clear"], first_publish_year: 2016, number_of_pages_median: 322, subject: ["Habit", "Self-help"], ratings_average: 3.97, ratings_count: 1488, cover_i: 12539702 },
  "Dune": { key: "/works/OL893415W", title: "Dune", author_name: ["Frank Herbert"], first_publish_year: 1965, number_of_pages_median: 608, subject: ["Fiction", "Science fiction"], ratings_average: 4.31, ratings_count: 458, cover_i: 99 },
  "Thinking, Fast and Slow": { key: "/works/OL1W", title: "Thinking, Fast and Slow", author_name: ["Daniel Kahneman"], number_of_pages_median: 528, subject: ["Intuition"] },
};
const requests = [];
let behaviour = "normal"; // "normal" | "rate-limit" | "offline"
globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.hostname !== "openlibrary.org") throw new Error("unexpected host " + u.hostname);
  requests.push({ at: Date.now(), path: u.pathname, title: (u.searchParams.get("q") ?? "").split(" ")[0] });
  if (behaviour === "offline") throw new Error("network down");
  if (behaviour === "rate-limit") return { ok: false, status: 429, json: async () => ({}) };
  if (u.pathname === "/search.json") {
    const q = u.searchParams.get("q") ?? "";
    const doc = Object.values(catalogue).find((d) => q.startsWith(d.title.split(":")[0]));
    return { ok: true, status: 200, json: async () => ({ docs: doc ? [doc] : [] }) };
  }
  return { ok: true, status: 200, json: async () => ({ description: "A description that is long enough to keep around." }) };
};

const send = (message) => new Promise((resolve) => { onMessage(message, {}, resolve); });
const books = () => send({ action: "getAll" }).then((r) => r.items.filter((i) => i.type === "book"));
const book = (title, author) => ({ type: "book", title, author, subtitle: "", googleQuery: title, sourceUrl: "" });
const olRequests = () => requests.length;

before(async () => { await import("../dist-test/background-main.js"); });

test("book info is off by default, and a save then makes no Open Library request", async () => {
  assert.equal((await send({ action: "getBookInfoSettings" })).bookInfo.enabled, false);
  const saved = await send({ action: "save", item: book("Atomic Habits", "James Clear") });
  assert.equal(saved.ok, true);
  assert.equal(saved.item.bookInfo, undefined);
  assert.equal(olRequests(), 0, "nothing is sent to openlibrary.org while it is off");
});

test("enrichBooks refuses to run while it is off", async () => {
  const r = await send({ action: "enrichBooks" });
  assert.equal(r.ok, false);
  assert.match(r.error, /Turn on book info/);
  assert.equal(olRequests(), 0);
});

test("turning it on is remembered", async () => {
  assert.equal((await send({ action: "setBookInfoEnabled", enabled: true })).bookInfo.enabled, true);
  assert.equal((await send({ action: "getBookInfoSettings" })).bookInfo.enabled, true);
  assert.equal(store.keepshelf_bookinfo_enabled, true);
});

test("once on, a newly saved book is looked up and the item comes back with its info", async () => {
  const before = olRequests();
  const saved = await send({ action: "save", item: book("Dune", "Frank Herbert") });
  assert.equal(saved.item.bookInfo.pages, 608);
  assert.equal(saved.item.bookInfo.rating, 4.3);
  assert.equal(saved.item.bookInfo.description, "A description that is long enough to keep around.");
  assert.equal(olRequests() - before, 2, "one search and one description request");
  assert.equal((await books()).find((b) => b.title === "Dune").bookInfo.coverId, 99, "and it is stored on the shelf");
});

test("requests are at least a second apart", () => {
  const gaps = requests.slice(1).map((r, i) => r.at - requests[i].at);
  assert.ok(gaps.length >= 1);
  assert.ok(Math.min(...gaps) >= 1000, `smallest gap was ${Math.min(...gaps)} ms`);
});

test("movies and other items never go to Open Library", async () => {
  const before = olRequests();
  await send({ action: "save", item: { type: "movie", title: "Heat", year: "1995", subtitle: "", googleQuery: "Heat", sourceUrl: "" } });
  await send({ action: "save", item: { type: "link", title: "x.com", url: "https://x.com", subtitle: "", googleQuery: "", sourceUrl: "https://x.com" } });
  assert.equal(olRequests(), before);
});

test("enrichBooks fills in books saved earlier, and reports a book with no match", async () => {
  await send({ action: "save", item: book("Obscure Manga Volume", "Nobody") });
  const r = await send({ action: "enrichBooks" });
  assert.equal(r.ok, true);
  assert.equal(r.enriched, 1, "Atomic Habits, saved while it was off");
  assert.equal(r.unmatched, 1, "the book Open Library does not know");
  const all = await books();
  assert.equal(all.find((b) => b.title === "Atomic Habits").bookInfo.pages, 322);
  assert.equal(all.find((b) => b.title === "Obscure Manga Volume").bookInfo, undefined);
});

test("removing a match clears it and stops automatic re-fetching, until you ask again", async () => {
  const dune = (await books()).find((b) => b.title === "Dune");
  const removed = await send({ action: "removeBookMatch", id: dune.id });
  const after = removed.items.find((i) => i.id === dune.id);
  assert.equal(after.bookInfo, undefined);
  assert.equal(after.bookInfoOptOut, true);
  const before = olRequests();
  const batch = await send({ action: "enrichBooks" });
  assert.equal(batch.enriched, 0, "the opted-out book is skipped by 'Fetch info for my books'");
  assert.ok(!requests.slice(before).some((r) => r.title === "Dune"));
  const again = await send({ action: "enrichBooks", ids: [dune.id], force: true });
  assert.equal(again.enriched, 1, "asking for that book by name fetches it again");
  assert.equal(again.items.find((i) => i.id === dune.id).bookInfoOptOut, undefined, "and clears the opt-out");
});

test("a rate limit stops the batch with a readable message and doesn't try the rest", async () => {
  await send({ action: "save", item: { ...book("Thinking, Fast and Slow", "Daniel Kahneman") } });
  const ids = (await books()).filter((b) => !b.bookInfo && b.title !== "Obscure Manga Volume").map((b) => b.id);
  // make sure there are two to fetch so we can see the second one is skipped
  const extra = await send({ action: "save", item: book("Dune Reissue", "Frank Herbert") });
  behaviour = "rate-limit";
  const before = olRequests();
  const r = await send({ action: "enrichBooks", ids: [...ids, extra.item.id] });
  behaviour = "normal";
  assert.equal(r.ok, false);
  assert.match(r.error, /limiting requests/);
  assert.equal(olRequests() - before, 1, "it stopped after the first rejected request");
});

test("if Open Library can't be reached, saving still works and the book is simply saved without info", async () => {
  behaviour = "offline";
  const saved = await send({ action: "save", item: book("A Book Saved Offline", "Some Author") });
  behaviour = "normal";
  assert.equal(saved.ok, true);
  assert.equal(saved.item.bookInfo, undefined);
});
