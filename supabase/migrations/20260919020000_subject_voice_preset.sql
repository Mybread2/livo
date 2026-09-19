-- 대상자별로 고른 프리셋 목소리 (목소리 팔레트). null이면 기본 프리셋.
--
-- 팔레트 키는 코드(src/lib/voice-presets.ts)가 정한다. DB CHECK를 두지 않는다 — 팔레트가 바뀔 때마다 마이그레이션이 필요해진다.
-- 정책은 그대로다. 클라이언트가 자기 대상자 행(subjects_update)으로 이 값을 직접 바꿀 수 있지만,
-- 번들(src/services/bundle.ts)이 읽을 때 키와 합성 완료 여부를 다시 확인하고 아니면 기본 프리셋으로 대체한다.

alter table public.subjects add column voice_preset text;
