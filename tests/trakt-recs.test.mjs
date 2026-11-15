import { test } from "node:test";
import assert from "node:assert/strict";
import { TRAKT_SUGGESTIONS, newTitlesOnly, parseTraktTitles } from "../dist-test/trakt-recs.js";

test("Trakt's lists become titles with TMDB ids, bare or wrapped", () => {
  const related = [
    { title: "Heat", year: 1995, ids: { tmdb: 949 }, overview: "A crew…", genres: ["crime"] },
    { title: "No TMDB", year: 2000, ids: { trakt: 5 } },
    { title: "Heat", year: 1995, ids: { tmdb: 949 } },
  ];
  assert.deepEqual(parseTraktTitles(related, "movie"), [{ kind: "movie", tmdb: 949, title: "Heat", year: "1995", overview: "A crew…", anime: false }]);
  const wrapped = [{ show: { title: "Frieren", year: 2023, ids: { tmdb: 209867 }, genres: ["anime", "fantasy"] } }];
  const [frieren] = parseTraktTitles(wrapped, "tv");
  assert.equal(frieren.anime, true);
  assert.equal(frieren.kind, "tv");
  assert.deepEqual(parseTraktTitles("junk", "tv"), []);
});

test("at most a handful per list, and nothing already listed", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ title: `T${i}`, ids: { tmdb: i + 1 } }));
  assert.equal(parseTraktTitles(many, "movie").length, TRAKT_SUGGESTIONS);
  const titles = parseTraktTitles(many.slice(0, 3), "movie");
  assert.deepEqual(newTitlesOnly(titles, [{ kind: "movie", id: 2 }, { kind: "tv", id: 3 }]).map((t) => t.tmdb), [1, 3]);
});
