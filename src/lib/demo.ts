// 공유 상수 + 클라이언트 안전 유틸리티. next/headers 없음.

export const DEMO_SUBJECT_ID = "00000000-0000-0000-0000-000000000001";
export const DEMO_SUBJECT_NAME = "데모 대상자";

export const DEMO_PRESETS = [
  { key: "demo_m30", label: "남성 30대", gender: "male", age_band: "30s", preview_url: "" },
  { key: "demo_f30", label: "여성 30대", gender: "female", age_band: "30s", preview_url: "" },
  { key: "demo_m40", label: "남성 40대", gender: "male", age_band: "40s", preview_url: "" },
  { key: "demo_f40", label: "여성 40대", gender: "female", age_band: "40s", preview_url: "" },
  { key: "demo_m50", label: "남성 50대", gender: "male", age_band: "50s", preview_url: "" },
  { key: "demo_f50", label: "여성 50대", gender: "female", age_band: "50s", preview_url: "" },
];

// Client Component 에서 데모 쿠키 확인 (비-httpOnly 쿠키)
export function isDemoModeClient(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => c.trim() === "livo_demo=1");
}
