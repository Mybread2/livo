import "server-only";

// ElevenLabs 서버 전용 래퍼(담당 C가 채운다).
// CRITICAL: API 키·호출은 서버(src/services)에만. 클라이언트로 새면 안 된다.
// 합성 대상은 등록 문장(사전 합성) 또는 서버 발급 candidate_id로만.

export function getElevenLabsApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error(
      "ELEVENLABS_API_KEY 미설정. 서버 환경변수에만 넣는다(.env.local).",
    );
  }
  return key;
}

// 골격 스텁. 담당 C가 voice 등록(C7)·사전 합성(C6b)을 구현한다.
export async function synthesizeFixedPhrases(): Promise<never> {
  throw new Error("미구현: 담당 C가 ElevenLabs 사전 합성을 구현한다.");
}
