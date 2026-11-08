import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bumpFromMessages, bumpVersion, compareVersions, nextVersion, parseVersion, replaceVersionInJson,
} from "../scripts/lib/version.mjs";

test("parseVersion accepts x.y.z with an optional v and rejects the rest", () => {
  assert.deepEqual(parseVersion("v1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseVersion(" 10.0.1 "), [10, 0, 1]);
  for (const bad of ["1.2", "v1.2.3-beta", "latest", "", undefined]) assert.equal(parseVersion(bad), undefined);
});

test("versions compare numerically, not as text", () => {
  assert.ok(compareVersions([1, 10, 0], [1, 9, 0]) > 0);
  assert.ok(compareVersions([2, 0, 0], [1, 99, 99]) > 0);
  assert.equal(compareVersions([1, 2, 3], [1, 2, 3]), 0);
});

test("commit messages choose the bump: patch by default, #minor, #major wins", () => {
  assert.equal(bumpFromMessages(["Fix a bug"]), "patch");
  assert.equal(bumpFromMessages([]), "patch");
  assert.equal(bumpFromMessages(["Add feature #minor"]), "minor");
  assert.equal(bumpFromMessages(["Add feature", "Big rewrite\n\n#major"]), "major");
  assert.equal(bumpFromMessages(["#minor thing", "#major thing"]), "major");
  assert.equal(bumpFromMessages(["case: #MINOR"]), "minor");
});

test("keywords must be whole words and never match issue numbers or longer words", () => {
  assert.equal(bumpFromMessages(["Fix #12 and #123"]), "patch");
  assert.equal(bumpFromMessages(["#minority report"]), "patch");
  assert.equal(bumpFromMessages(["see #major-version-notes"]), "patch");
  assert.equal(bumpFromMessages(["foo#minor"]), "patch");
});

test("bumping resets the lower numbers", () => {
  assert.deepEqual(bumpVersion([1, 4, 7], "patch"), [1, 4, 8]);
  assert.deepEqual(bumpVersion([1, 4, 7], "minor"), [1, 5, 0]);
  assert.deepEqual(bumpVersion([1, 4, 7], "major"), [2, 0, 0]);
  assert.throws(() => bumpVersion([1, 0, 0], "huge"), /Unknown bump/);
});

test("the base is the highest of the tags and both files, so it never reuses a number", () => {
  // Stale files (1.0.0) but a v1.1.0 tag exists: continue from the tag.
  const r = nextVersion({ tags: ["v1.0.0", "v1.0.1", "v1.1.0"], manifest: "1.0.0", pkg: "1.0.0", messages: ["Fix"] });
  assert.deepEqual(r, { base: "1.1.0", kind: "patch", version: "1.1.1" });
  // Files ahead of the tags (a hand edit): continue from the files.
  assert.equal(nextVersion({ tags: ["v1.0.0"], manifest: "2.0.0", pkg: "1.5.0" }).version, "2.0.1");
  // Numeric ordering: v1.10.0 beats v1.9.0.
  assert.equal(nextVersion({ tags: ["v1.9.0", "v1.10.0"], manifest: "1.0.0", pkg: "1.0.0" }).version, "1.10.1");
  // No tags at all: use the files.
  assert.equal(nextVersion({ tags: [], manifest: "1.0.0", pkg: "1.0.0" }).version, "1.0.1");
  assert.throws(() => nextVersion({ tags: [], manifest: "x", pkg: "y" }), /No valid version/);
});

test("an explicit request overrides the commit messages", () => {
  const base = { tags: ["v1.1.0"], manifest: "1.1.0", pkg: "1.1.0", messages: ["Add thing #major"] };
  assert.equal(nextVersion({ ...base, requested: "auto" }).version, "2.0.0");
  assert.equal(nextVersion({ ...base, requested: "patch" }).version, "1.1.1");
  assert.equal(nextVersion({ ...base, requested: "minor" }).version, "1.2.0");
  assert.throws(() => nextVersion({ ...base, requested: "nope" }), /Unknown bump/);
});

test("replaceVersionInJson changes only the version and keeps formatting", () => {
  const manifest = `{\n  "manifest_version": 3,\n  "name": "KeepShelf",\n  "version": "1.0.0",\n  "permissions": ["storage", "tabs"]\n}\n`;
  const out = replaceVersionInJson(manifest, "1.2.0");
  assert.equal(out, manifest.replace('"1.0.0"', '"1.2.0"'));
  assert.equal(JSON.parse(out).manifest_version, 3);
  assert.throws(() => replaceVersionInJson("{}", "1.0.0"), /No "version"/);
});
