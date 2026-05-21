import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, "..", "icons");
const source = join(iconsDir, "icon.png");

if (!existsSync(source)) {
  console.error("Missing icons/icon.png — add your master icon first.");
  process.exit(1);
}

const script = `
from PIL import Image, ImageDraw, ImageChops
from pathlib import Path

src = Path(r"${source.replace(/\\/g, "\\\\")}")
img = Image.open(src).convert("RGBA")

def make_circle_icon(source_img, size, supersample=4):
    work_size = size * supersample
    resized = source_img.resize((work_size, work_size), Image.Resampling.LANCZOS)

    mask = Image.new("L", (work_size, work_size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, work_size - 1, work_size - 1), fill=255)

    red, green, blue, alpha = resized.split()
    alpha = ImageChops.multiply(alpha, mask)
    composited = Image.merge("RGBA", (red, green, blue, alpha))

    if supersample > 1:
        return composited.resize((size, size), Image.Resampling.LANCZOS)
    return composited

for size in (16, 32, 48, 128):
    out = src.parent / f"icon{size}.png"
    make_circle_icon(img, size).save(out, compress_level=6)
    print(f"Wrote {out.name} ({size}x{size})")
`;

const result = spawnSync("python", ["-c", script], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("Circular icons generated from icon.png.");
