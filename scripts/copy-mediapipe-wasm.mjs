// postinstall: @mediapipe/tasks-vision의 WASM을 public/mediapipe/wasm/으로 복사한다.
// 브라우저가 같은 출처에서 받게 하려는 것이다 — CDN을 쓰지 않는다(오프라인 원칙, ADR-002).
// 복사본은 커밋하지 않는다(.gitignore). npm install·npm ci·Vercel 빌드 때마다 패키지에서 다시 복사한다.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const destDir = join(root, "public", "mediapipe", "wasm");

// MediaPipe가 브라우저 SIMD 지원 여부에 따라 둘 중 한 쌍을 고른다(FilesetResolver.forVisionTasks)
const FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

const missing = FILES.filter((f) => !existsSync(join(srcDir, f)));
if (missing.length > 0) {
  console.error(`copy-mediapipe-wasm: 원본이 없다 — ${srcDir}`);
  console.error(`  없는 파일: ${missing.join(", ")}`);
  console.error("  @mediapipe/tasks-vision이 설치됐는지 확인하라 (npm install).");
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
for (const f of FILES) copyFileSync(join(srcDir, f), join(destDir, f));
console.log(`copy-mediapipe-wasm: ${FILES.length}개 → public/mediapipe/wasm/`);
