import { describe, expect, it } from "vitest";
import { missingEnv, REQUIRED_ENV } from "./preset-env";

const full = {
  ELEVENLABS_API_KEY: "k",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "s",
};

describe("missingEnv", () => {
  it("필요한 변수 3개를 요구한다 — 프리셋 voice_id는 환경변수가 아니다", () => {
    expect([...REQUIRED_ENV].sort()).toEqual(Object.keys(full).sort());
  });

  it("전부 있으면 빠진 것이 없다", () => {
    expect(missingEnv(full)).toEqual([]);
  });

  it("없는 변수의 이름을 돌려준다", () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" };
    expect(missingEnv(env)).toEqual(["ELEVENLABS_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
  });

  it("빈 문자열도 없는 것으로 본다", () => {
    expect(missingEnv({ ...full, ELEVENLABS_API_KEY: "", NEXT_PUBLIC_SUPABASE_URL: "" })).toEqual([
      "ELEVENLABS_API_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
  });

  it("아무것도 없으면 전부 돌려준다", () => {
    expect(missingEnv({})).toEqual([...REQUIRED_ENV]);
  });
});
