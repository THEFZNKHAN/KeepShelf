import { test } from "node:test";
import assert from "node:assert/strict";
import { listToItems, parseList, parseListLine, planListImport } from "../dist-test/list-import.js";

const line = (text, watched = false) => parseListLine(text, watched);

test("reads the line KeepShelf copies for a movie", () => {
  assert.deepEqual(line("Drishyam (2015) | 2h 43m | IMDb 8.2"), {
    title: "Drishyam", year: "2015", type: "movie", durationOrSeasons: "2h 43m", imdbRating: "8.2", watched: false,
  });
  assert.equal(line("Into The Wild (2007) |  2h 28m | IMDb 8.0").durationOrSeasons, "2h 28m");
  assert.equal(line("Hope (2026) | IMDb 6.8").durationOrSeasons, undefined);
  assert.equal(line("Vishwanath & Sons (2026)").imdbRating, undefined);
  assert.equal(line("A Real Pain (2024) | 1h 30m | IMDb 7").imdbRating, "7");
});

test("seasons make a series, and (A) makes anime", () => {
  assert.deepEqual(line("Fargo (2014) | S05 | IMDb 8.8"), {
    title: "Fargo", year: "2014", type: "series", durationOrSeasons: "5 seasons", imdbRating: "8.8", watched: false,
  });
  assert.equal(line("Watchmen (2019) | S01 | IMDb 8.2").durationOrSeasons, "1 season");
  const anime = line("86 (2021) | S01 | IMDb 8.3 (A)");
  assert.equal(anime.type, "anime");
  assert.equal(anime.durationOrSeasons, "1 season");
  assert.equal(anime.imdbRating, "8.3");
  assert.equal(line("D.Gray-man Hallow (2016) | IMDb 7.4 (A)").type, "anime");
  assert.equal(line("One Piece (1999) | 1180 eps | IMDb 9 (A)").durationOrSeasons, "1180 eps");
  assert.equal(line("Naruto (2002) (A)").type, "anime");
});

test("titles with brackets, hashes and symbols are kept whole", () => {
  assert.equal(line("Up (अप) (2009) | 1h 36m | IMDb 8.3").title, "Up (अप)");
  assert.equal(line("Up (अप) (2009) | 1h 36m | IMDb 8.3").year, "2009");
  assert.equal(line("#Home (2021) | 2h 41m | IMDb 8.7").title, "#Home");
  assert.equal(line("Dabbe: Curse of the Jinn (2013) | 2h 25m").title, "Dabbe: Curse of the Jinn");
  assert.equal(line("Spider-Man: Brand New Day (2026) | 2h 30m | IMDb 8").title, "Spider-Man: Brand New Day");
});

test("the year is optional, and the text is cleaned up", () => {
  assert.deepEqual(line("  The   Matrix  "), { title: "The Matrix", year: undefined, type: "movie", durationOrSeasons: undefined, imdbRating: undefined, watched: false });
  assert.equal(line("Heat (1995) · 2h 50m · IMDb 8.3").durationOrSeasons, "2h 50m");
  // Other sites' ratings and certificates are ignored, not errors.
  const odd = line("Heat (1995) | 2h 50m | LB 4.2 | RT 86% | R");
  assert.equal(odd.title, "Heat");
  assert.equal(odd.durationOrSeasons, "2h 50m");
  assert.equal(odd.imdbRating, undefined);
});

test("bullets and boxes are dropped, and a ticked box means watched", () => {
  assert.equal(line("- Heat (1995)").title, "Heat");
  assert.equal(line("• Heat (1995)").title, "Heat");
  assert.equal(line("* Heat (1995)").title, "Heat");
  assert.equal(line("[ ] Heat (1995)").title, "Heat");
  assert.equal(line("☐ Heat (1995)").watched, false);
  assert.equal(line("[x] Heat (1995)").watched, true);
  assert.equal(line("[X] Heat (1995)").title, "Heat");
  assert.equal(line("☑ Heat (1995)").watched, true);
  assert.equal(line("✓ Heat (1995)").watched, true);
  assert.equal(line("Heat (1995)", true).watched, true);
});

test("things that aren't titles are skipped", () => {
  assert.equal(line(""), undefined);
  assert.equal(line("   "), undefined);
  assert.equal(line("-"), undefined);
  assert.equal(line("https://example.com/some/page"), undefined);
  assert.equal(line("x".repeat(400)), undefined);
  assert.equal(line("(2015)"), undefined);
});

