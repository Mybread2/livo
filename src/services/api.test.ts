import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  BadRequestError,
  errorResponse,
  getVoiceApiContext,
  parseSource,
  parseUuid,
  readJsonObject,
} from "./api";
import { ElevenLabsError } from "./elevenlabs";
import { ConsentRequiredError, ForbiddenError, PrecomputeIncompleteError } from "./voice-profile";

vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const UUID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const SECRET = "sk_secret_value https://example.supabase.co/storage/v1/object/sign/x?token=abc";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function jsonRequest(body: string): Request {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

// getUser()만 믿는다 — getSession()은 쿠키 내용을 검증 없이 돌려주므로 다른 사용자를 돌려주게 해 둔다
function fakeServerClient(userId: string | null) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: null })),
      getSession: vi.fn(async () => ({ data: { session: { user: { id: "user-from-cookie" } } }, error: null })),
    },
  } as unknown as ReturnType<typeof getSupabaseServerClient>;
}

function stubServerEnv(overrides: Record<string, string> = {}) {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    ELEVENLABS_API_KEY: "test-elevenlabs-key",
    ...overrides,
  };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

describe("errorResponse", () => {
  it.each([
    [new BadRequestError(SECRET), 400, { error: "bad_request" }],
    [Object.assign(new ForbiddenError(), { message: SECRET }), 403, { error: "forbidden" }],
    [
      Object.assign(new ConsentRequiredError(["voice_self", "overseas_transfer"]), { message: SECRET }),
      409,
      { error: "consent_required", missing: ["voice_self", "overseas_transfer"] },
    ],
    [
      new PrecomputeIncompleteError(UUID, new Error(SECRET)),
      502,
      { error: "precompute_incomplete", profile_id: UUID },
    ],
    [Object.assign(new ElevenLabsError(401, "text-to-speech"), { message: SECRET }), 502, { error: "upstream" }],
    [new Error(SECRET), 500, { error: "internal" }],
    [SECRET, 500, { error: "internal" }],
  ])("%s → %i", async (err, status, expected) => {
    const res = errorResponse(err);
    expect(res.status).toBe(status);
    expect(res.headers.get("content-type")).toContain("application/json");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(expected);
    // 오류 메시지·키·서명 URL이 본문에 새지 않는다
    expect(text).not.toContain("sk_secret_value");
    expect(text).not.toContain("token=abc");
  });

  it("500은 서버 로그에만 원래 오류를 남긴다", () => {
    const err = new Error(SECRET);
    errorResponse(err);
    expect(consoleError).toHaveBeenCalledWith(err);
  });

  it("클라이언트 오류(4xx)는 로그를 남기지 않는다", () => {
    errorResponse(new BadRequestError("x"));
    errorResponse(new ForbiddenError());
    errorResponse(new ConsentRequiredError(["voice_self"]));
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("parseUuid", () => {
  it("uuid를 통과시킨다", () => {
    expect(parseUuid(UUID, "subject_id")).toBe(UUID);
  });

  // Storage 경로가 '{subjectId}/...'라 대소문자가 갈리면 파기 때 목록에서 빠진다
  it("대문자 uuid는 소문자로 바꾼다", () => {
    expect(parseUuid(UUID.toUpperCase(), "subject_id")).toBe(UUID);
  });

  it.each([
    [""],
    ["not-a-uuid"],
    [`${UUID}/../x`],
    [` ${UUID}`],
    [UUID.replace(/-/g, "")],
    [123],
    [null],
    [undefined],
    [[UUID]],
    [{ id: UUID }],
  ])("%j → BadRequestError", (value) => {
    expect(() => parseUuid(value, "subject_id")).toThrow(BadRequestError);
  });
});

describe("parseSource", () => {
  it.each([["self"], ["family"]])("%s를 통과시킨다", (value) => {
    expect(parseSource(value)).toBe(value);
  });

  // 프리셋은 등록 대상이 아니다 (voice_profiles에 행이 없다)
  it.each([["preset"], [""], ["SELF"], [1], [null], [undefined], [["self"]]])("%j → BadRequestError", (value) => {
    expect(() => parseSource(value)).toThrow(BadRequestError);
  });
});

describe("readJsonObject", () => {
  it("JSON 객체를 돌려준다", async () => {
    await expect(readJsonObject(jsonRequest(`{"subject_id":"${UUID}","source":"self"}`))).resolves.toEqual({
      subject_id: UUID,
      source: "self",
    });
  });

  it.each([["[1,2]"], ["\"text\""], ["42"], ["null"], ["{broken"], [""]])("%j → BadRequestError", async (body) => {
    await expect(readJsonObject(jsonRequest(body))).rejects.toThrow(BadRequestError);
  });
});

describe("getVoiceApiContext", () => {
  beforeEach(() => {
    // 실제 네트워크 호출이 있으면 실패한다
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("테스트에서 네트워크 호출 금지");
      }),
    );
  });

  it("Supabase 환경변수가 없으면 503 not_configured", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(null);
    const res = await getVoiceApiContext();
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(503);
    expect(await bodyOf(res as Response)).toEqual({ error: "not_configured" });
  });

  // 쿠키의 세션(getSession)에는 사용자가 있어도 getUser()가 검증에 실패하면 401이다
  it("로그인 사용자가 없으면 401 — 서버 키 없이도 판정한다", async () => {
    stubServerEnv({ SUPABASE_SERVICE_ROLE_KEY: "", ELEVENLABS_API_KEY: "" });
    const client = fakeServerClient(null);
    vi.mocked(getSupabaseServerClient).mockReturnValue(client);
    const res = await getVoiceApiContext();
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
    expect(await bodyOf(res as Response)).toEqual({ error: "unauthorized" });
    expect(client!.auth.getUser).toHaveBeenCalled();
  });

  it("로그인 사용자가 있으면 userId·store·tts를 채운다", async () => {
    stubServerEnv();
    vi.mocked(getSupabaseServerClient).mockReturnValue(fakeServerClient("user-1"));
    const ctx = await getVoiceApiContext();
    expect(ctx).not.toBeInstanceOf(Response);
    if (ctx instanceof Response) return;
    expect(ctx.userId).toBe("user-1");
    expect(typeof ctx.store.ownsSubject).toBe("function");
    expect(typeof ctx.tts.synthesizePhrase).toBe("function");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([["SUPABASE_SERVICE_ROLE_KEY"], ["NEXT_PUBLIC_SUPABASE_URL"], ["ELEVENLABS_API_KEY"]])(
    "로그인했어도 %s가 없으면 503 not_configured",
    async (name) => {
      stubServerEnv({ [name]: "" });
      vi.mocked(getSupabaseServerClient).mockReturnValue(fakeServerClient("user-1"));
      const res = await getVoiceApiContext();
      expect(res).toBeInstanceOf(Response);
      expect((res as Response).status).toBe(503);
      expect(await bodyOf(res as Response)).toEqual({ error: "not_configured" });
    },
  );
});
