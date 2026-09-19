-- 동의 철회와 대상자 삭제를 서버(service_role) 전용으로 바꾼다.
--
-- 철회·삭제는 목소리 파기(ElevenLabs voice, Storage 파일)를 동반해야 한다.
--   클라이언트가 consents를 직접 update하거나 subjects를 직접 delete하면 서버가 몰라서 파기가 일어나지 않는다.
--   DB cascade는 Storage 객체와 외부 API의 voice를 지우지 못한다.
-- 그래서 authenticated의 update(consents) · delete(subjects) 정책을 없애고, 서버 함수만 이 작업을 한다.
-- consents에는 delete 정책을 두지 않는다 — 동의 기록은 철회(revoked_at)로만 남긴다 (감사 추적).

drop policy consents_update on public.consents;
drop policy subjects_delete on public.subjects;
