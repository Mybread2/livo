// A ↔ C 계약. 담당 C(텍스트 → 목소리)가 이 인터페이스를 구현하고,
// 담당 A(프론트)는 이 타입에만 의존해 발화를 재생한다.
// CRITICAL: 재생은 단말에 미리 내려받은(사전 합성) 오디오로만 한다.
//           임의 텍스트를 받아 합성하는 경로를 만들지 않는다.

export interface VoicePlayer {
  /** 사전 합성된 그 사람 목소리로 해당 문장을 재생한다. 네트워크 없이 단말 오디오. */
  speak(phraseId: string): Promise<void>;
  /** 해당 문장의 오디오가 단말에 준비되어 있는지. (번들 다운로드 완료 여부) */
  isReady(phraseId: string): boolean;
}
