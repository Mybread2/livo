// 합성 가능한 텍스트의 유일한 원본. 합성 함수는 텍스트가 아니라 PhraseId만 받아 여기서 텍스트를 찾는다.
// tier: 0 응급 · 1 생리 · 2 환경 · 3 소통 (기획서 §7.3)
export const PHRASES = [
  { id: "yes",    text: "네",     tier: 3 },
  { id: "no",     text: "아니요", tier: 3 },
  { id: "pain",   text: "아파요", tier: 0 },
  { id: "water",  text: "물이요", tier: 1 },
  { id: "toilet", text: "화장실", tier: 1 },
] as const;

export type PhraseId = (typeof PHRASES)[number]["id"];

export function isPhraseId(value: unknown): value is PhraseId {
  return typeof value === "string" && PHRASES.some((p) => p.id === value);
}

export function getPhraseText(id: PhraseId): string {
  const phrase = PHRASES.find((p) => p.id === id);
  if (!phrase) throw new Error(`등록되지 않은 문장 id: ${String(id)}`);
  return phrase.text;
}
