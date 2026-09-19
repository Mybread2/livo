import type { VoicePlayer } from "@/types/voice";
import { getPhrase } from "@/lib/phrases";

// 담당 A용 목(mock). 담당 C의 실제 VoicePlayer(사전 합성 오디오 재생)가
// 완성되면 대체 구현으로 갈아끼운다.
// CRITICAL: 실제 구현도 단말에 내려받은 오디오만 재생한다. 임의 텍스트 합성 금지.
//
// 목 동작: 오디오 파일 대신 Web Speech API(SpeechSynthesis)로 소리를 내 흐름을 시연한다.
// (Web Speech는 시연용일 뿐, 제품 발화 경로가 아니다.)
export class MockVoicePlayer implements VoicePlayer {
  isReady(phraseId: string): boolean {
    return getPhrase(phraseId) !== undefined;
  }

  async speak(phraseId: string): Promise<void> {
    const phrase = getPhrase(phraseId);
    if (!phrase) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(phrase.text);
    u.lang = "ko-KR";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
}
