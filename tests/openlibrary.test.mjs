import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_REQUEST_GAP_MS, MAX_BOOK_GENRES, MIN_RATINGS, bookRating, OpenLibraryError, authorsMatch, bookCoverUrl, bookGenres, cleanDescription, cleanSubjects, createOpenLibraryClient,
  lookupBook, mainTitle, needsBookInfo, pickBestBook, sanitizeBookInfo, toBookInfo, totalPages,
} from "../dist-test/openlibrary.js";
import { allTags, genreTags, genreText } from "../dist-test/tmdb.js";
import { buildBackup, parseImportFile } from "../dist-test/import.js";

/** A fetch answering from a path -> body map, recording what was asked. */
function mockFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, params: Object.fromEntries(u.searchParams) });
    const body = routes[u.pathname];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (typeof body === "number") return { ok: false, status: body, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}
const instant = { now: () => 0, sleep: async () => {} };

test("mainTitle drops the subtitle", () => {
  assert.equal(mainTitle("Drive: The Surprising Truth About What Motivates Us"), "Drive");
  assert.equal(mainTitle("Thinking, Fast and Slow"), "Thinking, Fast and Slow");
  assert.equal(mainTitle("Dune - Special Edition"), "Dune");
});

test("authorsMatch compares last names and says unknown when a side is missing", () => {
  assert.equal(authorsMatch("Robert Cialdini", ["Robert B. Cialdini"]), true);
  assert.equal(authorsMatch("Donella Meadows", ["Donella H. Meadows"]), true);
  assert.equal(authorsMatch("Weir, Andy", ["Andy Weir"]), true);
  assert.equal(authorsMatch("Daniel H. Pink", ["Someone Else"]), false);
  assert.equal(authorsMatch(undefined, ["Andy Weir"]), undefined);
  assert.equal(authorsMatch("Andy Weir", undefined), undefined);
});

test("pickBestBook finds the right book, tolerating subtitles", () => {
  const docs = [
    { key: "/works/OL1W", title: "Drive", author_name: ["Daniel H. Pink"], ratings_count: 28, first_publish_year: 2009 },
    { key: "/works/OL2W", title: "Drive", author_name: ["James Sallis"], ratings_count: 900, first_publish_year: 2005 },
  ];
  const hit = pickBestBook(docs, { title: "Drive: The Surprising Truth About What Motivates Us", author: "Daniel H. Pink" });
  assert.equal(hit.key, "/works/OL1W", "the author decides between two books called Drive");
});

test("pickBestBook refuses a wrong author and a weak title", () => {
  const docs = [{ key: "/works/OL1W", title: "Dune", author_name: ["Frank Herbert"], first_publish_year: 1965 }];
  assert.equal(pickBestBook(docs, { title: "Dune", author: "Somebody Else" }), undefined);
  assert.equal(pickBestBook(docs, { title: "Completely Different Book", author: "Frank Herbert" }), undefined);
});

test("a classic matches even when the only records are later reissues (no year rule)", () => {
  const reissue = [{ key: "/works/OL9W", title: "The Alchemist", author_name: ["Paulo Coelho"], first_publish_year: 2010 }];
  assert.equal(pickBestBook(reissue, { title: "The Alchemist", author: "Paulo Coelho" }).key, "/works/OL9W");
});

test("a book filed under its original-language title is found through its edition title", () => {
  const docs = [
    { key: "/works/OL24793569W", title: "The Alchemist Graphic Novel", author_name: ["Paulo Coelho"], ratings_count: 8, editions: { docs: [{ title: "The Alchemist" }] } },
    { key: "/works/OL796465W", title: "O Alquimista", author_name: ["Paulo Coelho"], ratings_count: 489, edition_count: 141, editions: { docs: [{ title: "The Alchemist" }] } },
    { key: "/works/OL27298042W", title: "ClassicNotes GradeSaver on The Alchemist by Paulo Coelho", author_name: ["Anthony Arroyo"], ratings_count: 4, editions: { docs: [{ title: "ClassicNotes GradeSaver on The Alchemist by Paulo Coelho" }] } },
  ];
  assert.equal(pickBestBook(docs, { title: "The Alchemist", author: "Paulo Coelho" }).key, "/works/OL796465W", "the original work with the most ratings wins");
  const pilgrimage = [{ key: "/works/OL796594W", title: "Diário de um mago", author_name: ["Paulo Coelho"], editions: { docs: [{ title: "The Pilgrimage" }] } }];
  assert.equal(pickBestBook(pilgrimage, { title: "The Pilgrimage", author: "Paulo Coelho" }).key, "/works/OL796594W");
  assert.equal(pickBestBook(pilgrimage, { title: "The Pilgrimage", author: "Someone Else" }), undefined, "the author still has to agree");
});

