// 미동기화 발화 로그 큐. 단말에 쌓았다가 연결되면 POST /api/utterances/sync.
// CRITICAL: 좌표·오디오는 저장하지 않는다(docs/ARCHITECTURE.md utterances 규칙).
// 지금은 골격만 — 실제 IndexedDB 저장/재시도는 다음 단계.

export interface UtteranceLog {
  subjectId: string;
  track: "fixed";
  phraseId: string;
  text: string;
  score: number;
  gateResult: "speak" | "show" | "discard";
  latencyMs: number;
  createdAt: string;
}

const queue: UtteranceLog[] = [];

export function enqueue(log: UtteranceLog): void {
  // discard는 로그를 남기지 않는다(docs 판정 게이트 규칙).
  if (log.gateResult === "discard") return;
  queue.push(log);
}

export function pending(): readonly UtteranceLog[] {
  return queue;
}
