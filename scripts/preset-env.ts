// precompute-presets.ts가 네트워크 호출 전에 확인하는 환경변수. 부작용이 없어 테스트에서 import할 수 있다.
export const REQUIRED_ENV = [
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_PRESET_VOICE_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

// 빈 문자열도 없는 것으로 본다. 이름만 돌려준다 — 값은 출력하지 않는다.
export function missingEnv(env: NodeJS.ProcessEnv): string[] {
  return REQUIRED_ENV.filter((name) => !env[name]);
}