test("with no author, only an unambiguous near-exact title is accepted", () => {
  const one = [{ key: "/works/OL1W", title: "Undead Unluck", author_name: ["Yoshifumi Totsuka"] }];
  assert.equal(pickBestBook(one, { title: "Undead Unluck" }).key, "/works/OL1W");
  const two = [{ key: "/works/OL1W", title: "Drive", author_name: ["A"] }, { key: "/works/OL2W", title: "Drive", author_name: ["B"] }];
  assert.equal(pickBestBook(two, { title: "Drive" }), undefined, "two books with that title: don't guess");
  assert.equal(pickBestBook([{ key: "/works/OL3W", title: "Dune Messiah", author_name: ["F"] }], { title: "Dune" }), undefined);
});

test("popular editions win ties", () => {
  const docs = [
    { key: "/works/OL1W", title: "Thinking in systems", author_name: ["Donella H. Meadows"], ratings_count: 5, edition_count: 2 },
    { key: "/works/OL2W", title: "Thinking in Systems", author_name: ["Donella H. Meadows"], ratings_count: 30, edition_count: 9 },
  ];
  assert.equal(pickBestBook(docs, { title: "Thinking in Systems: A Primer", author: "Donella Meadows" }).key, "/works/OL2W");
});

test("cleanSubjects keeps topical subjects and drops catalogue noise", () => {
  const raw = ["Psychology", "psychology", "Accessible book", "Protected DAISY", "Kahneman, Daniel, 1934-", "Decision making",
    "New York Times bestseller", "20th century", "In library", "Self-help", "Business & economics", "A very long subject name that goes on and on", "Large type books"];
  assert.deepEqual(cleanSubjects(raw), ["Psychology", "Decision making", "Self-help", "Business & economics"]);
  assert.deepEqual(cleanSubjects(undefined), []);
  assert.equal(cleanSubjects(Array.from({ length: 30 }, (_, i) => `Topic${String.fromCharCode(97 + (i % 26))}x${"y".repeat(i % 3)}`)).length <= 8, true);
});

test("cleanSubjects drops qualifiers in brackets and place or character subjects", () => {
  assert.deepEqual(
    cleanSubjects(["Motivation (Psychology)", "Dune (Imaginary place)", "Influence (Psychology)", "Paul Atreides (Fictitious character)", "Psychology", "Compliance"]),
    ["Motivation", "Influence", "Psychology", "Compliance"]
  );
  assert.deepEqual(cleanSubjects(["Habit (Psychology)", "Habit", "habit"]), ["Habit"], "stripping a qualifier can create a duplicate");
});

test("cleanSubjects drops other-language entries, merges spelling variants and keeps the first six", () => {
  assert.deepEqual(cleanSubjects(["Science fiction", "Science-fiction", "Framgångsrikt företagande", "Fiction", "Café culture"]), ["Science fiction", "Fiction"]);
  const many = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
  assert.deepEqual(cleanSubjects(many), many.slice(0, 6));
});

test("cleanSubjects drops dash-separated sub-categories but keeps hyphenated words", () => {
  assert.deepEqual(
    cleanSubjects(["Fantasy", "Fantasy - epic", "Fiction - fantasy", "Success- psychological aspects", "Self-help", "Science-fiction", "Well-being"]),
    ["Fantasy", "Self-help", "Science-fiction", "Well-being"]
  );
});

test("bookGenres re-cleans stored subjects and keeps only the first three", () => {
  const stored = { subjects: ["Fantasy", "Fantasy - epic", "Fantasy - series", "High fantasy", "Fantasy fiction", "Epic"] };
  assert.deepEqual(bookGenres(stored), ["Fantasy", "High fantasy", "Fantasy fiction"], "books fetched before the dash rule are fixed at read time");
  assert.equal(MAX_BOOK_GENRES, 3);
  assert.deepEqual(bookGenres(undefined), []);
});

test("cleanDescription strips markdown, source footers and catalogue sections", () => {
  assert.equal(cleanDescription("A **proven** framework for [better habits](https://x.com) every day. ([source][1])\n\n----------\n[1]: https://x"), "A proven framework for better habits every day.");
  assert.equal(cleanDescription({ type: "/type/text", value: "Paul Atreides, a brilliant young man, must travel far." }), "Paul Atreides, a brilliant young man, must travel far.");
  assert.equal(cleanDescription("short"), undefined);
  assert.equal(cleanDescription(undefined), undefined);
});

