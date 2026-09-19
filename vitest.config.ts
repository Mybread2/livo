import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      // 마이그레이션·RLS 테스트(PGlite)와 스크립트 테스트
      "supabase/tests/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // server-only는 react-server 조건 밖에서 import하면 throw한다 — 테스트에서는 빈 모듈로 바꾼다
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
    },
  },
});
