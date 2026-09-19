import { nearestPhrases, type TemplateSet } from "./dtw";
import { normalizeSegment } from "./normalize";
import { scoreNearest } from "./score";
import { SegmentDetector, type SegmentOptions } from "./segment";
import type { LipFrame, Sequence } from "./types";

// 개발용 수집 페이지·거리 분석에 쓰는 순수 도우미. 브라우저 순수 함수 — 네트워크 없음.
// 템플릿은 실시간 인식과 같은 C2 → C3 경로로 만든다 — 경로가 갈라지면 템플릿과 입력의 모양이 어긋난다.

/** 프레임 스트림에서 구간을 모두 잘라 정규화까지 한 것. 정규화할 수 없는 구간은 뺀다. */
export function segmentsFromFrames(
  frames: readonly LipFrame[],
  options?: SegmentOptions,
): { frames: LipFrame[]; seq: Sequence }[] {
  const detector = new SegmentDetector(options);
  const out: { frames: LipFrame[]; seq: Sequence }[] = [];
  for (const frame of frames) {
    const segment = detector.push(frame);
    if (segment === null) continue;
    const seq = normalizeSegment(segment);
    if (seq !== null) out.push({ frames: segment, seq });
  }
  return out;
}

export interface LabeledSequence {
  phraseId: string;
  seq: Sequence;
}

/** 문장별로 모아 TemplateSet으로 (입력 순서 유지 — 문장은 처음 나온 순서, 문장 안 템플릿은 입력 순서). */
export function buildTemplateSet(samples: readonly LabeledSequence[]): TemplateSet {
  // Map으로 모은다 — 일반 객체에 바로 쌓으면 "__proto__" 같은 키가 프로토타입을 건드린다
  const groups = new Map<string, Sequence[]>();
  for (const { phraseId, seq } of samples) {
    const list = groups.get(phraseId);
    if (list) list.push(seq);
    else groups.set(phraseId, [seq]);
  }
  return Object.fromEntries(groups);
}

export interface LooRow {
  index: number;
  phraseId: string;
  /** 가장 가까운 문장. 남은 템플릿이 하나도 없으면 null. */
  predicted: string | null;
  d1: number;
  d2: number;
  score: number;
  rejected: boolean;
}

/** 하나씩 빼고 맞히기 — 나머지로 템플릿을 만들어 각 표본을 분류한다 (scoreNearest 포함, 기본 파라미터). */
export function leaveOneOut(samples: readonly LabeledSequence[]): LooRow[] {
  return samples.map(({ phraseId, seq }, index) => {
    const templates = buildTemplateSet(samples.filter((_, k) => k !== index));
    const nearest = nearestPhrases(seq, templates);
    if (nearest === null) {
      // 비교할 템플릿이 없다 — 파이프라인이라면 이벤트가 없는 경우. 표에는 거절로 남긴다
      const none = Number.POSITIVE_INFINITY;
      return { index, phraseId, predicted: null, d1: none, d2: none, score: 0, rejected: true };
    }
    const { score, rejected } = scoreNearest(nearest);
    return { index, phraseId, predicted: nearest.label, d1: nearest.d1, d2: nearest.d2, score, rejected };
  });
}
