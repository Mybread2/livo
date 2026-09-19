// 전역 고정 문장 15개. B(인식)와 C(합성)가 같은 목록을 참조한다.
// 근거: docs/PRD.md "고정 문장 15개". 응급(T0)은 빈도와 무관하게 항상 포함한다.

export type Tier = "T0" | "T1" | "T2" | "T3";

export interface Phrase {
  id: string;
  text: string;
  tier: Tier;
  /** 응급 문장은 삭제·비활성 불가, 결제와 무관하게 항상 동작. */
  emergency: boolean;
}

// satisfies로 선언해 id 리터럴 타입을 살린다 — PhraseId가 등록 문장 id의 유니언이 된다.
// 합성 함수(src/services)는 텍스트가 아니라 PhraseId만 받아 여기서 텍스트를 찾는다 (임의 텍스트 합성 경로 차단).
export const PHRASES = [
  // T0 응급 — 항상 포함(제약)
  { id: "pain", text: "아파요", tier: "T0", emergency: true },
  { id: "cant-breathe", text: "숨이 안 쉬어져요", tier: "T0", emergency: true },
  { id: "help", text: "도와주세요", tier: "T0", emergency: true },
  { id: "medicine", text: "약이요", tier: "T0", emergency: true },
  // T1 생리
  { id: "toilet", text: "화장실", tier: "T1", emergency: false },
  { id: "water", text: "물이요", tier: "T1", emergency: false },
  { id: "hungry", text: "배고파요", tier: "T1", emergency: false },
  { id: "cold", text: "추워요", tier: "T1", emergency: false },
  // T2 환경
  { id: "reposition", text: "자세 바꿔주세요", tier: "T2", emergency: false },
  { id: "lights-off", text: "불 꺼주세요", tier: "T2", emergency: false },
  { id: "too-loud", text: "시끄러워요", tier: "T2", emergency: false },
  // T3 소통
  { id: "yes", text: "네", tier: "T3", emergency: false },
  { id: "no", text: "아니요", tier: "T3", emergency: false },
  { id: "thanks", text: "고마워요", tier: "T3", emergency: false },
  { id: "wait", text: "잠깐만요", tier: "T3", emergency: false },
] as const satisfies readonly Phrase[];

export type PhraseId = (typeof PHRASES)[number]["id"];

export function getPhrase(id: string): Phrase | undefined {
  return PHRASES.find((p) => p.id === id);
}

export function isPhraseId(value: unknown): value is PhraseId {
  return typeof value === "string" && PHRASES.some((p) => p.id === value);
}

export function getPhraseText(id: PhraseId): string {
  const phrase = getPhrase(id);
  if (!phrase) throw new Error(`등록되지 않은 문장 id: ${String(id)}`);
  return phrase.text;
}

/** 프로토타입 시작 단어 셋(§업무지시서). B는 우선 이 부분집합부터 분류한다. */
export const STARTER_PHRASE_IDS = ["yes", "no", "pain", "water", "toilet"] as const;
