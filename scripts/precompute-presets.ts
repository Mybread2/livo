// 목소리 팔레트의 프리셋 오디오(PHRASES × VOICE_PRESETS)를 합성해 phrase-audio/presets/{preset_key}/{phrase_id}.mp3에 올린다.
// 실행: npm run precompute:presets (.env.local이 있으면 읽는다).
// 인자를 받지 않는다 — 합성 대상은 PHRASES, 목소리는 PRESET_VOICE_IDS(src/services/presets.ts)로만 정한다.
// 이미 올라간 문장은 건너뛰므로 팀이 목소리를 하나 만들 때마다 다시 돌리면 된다.
import { createClient } from "@supabase/supabase-js";
import { VOICE_PRESETS } from "@/lib/voice-presets";
import { createElevenLabs } from "@/services/elevenlabs";
import { precomputePresetAudio } from "@/services/precompute";
import { getPresetVoiceId } from "@/services/presets";
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

  for (const { key, label } of VOICE_PRESETS) {
    if (getPresetVoiceId(key) === null) {
      console.log(`프리셋 ${key} (${label}): 대기(목소리 미생성)`);
      continue;
    }
    const { synthesized, skipped } = await precomputePresetAudio({ store, tts }, key);
    console.log(`프리셋 ${key} (${label}): 합성 ${synthesized.length} · 건너뜀 ${skipped.length}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