test("headings switch between watched and to-watch lines", () => {
  const text = `Hope (2026) | IMDb 6.8
Suits (2011) | S09
Watched
This Is the End (2013) | 1h 47m
Michael (2026)
To watch:
Hamnet (2025)
`;
  const { entries, unreadable } = parseList(text, false);
  assert.deepEqual(entries.map((e) => [e.title, e.watched]), [
    ["Hope", false], ["Suits", false], ["This Is the End", true], ["Michael", true], ["Hamnet", false],
  ]);
  assert.deepEqual(unreadable, []);
  // Which list it is by default.
  assert.equal(parseList("Heat (1995)", true).entries[0].watched, true);
  assert.equal(parseList("Heat (1995)", false).entries[0].watched, false);
  for (const heading of ["Watched", "watched:", "Already watched", "Seen", "Done"]) {
    assert.equal(parseList(`${heading}\nHeat (1995)`, false).entries[0].watched, true, heading);
  }
  for (const heading of ["To watch", "Unwatched", "Not watched:", "Watchlist", "Planned"]) {
    assert.equal(parseList(`${heading}\nHeat (1995)`, true).entries[0].watched, false, heading);
  }
});

test("lines that can't be read are reported, shortened, and the rest still work", () => {
  const { entries, unreadable } = parseList(`Heat (1995)\nhttps://example.com/a/very/long/address/that/goes/on/and/on/forever/and/ever\n\nDark (2017) | S03`, false);
  assert.equal(entries.length, 2);
  assert.equal(unreadable.length, 1);
  assert.ok(unreadable[0].length <= 60);
});

test("Windows line endings and blank lines are fine", () => {
  assert.equal(parseList("Heat (1995)\r\n\r\nDark (2017)\r\n", false).entries.length, 2);
  assert.deepEqual(parseList("", false), { entries: [], unreadable: [] });
});

test("shelf entries keep the pasted order, newest first, and mark watched ones done", () => {
  const { entries } = parseList("Watched\nDrishyam (2015) | 2h 43m | IMDb 8.2\nTo watch\nFargo (2014) | S05 | IMDb 8.8", false);
  const items = listToItems(entries, 1_000_000);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title: "Drishyam", type: "movie", subtitle: "2015 · 2h 43m", googleQuery: "Drishyam 2015", sourceUrl: "", savedAt: 1_000_000,
    year: "2015", durationOrSeasons: "2h 43m", imdbRating: "8.2", done: true, status: "done", doneAt: 1_000_000,
  });
  assert.equal(items[1].savedAt, 999_000);
  assert.equal("done" in items[1], false);
  assert.equal(items[1].durationOrSeasons, "5 seasons");
  // No year, no extras: no empty fields.
  const bare = listToItems(parseList("The Matrix", false).entries, 5)[0];
  assert.deepEqual(bare, { title: "The Matrix", type: "movie", subtitle: "", googleQuery: "The Matrix", sourceUrl: "", savedAt: 5 });
});

const shelf = (title, year, type, extra = {}) => ({ id: title, title, year, type, subtitle: "", googleQuery: title, savedAt: 1, sourceUrl: "", ...extra });

test("a pasted list never doubles up the shelf", () => {
  const { entries } = parseList("Heat (1995)\nHeat (1995)\nDark (2017) | S03\nHereditary (2018)\nSpiderman Brand New Day (2026)\nUshio & Tora (2015) | S01 (A)", false);
  const existing = [shelf("Heat", "1995", "movie"), shelf("Spider-Man: Brand New Day", "2026", "movie"), shelf("Ushio & Tora", "2015", "anime")];
  const plan = planListImport(listToItems(entries), existing);
  assert.deepEqual(plan.fresh.map((i) => i.title), ["Dark", "Hereditary"]);
  // Exact matches, and a title repeated inside the paste itself.
  assert.deepEqual(plan.duplicates.map((i) => i.title).sort(), ["Heat", "Heat", "Ushio & Tora"]);
  // Close to something saved under another spelling: skipped, and named.
  assert.deepEqual(plan.similar.map((s) => [s.item.title, s.like]), [["Spiderman Brand New Day", "Spider-Man: Brand New Day"]]);
});

test("the same title as a different kind is not a duplicate", () => {
  const plan = planListImport(listToItems(parseList("Fargo (1996) | 1h 38m", false).entries), [shelf("Fargo", "1996", "series")]);
  assert.equal(plan.fresh.length, 1);
});