test("a rating from only a few people is not kept", () => {
  assert.equal(toBookInfo({ key: "/works/OL1W", ratings_average: 4.0, ratings_count: 1 }, undefined, 1).rating, undefined);
  assert.equal(toBookInfo({ key: "/works/OL1W", ratings_average: 4.0, ratings_count: MIN_RATINGS }, undefined, 1).rating, 4);
  assert.equal(bookRating({ rating: 4, ratingsCount: 1 }), undefined, "and info saved earlier is also hidden at read time");
  assert.equal(bookRating({ rating: 4, ratingsCount: 30 }), 4);
  assert.equal(bookRating(undefined), undefined);
});

test("toBookInfo maps a search result", () => {
  const info = toBookInfo({ key: "/works/OL17930368W", title: "Atomic Habits", number_of_pages_median: 322.4, subject: ["Habit", "Self-help"],
    ratings_average: 3.97112, ratings_count: 1488, first_publish_year: 2016, cover_i: 12539702 }, "A framework.", 5);
  assert.deepEqual(info, { workKey: "/works/OL17930368W", subjects: ["Habit", "Self-help"], fetchedAt: 5, pages: 322, rating: 4, ratingsCount: 1488,
    description: "A framework.", firstPublishYear: 2016, coverId: 12539702 });
  assert.deepEqual(toBookInfo({ key: "/works/OL1W" }, undefined, 1), { workKey: "/works/OL1W", subjects: [], fetchedAt: 1 });
});

test("the client never sends requests closer than the allowed gap", async () => {
  let clock = 10_000; const slept = [];
  const f = mockFetch({ "/a.json": {} });
  const client = createOpenLibraryClient({ fetchImpl: f, now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; } });
  await client.get("/a.json");
  assert.deepEqual(slept, [], "the first request goes out immediately");
  clock += 300; await client.get("/a.json");
  assert.deepEqual(slept, [MIN_REQUEST_GAP_MS - 300], "a second request 300ms later waits for the rest of the gap");
  clock += 5000; await client.get("/a.json");
  assert.equal(slept.length, 1, "after a long pause there is no extra wait");
});

test("client errors are readable", async () => {
  const mk = (status) => createOpenLibraryClient({ fetchImpl: mockFetch({ "/x": status }), ...instant });
  await assert.rejects(() => mk(429).get("/x"), (e) => e instanceof OpenLibraryError && e.status === 429 && /limiting/.test(e.message));
  await assert.rejects(() => mk(403).get("/x"), /limiting/);
  await assert.rejects(() => mk(500).get("/x"), /error \(500\)/);
  await assert.rejects(() => createOpenLibraryClient({ fetchImpl: async () => { throw new Error("net"); }, ...instant }).get("/x"), /Could not reach Open Library/);
});

test("lookupBook searches by main title and author, then reads the description", async () => {
  const f = mockFetch({
    "/search.json": { docs: [{ key: "/works/OL1W", title: "Drive", author_name: ["Daniel H. Pink"], first_publish_year: 2009, number_of_pages_median: 249, subject: ["Motivation"], ratings_average: 4.0, ratings_count: 28, cover_i: 77 }] },
    "/works/OL1W.json": { description: { value: "What really motivates us? The answer may surprise you." } },
  });
  const info = await lookupBook(createOpenLibraryClient({ fetchImpl: f, ...instant }), { title: "Drive: The Surprising Truth About What Motivates Us", author: "Daniel H. Pink" }, 9);
  assert.equal(info.pages, 249);
  assert.equal(info.description, "What really motivates us? The answer may surprise you.");
  assert.deepEqual(f.calls.map((c) => c.path), ["/search.json", "/works/OL1W.json"]);
  assert.equal(f.calls[0].params.q, "Drive Daniel H. Pink", "a free-text search, so edition titles are searched too");
  assert.equal(f.calls[0].params["editions.fields"], "key,title");
  assert.match(f.calls[0].params.fields, /editions/);
});

