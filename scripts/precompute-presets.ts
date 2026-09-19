// 프리셋 오디오(PHRASES × PRESET_KEYS)를 한 번 합성해 phrase-audio/presets/{preset_key}/{phrase_id}.mp3에 올린다.
// 실행: npm run precompute:presets (.env.local이 있으면 읽는다).
// 인자를 받지 않는다 — 합성 대상은 PHRASES, 목소리는 ELEVENLABS_PRESET_VOICE_ID로만 정한다.
import { createClient } from "@supabase/supabase-js";
import { createElevenLabs } from "@/services/elevenlabs";
import { precomputePresetAudio } from "@/services/precompute";
import { PRESET_KEYS } from "@/services/presets";
import { createSupabaseVoiceStore } from "@/services/voice-store";
import { missingEnv } from "./preset-env";

async function main(): Promise<void> {
  const missing = missingEnv(process.env);
  if (missing.length > 0) {
    console.error(`환경변수가 없다: ${missing.join(", ")}`);
    process.exit(1);
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const store = createSupabaseVoiceStore(admin);
  const tts = createElevenLabs();

  for (const key of PRESET_KEYS) {
    await precomputePresetAudio({ store, tts }, key);
    console.log(`프리셋 ${key} 완료`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
