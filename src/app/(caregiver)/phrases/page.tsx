import { StubScreen } from "@/components/caregiver/StubScreen";

export default function PhrasesPage() {
  return (
    <StubScreen
      title="문장 관리"
      note="응급 4문장은 삭제·비활성 불가. 상한 30개. 문장 추가 시 목소리를 재합성한다."
      wire="s30 · s30b · s34"
    />
  );
}
