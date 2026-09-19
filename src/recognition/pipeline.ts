import type { RecognitionEvent } from "@/types/recognition";
import { getPhrase } from "@/lib/phrases";
import { nearestPhrases, type DtwOptions, type TemplateSet } from "./dtw";
import { decideGate } from "./gate";
import { extractLipFrame, type LandmarkPoint } from "./lips";
import { normalizeSegment } from "./normalize";
import { scoreNearest, type ScoreParams } from "./score";
import { SegmentDetector, type SegmentOptions } from "./segment";

// 고정 문장 인식 파이프라인 C1(입술 점) → C2(구간) → C3(정규화) → C4(DTW 1-NN·점수) → C5(게이트).
// 브라우저 순수 로직 — 네트워크 없음. 카메라·MediaPipe는 호출자(Recognizer)가 맡고 여기는 얼굴 점만 받는다.
// 근거: docs/ARCHITECTURE.md "데이터 흐름 — 고정 문장" · A ↔ B 계약 src/types/recognition.ts.

export interface PipelineOptions {
  templates: TemplateSet;
  manualSession?: boolean; // true면 게이트 speak 문턱 0.80
  segment?: SegmentOptions;
  dtw?: DtwOptions;
  score?: Partial<ScoreParams>;
}

export class RecognitionPipeline {
  private readonly templates: TemplateSet;
  private readonly manualSession: boolean;
  private readonly dtw: DtwOptions | undefined;
  private readonly score: Partial<ScoreParams> | undefined;
  private readonly detector: SegmentDetector;

  constructor(options: PipelineOptions) {
    this.templates = options.templates;
    this.manualSession = options.manualSession ?? false;
    this.dtw = options.dtw;
    this.score = options.score;
    this.detector = new SegmentDetector(options.segment);
  }

  /**
   * 한 프레임을 넣는다. 발화 구간이 끝나 판정이 나온 프레임이면 RecognitionEvent(discard 포함), 아니면 null.
   * landmarks가 null(얼굴 없음)이면 진행 중 구간을 버린다(C2 reset) — 얼굴을 놓친 사이의 움직임은 믿을 수 없다.
   */
  push(landmarks: ArrayLike<LandmarkPoint> | null, width: number, height: number, t: number): RecognitionEvent | null {
    if (landmarks === null) {
      this.detector.reset();
      return null;
    }
    // 입술을 뽑을 수 없는 프레임은 받지 않은 것으로 친다 — 길게 이어지면 C2가 프레임 끊김으로 구간을 버린다
    const frame = extractLipFrame(landmarks, width, height, t);
    if (frame === null) return null;

    const segment = this.detector.push(frame);
    if (segment === null) return null;
    const seq = normalizeSegment(segment);
    if (seq === null) return null;
    // 템플릿이 있는 문장이 하나도 없다 — 판정할 것이 없다
    const nearest = nearestPhrases(seq, this.templates, this.dtw);
    if (nearest === null) return null;

    const { label, score, rejected } = scoreNearest(nearest, this.score);
    // 등록 문장이 아니면(getPhrase가 undefined) 이벤트를 만들지 않는다 — 화면에 모르는 텍스트를 띄우지 않는다
    const phrase = getPhrase(label);
    if (phrase === undefined) return null;

    const gate = decideGate({ score, rejected, manualSession: this.manualSession });
    return { phraseId: phrase.id, text: phrase.text, score, gate };
  }

  /** 진행 중 구간을 버리고 처음 상태로 (수동 세션 OFF·카메라 재시작). 템플릿과 설정은 그대로. */
  reset(): void {
    this.detector.reset();
  }
}
