import { afterEach, describe, expect, it, vi } from "vitest";
import type { PhraseId } from "@/lib/phrases";
import { createElevenLabs, ElevenLabsError } from "./elevenlabs";

const API_KEY = "sk_test_7f3a9c";

function setup(respond: () => Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => respond());
  const client = createElevenLabs({ apiKey: API_KEY, fetch });
  const call = () => {
    const [url, init] = fetch.mock.calls[0];
    return { url: String(url), init: init ?? {}, headers: new Headers(init?.headers) };
  };
  return { fetch, client, call };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("synthesizePhrase", () => {
  it("PhraseId의 등록 텍스트로 TTS를 호출한다", async () => {
    const audio = new Uint8Array([1, 2, 3]).buffer;
    const { client, call } = setup(() => new Response(audio));

    const result = await client.synthesizePhrase("pain", "v1");

    const { url, init, headers } = call();
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/v1?output_format=mp3_44100_128");
    expect(init.method).toBe("POST");
    expect(headers.get("xi-api-key")).toBe(API_KEY);
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe("아파요");
    expect(body.model_id).toBe("eleven_multilingual_v2");
    expect(result.charCount).toBe(3);
    expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("PhraseId가 아닌 값은 fetch 없이 throw한다", async () => {
    const { fetch, client } = setup(() => new Response(new ArrayBuffer(0)));

    await expect(client.synthesizePhrase("아무 말이나 해줘" as PhraseId, "v1")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("cloneVoice", () => {
  it("multipart로 이름·파일·잡음 제거를 보내고 voiceId를 돌려준다", async () => {
    const { client, call } = setup(() =>
      Response.json({ voice_id: "cloned_1", requires_verification: false }),
    );
    const files = [new Blob(["a"], { type: "audio/mpeg" }), new Blob(["b"], { type: "audio/mpeg" })];

    const result = await client.cloneVoice({ name: "엄마 목소리", files, description: "가족" });

    const { url, init, headers } = call();
    expect(url).toBe("https://api.elevenlabs.io/v1/voices/add");
    expect(init.method).toBe("POST");
    expect(headers.get("xi-api-key")).toBe(API_KEY);
    const form = init.body as FormData;
    expect(form.get("name")).toBe("엄마 목소리");
    expect(form.getAll("files")).toHaveLength(2);
    expect(form.get("remove_background_noise")).toBe("true");
    expect(form.get("description")).toBe("가족");
    expect(result).toEqual({ voiceId: "cloned_1" });
  });
});

describe("deleteVoice", () => {
  it("DELETE로 voice를 지운다", async () => {
    const { client, call } = setup(() => Response.json({ status: "ok" }));

    await client.deleteVoice("cloned_1");

    const { url, init, headers } = call();
    expect(url).toBe("https://api.elevenlabs.io/v1/voices/cloned_1");
    expect(init.method).toBe("DELETE");
    expect(headers.get("xi-api-key")).toBe(API_KEY);
  });
});

describe("오류", () => {
  it.each([401, 422, 500])("%i 응답이면 ElevenLabsError를 던지고 메시지에 키가 없다", async (status) => {
    const { client } = setup(() => new Response(`bad key ${API_KEY}`, { status }));

    const results = await Promise.allSettled([
      client.synthesizePhrase("pain", "v1"),
      client.cloneVoice({ name: "n", files: [new Blob(["a"])] }),
      client.deleteVoice("v1"),
    ]);

    for (const r of results) {
      expect(r.status).toBe("rejected");
      const err = (r as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(ElevenLabsError);
      expect(err.status).toBe(status);
      expect(String(err)).not.toContain(API_KEY);
      expect(err.message).not.toContain(API_KEY);
    }
  });
});

describe("createElevenLabs", () => {
  it("apiKey 옵션과 환경변수가 모두 없으면 throw한다", () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    expect(() => createElevenLabs()).toThrow();
  });

  it("apiKey 옵션이 없으면 환경변수 키를 쓴다", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "sk_from_env");
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ status: "ok" }));

    await createElevenLabs({ fetch }).deleteVoice("v1");

    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("xi-api-key")).toBe("sk_from_env");
  });
});
