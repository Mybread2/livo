import type { GateResult } from "@/types/recognition";

// C5 판정 게이트. 브라우저 순수 함수 — 네트워크 없음.
// 근거: docs/ARCHITECTURE.md "판정 게이트(C5)" · docs/ADR.md ADR-005.
// 안전 원칙: "말 안 했는데 나옴"이 사고, "말했는데 안 나옴"은 다시 말하면 된다.
//            애매하면 안 나오는(discard) 쪽을 택한다.

export const GATE_SHOW_THRESHOLD = 0.7;
export const GATE_SPEAK_THRESHOLD = 0.9;
export const GATE_SPEAK_THRESHOLD_MANUAL = 0.8; // 수동 세션

export interface GateInput {
  /** 인식 확신도 0~1. NONE·거리 초과는 rejected=true 로 전달한다. */
  score: number;
  /** 인식기가 거절한 경우(NONE 클래스 · 템플릿 거리 초과). */
  rejected?: boolean;
  /** 수동 세션이면 speak 임계값이 0.80. */
  manualSession?: boolean;
}

export function decideGate(input: GateInput): GateResult {
  if (input.rejected) return "discard";
  const speakThreshold = input.manualSession
    ? GATE_SPEAK_THRESHOLD_MANUAL
    : GATE_SPEAK_THRESHOLD;
  if (input.score >= speakThreshold) return "speak";
  if (input.score >= GATE_SHOW_THRESHOLD) return "show";
  return "discard";
}
