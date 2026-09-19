import { StubScreen } from "@/components/caregiver/StubScreen";

export default function VoicePage() {
  return (
    <StubScreen
      title="목소리 설정"
      note="프리셋 · 동성 가족 · 본인 옛 음성 3갈래. 교체 중에는 새 오디오를 다 받을 때까지 이전 목소리로 재생한다. 담당 C의 API와 연결된다."
      wire="s26 · s27 · s28 · s29"
    />
  );
}
