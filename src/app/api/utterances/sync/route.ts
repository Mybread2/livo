import { NextResponse } from "next/server";

export const runtime = "nodejs";

// POST /api/utterances/sync — 단말에 쌓인 발화 로그를 올린다.
// CRITICAL: 좌표·오디오는 받지 않는다. 실패해도 대상자 발화에 영향이 없다.
// 골격 스텁 — 실제 저장(RLS 검증 + utterances insert)은 다음 단계.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const logs = Array.isArray(body?.logs) ? body.logs : [];
  return NextResponse.json({ synced: logs.length });
}
