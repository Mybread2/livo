import { StubScreen } from "@/components/caregiver/StubScreen";

export default function SettingsPage() {
  return (
    <StubScreen
      title="설정"
      note="수동 세션 · 동의 관리 · 대상자 전환 등. 수동 세션 OFF면 카메라 트랙을 정지한다."
      wire="s31 · s32 · s18"
    />
  );
}
