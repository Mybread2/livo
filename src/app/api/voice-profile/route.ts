import { NextResponse } from "next/server";

export const runtime = "nodejs";

// POST /api/voice-profile — 참조 음성 → ElevenLabs voice 등록 → 사전 합성(담당 C).
// CRITICAL: consent_id 없이 처리하지 않는다(voice_profiles.consent_id NOT NULL).
//           ElevenLabs 키·호출은 이 서버 경로(src/services)에서만.
// 골격 스텁 — 담당 C가 구현한다.
export async function POST() {
  return NextResponse.json(
    { error: "미구현: 담당 C가 음성 프로필 등록을 구현한다." },
    { status: 501 },
  );
}
