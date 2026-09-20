import sharp from "sharp";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, "..", "submission", "screenshots");

const files = readdirSync(dir).filter((f) => f.endsWith(".svg"));

for (const file of files) {
  const svgPath = join(dir, file);
  const pngPath = join(dir, file.replace(".svg", ".png"));
  const svg = readFileSync(svgPath);
  await sharp(svg).png().toFile(pngPath);
  console.log(`✓ ${file} → ${file.replace(".svg", ".png")}`);
}
console.log("완료");
