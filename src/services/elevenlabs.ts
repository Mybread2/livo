import "server-only";
import { getPhraseText, isPhraseId, type PhraseId } from "@/lib/phrases";

const BASE_URL = "https://api.elevenlabs.io/v1";

export interface ElevenLabsOptions {
  apiKey?: string;
  fetch?: typeof fetch;
  modelId?: string;
}

export interface ElevenLabs {
  synthesizePhrase(phraseId: PhraseId, voiceId: string): Promise<{ audio: ArrayBuffer; charCount: number }>;
  cloneVoice(input: { name: string; files: Blob[]; description?: string }): Promise<{ voiceId: string }>;
  deleteVoice(voiceId: string): Promise<void>;
}

// 메시지에는 작업명과 상태 코드만 넣는다. 응답 본문·요청 헤더(API 키)는 넣지 않는다.
export class ElevenLabsError extends Error {
  status: number;

  constructor(status: number, operation: string) {
    super(`ElevenLabs ${operation} 실패 (HTTP ${status})`);
    this.name = "ElevenLabsError";
    this.status = status;
  }
}

export function createElevenLabs(options: ElevenLabsOptions = {}): ElevenLabs {
  const apiKey = options.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY가 설정되지 않았다");
  const doFetch = options.fetch ?? globalThis.fetch;
  const modelId = options.modelId ?? "eleven_multilingual_v2";

  const request = async (
    operation: string,
    path: string,
    init: { method: string; body?: BodyInit; headers?: Record<string, string> },
  ): Promise<Response> => {
    const res = await doFetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { ...init.headers, "xi-api-key": apiKey },
    });
    if (!res.ok) throw new ElevenLabsError(res.status, operation);
    return res;
  };

  return {
    // 텍스트를 받지 않는다. 합성할 수 있는 것은 src/lib/phrases.ts의 등록 문장뿐이다 (임의 텍스트 합성 경로 금지).
    async synthesizePhrase(phraseId, voiceId) {
      if (!isPhraseId(phraseId)) throw new Error("등록되지 않은 문장 id");
      const text = getPhraseText(phraseId);
      const res = await request(
        "text-to-speech",
        `/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, model_id: modelId }),
        },
      );
      return { audio: await res.arrayBuffer(), charCount: text.length };
    },

    async cloneVoice({ name, files, description }) {
      const form = new FormData();
      form.append("name", name);
      for (const file of files) form.append("files", file);
      form.append("remove_background_noise", "true");
      if (description !== undefined) form.append("description", description);
      const res = await request("voices/add", "/voices/add", { method: "POST", body: form });
      const body = (await res.json()) as { voice_id: string };
      return { voiceId: body.voice_id };
    },

    async deleteVoice(voiceId) {
      await request("voices/delete", `/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE" });
    },
  };
}
