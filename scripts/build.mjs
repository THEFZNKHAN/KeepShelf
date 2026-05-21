import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");

mkdirSync(dist, { recursive: true });

const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  target: "chrome120",
  logLevel: "info",
};

const builds = [
  {
    entryPoints: [join(root, "src/content/main.ts")],
    outfile: join(dist, "content.js"),
    format: "iife",
  },
  {
    entryPoints: [join(root, "src/background/main.ts")],
    outfile: join(dist, "background.js"),
    format: "iife",
  },
  {
    entryPoints: [join(root, "src/popup/popup.ts")],
    outfile: join(dist, "popup.js"),
    format: "iife",
  },
];

async function run() {
  if (watch) {
    const ctxs = await Promise.all(
      builds.map(({ format, ...b }) =>
        esbuild.context({ ...common, format, ...b })
      )
    );
    await Promise.all(ctxs.map((c) => c.watch()));
    console.log("Watching...");
  } else {
    await Promise.all(
      builds.map(({ format, ...b }) =>
        esbuild.build({ ...common, format, ...b })
      )
    );
  }

  copyFileSync(join(root, "src/popup/popup.html"), join(dist, "popup.html"));
  const css = readFileSync(join(root, "src/popup/popup.css"), "utf8");
  writeFileSync(join(dist, "popup.css"), css);
  console.log("Build complete.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
