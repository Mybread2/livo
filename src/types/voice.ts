export interface VoicePlayer {
  // 사전 합성된 그 사람 목소리로 해당 문장을 재생. 네트워크 없이 단말 오디오.
  speak(phraseId: string): Promise<void>;
  isReady(phraseId: string): boolean;  // 번들 다운로드 완료 여부
}
