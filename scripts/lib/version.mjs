// Pure helpers for automatic release versioning. See AGENTS.md ("Releases and versioning").

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(text) {
  const match = SEMVER.exec(String(text ?? "").trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function formatVersion(parts) {
  return parts.join(".");
}

/**
 * Which bump a set of commit messages asks for. `#major` beats `#minor`; anything else is a patch.
 * Matches only the whole keyword, so "#minority" or an issue like "#12" never counts.
 */
export function bumpFromMessages(messages) {
  const text = messages.join("\n");
  if (/(^|\s)#major\b(?![-\w])/i.test(text)) return "major";
  if (/(^|\s)#minor\b(?![-\w])/i.test(text)) return "minor";
  return "patch";
}

export function bumpVersion(parts, kind) {
  const [major, minor, patch] = parts;
  if (kind === "major") return [major + 1, 0, 0];
  if (kind === "minor") return [major, minor + 1, 0];
  if (kind === "patch") return [major, minor, patch + 1];
  throw new Error(`Unknown bump "${kind}". Use auto, patch, minor or major.`);
}

/**
 * The next version. The base is the highest of the latest tag and the versions in manifest.json and
 * package.json, so a stale file or a missing tag can never produce a number that already exists.
 * `requested` is "auto" (read the commit messages), or an explicit patch, minor or major.
 */
export function nextVersion({ tags = [], manifest, pkg, messages = [], requested = "auto" }) {
  const candidates = [...tags, manifest, pkg].map(parseVersion).filter(Boolean);
  if (candidates.length === 0) throw new Error("No valid version found in tags, manifest.json or package.json.");
  const base = candidates.reduce((top, v) => (compareVersions(v, top) > 0 ? v : top));
  const kind = requested === "auto" ? bumpFromMessages(messages) : requested;
  return { base: formatVersion(base), kind, version: formatVersion(bumpVersion(base, kind)) };
}

/** Replaces the first top-level `"version": "x"` in JSON text without reformatting anything else. */
export function replaceVersionInJson(text, version) {
  const pattern = /("version"\s*:\s*")[^"]*(")/;
  if (!pattern.test(text)) throw new Error('No "version" field found.');
  return text.replace(pattern, `$1${version}$2`);
}
