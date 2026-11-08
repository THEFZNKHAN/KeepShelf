# Rules for contributors and AI agents

Read this before changing anything. It applies to people and to coding agents (Claude Code, Codex, Copilot, and others).
Setup, structure and how to add a parser are in [DEVELOPER.md](DEVELOPER.md).

## Releases and versioning (automatic)

**Releases are fully automatic. Do not manage versions or tags yourself.**

When a change lands on `main`, `.github/workflows/release.yml` tests it, picks the next version, writes it into
`manifest.json` and `package.json` (and `package-lock.json`), commits that as
`chore(release): vX.Y.Z [skip ci]`, tags it, builds the ZIP and publishes the GitHub release.

### Never do these

- **Never edit the `version` field** in `manifest.json`, `package.json` or `package-lock.json` by hand.
  The workflow owns it. A hand edit is only ever read as a floor for the next number.
- **Never create or push `v*.*.*` tags.** The workflow creates them. A manual tag pushed to GitHub starts the
  separate fallback workflow `release-manual-tag.yml`, which then fails or duplicates a release.
- **Never commit a `chore(release)` commit yourself**, and never remove `[skip ci]` from one.
- **Never delete or stop committing `package-lock.json`.** The workflow runs `npm ci`, which fails without it.
  If you change dependencies, commit the updated lockfile in the same change.

### How the version number is chosen

The next version is the **highest of the latest `v*.*.*` tag, `manifest.json` and `package.json`**, plus one bump.
The bump comes from the commit messages since the previous release:

| Put this in a commit message that lands on `main` | Bump | Example |
|---|---|---|
| nothing (the default) | **patch** | `1.1.0` to `1.1.1` |
| `#minor` | **minor** | `1.1.0` to `1.2.0` |
| `#major` | **major** | `1.1.0` to `2.0.0` |

- `#major` beats `#minor`, which beats the default.
- The keyword must stand alone. `#minority`, `foo#minor` and issue references like `#12` do not count.
- With squash merges, put the keyword in the **squash commit message** (the PR title or body that becomes the commit).
  With merge commits or rebases, any commit in the merged range counts.
- Use **minor** for a new feature, new site parser or new setting. Use **major** for a breaking change to the saved
  data format or to what users must do to upgrade. Everything else is a patch.
- To pick the size by hand instead, run the **Release** workflow from the Actions tab ("Run workflow", choose
  `patch`, `minor` or `major`). This works only on `main`.

### When a push does not release

- **Docs, tests and workflow-only changes:** a push touching only `**/*.md`, `LICENSE`, `.gitignore`, `tests/**` or
  `.github/**` does not run the release workflow.
- **`[skip ci]`** in the head commit message skips it too. Use it on purpose for changes that must not ship yet.
- **Already released:** if the commit is already tagged, the workflow exits without doing anything.
- **Failing checks:** if type-check, tests or the build fail, nothing is bumped, tagged or published. Fix the
  failure and push again.

### How it can fail, and what to do

- **Push rejected on the bump commit:** `main` moved while the workflow ran, or branch protection blocks the
  bot. Re-run the workflow after checking that GitHub Actions is allowed to push to `main`.
- **Release step failed after the tag was pushed:** the tag and version commit exist but the release page does not.
  Do not push another tag. Re-create the release for that tag from the GitHub UI, or re-run the failed job.
- **Never fix a failed release by force-pushing `main` or deleting tags** without the maintainer's say-so.

### Preview the next version locally

```bash
node scripts/release-version.mjs            # prints the next version, writes nothing
node scripts/release-version.mjs --bump=minor
```

Never run it with `--write` on your own branch. Only the workflow does that.

## Before you commit

1. `npx tsc --noEmit` has no errors.
2. `npm test` passes. Add tests for new logic. Pure logic belongs in `src/shared/` so it can be tested (add its name
   to the `entries` list in `scripts/build-test-parser.mjs`).
3. `npm run build` succeeds.

## Secrets

- Never commit `.env`, API keys or tokens. `.env` and `.env.*` are git-ignored; keep it that way.
- Do not print, log or paste secret values, including in commit messages, tests and issues. Tests must use fake values.
- The extension ships with no keys. Anything a user supplies (such as a Keep link) is stored only in their browser's
  `chrome.storage.local`.