test("lookupBook returns nothing for an unknown book, and keeps going without a description", async () => {
  const client = (routes) => createOpenLibraryClient({ fetchImpl: mockFetch(routes), ...instant });
  assert.equal(await lookupBook(client({ "/search.json": { docs: [] } }), { title: "Nope", author: "Nobody" }), undefined);
  const info = await lookupBook(client({ "/search.json": { docs: [{ key: "/works/OL1W", title: "Dune", author_name: ["Frank Herbert"] }] }, "/works/OL1W.json": 500 }), { title: "Dune", author: "Frank Herbert" });
  assert.equal(info.description, undefined, "a failed description lookup doesn't lose the rest");
  await assert.rejects(() => lookupBook(client({ "/search.json": { docs: [{ key: "/works/OL1W", title: "Dune", author_name: ["Frank Herbert"] }] }, "/works/OL1W.json": 429 }), { title: "Dune", author: "Frank Herbert" }), /limiting/);
});

test("sanitizeBookInfo keeps valid data and drops the rest", () => {
  const good = { workKey: "/works/OL17930368W", subjects: ["Habit", 5, ""], pages: 322, rating: 4, fetchedAt: 1, junk: "x" };
  assert.deepEqual(sanitizeBookInfo(good), { workKey: "/works/OL17930368W", subjects: ["Habit"], fetchedAt: 1, pages: 322, rating: 4 });
  assert.equal(sanitizeBookInfo({ ...good, workKey: "/books/OL1M" }), undefined);
  assert.equal(sanitizeBookInfo({ ...good, workKey: "https://evil.example/x" }), undefined);
  assert.equal(sanitizeBookInfo({ ...good, fetchedAt: "now" }), undefined);
  assert.equal(sanitizeBookInfo({ ...good, pages: -4 }).pages, undefined);
  assert.equal(sanitizeBookInfo("nope"), undefined);
});

test("covers, total pages, genres and tags use the book info", () => {
  const item = { bookInfo: { workKey: "/works/OL1W", subjects: ["Self-help", "Business & economics"], pages: 322, coverId: 12539702, fetchedAt: 1 } };
  assert.equal(bookCoverUrl(item, "M"), "https://covers.openlibrary.org/b/id/12539702-M.jpg");
  assert.equal(bookCoverUrl({}), undefined);
  assert.equal(totalPages({ ...item, progressTotal: 300 }), 300, "your own number wins");
  assert.equal(totalPages(item), 322);
  assert.equal(totalPages({}), undefined);
  assert.equal(genreText(item), "Self-help, Business & economics");
  assert.deepEqual(genreTags(item), ["self-help", "business", "economics"]);
  assert.deepEqual(allTags({ ...item, tags: ["habits"] }), ["habits", "self-help", "business", "economics"]);
  assert.equal(genreText({ genre: "Novel", ...item }), "Novel", "what the source page said still wins");
});

test("backups keep valid book info", () => {
  const base = { id: "1", title: "Atomic Habits", type: "book", author: "James Clear", subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1 };
  const withInfo = { ...base, bookInfo: { workKey: "/works/OL17930368W", subjects: ["Habit"], pages: 322, fetchedAt: 5 } };
  const bad = { ...base, id: "2", title: "Other", bookInfo: { workKey: "javascript:alert(1)", subjects: [], fetchedAt: 5 } };
  const { items } = parseImportFile(buildBackup([withInfo, bad]), "b.json");
  assert.equal(items[0].bookInfo.pages, 322);
  assert.equal(items[1].bookInfo, undefined);
});

import { computeStats } from "../dist-test/stats.js";

test("book subjects count as genres in the stats", () => {
  const base = { subtitle: "", googleQuery: "", sourceUrl: "", savedAt: 1, type: "book" };
  const stats = computeStats([
    { ...base, id: "1", title: "A", bookInfo: { workKey: "/works/OL1W", subjects: ["Self-help", "Habit"], fetchedAt: 1 } },
    { ...base, id: "2", title: "B", bookInfo: { workKey: "/works/OL2W", subjects: ["Self-help"], fetchedAt: 1 } },
  ], Date.UTC(2026, 10, 9));
  assert.deepEqual(stats.topGenres[0], { name: "Self-help", count: 2 });
});

test("needsBookInfo: books with no details yet, unless a wrong match was removed", () => {
  assert.equal(needsBookInfo({ type: "book" }), true);
  assert.equal(needsBookInfo({ type: "book", bookInfo: { workKey: "/works/OL1W", subjects: [], fetchedAt: 1 } }), false);
  assert.equal(needsBookInfo({ type: "book", bookInfoOptOut: true }), false);
  for (const type of ["movie", "series", "anime", "tab"]) assert.equal(needsBookInfo({ type }), false, type);
});
