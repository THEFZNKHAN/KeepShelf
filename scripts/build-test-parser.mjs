import * as esbuild from "esbuild";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
mkdirSync(join(root, "dist-test"), { recursive: true });

const entries = ["parser", "format", "year", "book", "book-jsonld", "goodreads", "book-filter", "seriesgraph", "imdb", "mal", "letterboxd", "keep-settings", "storage", "rottentomatoes", "trakt", "media-jsonld", "import", "user-data", "fuzzy", "random-pick", "stats", "tmdb", "openlibrary", "tag-filter", "undo", "seasons", "reminders", "watch-sites", "status-view", "settings-backup", "list-import"].map((name) => ({
  in: join(root, `src/shared/${name}.ts`),
  out: join(root, `dist-test/${name}.js`),
}));

for (const { in: entry, out: outfile } of entries) {
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
  });
}

// The background worker, so its message handling can be tested with a fake chrome object.
await esbuild.build({
  entryPoints: [join(root, "src/background/main.ts")],
  outfile: join(root, "dist-test/background-main.js"),
  bundle: true,
  format: "esm",
  platform: "node",
});

console.log("Test parser bundle ready.");
