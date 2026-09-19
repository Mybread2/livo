// A ↔ B 계약. 담당 B(입모양 → 텍스트)가 이 인터페이스를 구현하고,
// 담당 A(프론트)는 이 타입에만 의존해 화면을 만든다.
// CRITICAL: 이 경로의 어떤 구현도 네트워크 호출을 하지 않는다(src/recognition).

export type GateResult = "speak" | "show" | "discard";

export interface RecognitionEvent {
  /** 인식된 고정 문장 id (예: "help", "pain"). src/lib/phrases.ts의 id와 일치한다. */
  phraseId: string;
  /** 화면에 크게 띄울 문장 텍스트. */
  text: string;
  /** 인식 확신도 0~1. */
  score: number;
  /** 판정 게이트(C5) 결과. */
  gate: GateResult;
}

export interface RecognizerOptions {
  /** 수동 세션이면 발화 임계값을 0.90 → 0.80 으로 낮춘다(ADR-005). */
  manualSession?: boolean;
}

export interface Recognizer {
  /**
   * 카메라 <video>를 받아 입모양 인식을 시작한다.
   * 결과는 onResult 콜백으로 스트리밍된다(discard 포함).
   */
  start(
    video: HTMLVideoElement,
    onResult: (event: RecognitionEvent) => void,
    options?: RecognizerOptions,
  ): Promise<void>;
  /** 인식을 멈추고 카메라 트랙을 정지한다(수동 세션 OFF · 화면 이탈 시). */
  stop(): void;
}
