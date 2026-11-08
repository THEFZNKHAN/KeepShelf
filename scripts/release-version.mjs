// Works out the next release version from git tags and commit messages, and optionally writes it into
// manifest.json, package.json and package-lock.json. Prints only the version on stdout.
//
//   node scripts/release-version.mjs [--bump=auto|patch|minor|major] [--write]
//
// Used by .github/workflows/release.yml. Run it without --write to preview the next version.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nextVersion, parseVersion, compareVersions, replaceVersionInJson } from "./lib/version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const requested = (args.find((a) => a.startsWith("--bump="))?.split("=")[1] ?? "auto").trim() || "auto";
const write = args.includes("--write");

const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const readJson = (name) => JSON.parse(readFileSync(join(root, name), "utf8"));

const tags = git("tag", "--list", "v*.*.*").split("\n").filter((t) => parseVersion(t));
const latestTag = tags.sort((a, b) => compareVersions(parseVersion(b), parseVersion(a)))[0];
// Only commits since the last release decide the bump. The release commit itself is excluded by this range.
const range = latestTag ? [`${latestTag}..HEAD`] : ["HEAD"];
const messages = git("log", ...range, "--format=%B%x00").split("\0").map((m) => m.trim()).filter(Boolean);

const { base, kind, version } = nextVersion({
  tags,
  manifest: readJson("manifest.json").version,
  pkg: readJson("package.json").version,
  messages,
  requested,
});
process.stderr.write(`base ${base} + ${kind} (${messages.length} commit${messages.length === 1 ? "" : "s"} since ${latestTag ?? "start"}) -> ${version}\n`);

if (write) {
  for (const name of ["manifest.json", "package.json"]) {
    const path = join(root, name);
    writeFileSync(path, replaceVersionInJson(readFileSync(path, "utf8"), version));
  }
  const lockPath = join(root, "package-lock.json");
  if (existsSync(lockPath)) {
    // npm writes this file with 2-space JSON, so re-serialising it does not create noise.
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.version = version;
    if (lock.packages?.[""]) lock.packages[""].version = version;
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  }
}
process.stdout.write(`${version}\n`);
