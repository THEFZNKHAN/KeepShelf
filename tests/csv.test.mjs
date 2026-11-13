import { test } from "node:test";
import assert from "node:assert/strict";
import { csvText, localDay, toCsv } from "../dist-test/csv.js";
import { parseCsv } from "../dist-test/import.js";

test("toCsv writes a header and rows with a byte order mark and CRLF line endings", () => {
  const out = toCsv(["a", "b"], [["1", "2"], ["3", "4"]]);
  assert.equal(out, "﻿a,b\r\n1,2\r\n3,4\r\n");
});

test("toCsv quotes what needs it and doubles the quotes", () => {
  const out = toCsv(["t"], [["has, comma"], ['say "hi"'], ["two\nlines"], [" padded "], ["plain"], [""]]);
  assert.equal(out, '﻿t\r\n"has, comma"\r\n"say ""hi"""\r\n"two\nlines"\r\n" padded "\r\nplain\r\n\r\n');
});

test("what toCsv writes is read back exactly by the CSV parser, for awkward text too", () => {
  const rows = [["Amélie", "2001", 'He said, "wow"\nnext line'], ["日本語", "", " spaced "], ["a,b", "c\"d", ""]];
  const parsed = parseCsv(toCsv(["Title", "Year", "Review"], rows));
  assert.deepEqual(parsed, [["Title", "Year", "Review"], ...rows]);
});

test("csvText stops a cell being run as a spreadsheet formula", () => {
  for (const evil of ["=SUM(A1)", "+1+1", "-2+3", "@cmd", "\tTabbed"]) assert.equal(csvText(evil), `'${evil}`, JSON.stringify(evil));
  assert.equal(csvText("\rReturn"), "'\nReturn", "a leading carriage return is guarded too, and line breaks are unified");
  assert.equal(csvText("Normal title"), "Normal title");
  assert.equal(csvText("A - B"), "A - B", "only the start matters");
  assert.equal(csvText(undefined), "");
  assert.equal(csvText("line one\r\nline two"), "line one\nline two");
});

test("localDay is the date in the user's own time zone, padded", () => {
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59).getTime()), "2026-01-05");
  assert.equal(localDay(new Date(2026, 10, 9, 0, 1).getTime()), "2026-11-09");
});
