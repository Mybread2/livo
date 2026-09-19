import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createElevenLabs, ElevenLabsError, type ElevenLabs } from "./elevenlabs";
import { createSupabaseAdmin } from "./supabase-admin";
import { ConsentRequiredError, ForbiddenError, PrecomputeIncompleteError, type VoiceSource } from "./voice-profile";
import { createSupabaseVoiceStore, type VoiceStore } from "./voice-store";

// API 라우트 공통 기반. 권한·동의 규칙은 서버 함수(voice-profile.ts 등)에 있다 — 여기서 다시 검사하지 않는다.

export interface VoiceApiContext {
  userId: string;
  store: VoiceStore;
  tts: ElevenLabs;
}

// 메시지는 서버 로그용이다. 응답 본문에는 넣지 않는다.
export class BadRequestError extends Error {
  constructor(message = "잘못된 요청") {
    super(message);
    this.name = "BadRequestError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Storage 경로가 '{subjectId}/...'라 대소문자가 갈리면 파기 때 목록에서 빠진다 — 소문자로 맞춘다 (Postgres 출력과 같다)
export function parseUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new BadRequestError(`${field}가 uuid가 아니다`);
  return value.toLowerCase();
}

// 'preset'은 받지 않는다 — 프리셋은 등록 대상이 아니다
export function parseSource(value: unknown): VoiceSource {
  if (value === "self" || value === "family") return value;
  throw new BadRequestError("source는 self 또는 family");
}

export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError("본문이 JSON이 아니다");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new BadRequestError("본문이 JSON 객체가 아니다");
  return body as Record<string, unknown>;
}

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

// 본문에는 오류 코드와 클라이언트가 다음 동작에 쓸 값만 넣는다. 메시지·스택·키·서명 URL은 넣지 않는다.
export function errorResponse(err: unknown): Response {
  if (err instanceof BadRequestError) return json(400, { error: "bad_request" });
  if (err instanceof ForbiddenError) return json(403, { error: "forbidden" });
  if (err instanceof ConsentRequiredError) return json(409, { error: "consent_required", missing: err.missing });
  // 5xx는 원인을 서버 로그에만 남긴다
  console.error(err);
  // profile_id로 resumePrecompute(재시도)를 부른다
  if (err instanceof PrecomputeIncompleteError) return json(502, { error: "precompute_incomplete", profile_id: err.profileId });
  if (err instanceof ElevenLabsError) return json(502, { error: "upstream" });
  return json(500, { error: "internal" });
}

export async function getVoiceApiContext(): Promise<VoiceApiContext | Response> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return json(503, { error: "not_configured" });

  // getSession()은 쿠키를 그대로 믿는다. getUser()는 Supabase Auth에 토큰을 검증받는다
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json(401, { error: "unauthorized" });

  // 서버 키가 빠진 배포도 설정 문제다. 라우트가 이 함수를 try 밖에서 부르므로 throw하지 않고 503으로 돌려준다
  try {
    return { userId: user.id, store: createSupabaseVoiceStore(createSupabaseAdmin()), tts: createElevenLabs() };
  } catch (err) {
    console.error(err);
    return json(503, { error: "not_configured" });
  }
}
