import { StubScreen } from "@/components/caregiver/StubScreen";

export default function OnboardingPage() {
  return (
    <StubScreen
      title="온보딩"
      note="동의 확인 → 카메라 거치 → 문장 따라하기 → 목소리 고르기. 대상자별 최초 1회."
      wire="s05 ~ s15"
    />
  );
}
