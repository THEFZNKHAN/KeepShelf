// Downloads the icon font, cut down to the icons KeepShelf uses, into src/popup/fonts/.
// Run it by hand after adding an icon name to src/popup/icon-names.txt, then commit the new .woff2:
//   node scripts/fetch-icon-font.mjs
// The build never runs this; the committed file is what ships.
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const names = [
  ...new Set(
    readFileSync(join(root, "src/popup/icon-names.txt"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  ),
].sort();

// Google Fonts wants the names sorted. A modern browser user agent gets woff2 back.
const cssUrl =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,300..600,0..1,0" +
  `&icon_names=${names.join(",")}&display=block`;
const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const css = await (await fetch(cssUrl, { headers: { "User-Agent": ua } })).text();
const fontUrl = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/)?.[1];
if (!fontUrl) {
  console.error("No font URL in the response:\n" + css);
  process.exit(1);
}
const font = Buffer.from(await (await fetch(fontUrl)).arrayBuffer());
const out = join(root, "src/popup/fonts/MaterialSymbolsRounded-subset.woff2");
writeFileSync(out, font);
console.log(`Wrote ${names.length} icons, ${font.length} bytes, to ${out}`);
