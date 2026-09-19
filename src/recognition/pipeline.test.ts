import { describe, it, expect } from "vitest";
import type { RecognitionEvent } from "@/types/recognition";
import { getPhrase } from "@/lib/phrases";
import { buildTemplateSet, segmentsFromFrames } from "./analysis";
import type { TemplateSet } from "./dtw";
import { extractLipFrame, type LandmarkPoint } from "./lips";
import { RecognitionPipeline, type PipelineOptions } from "./pipeline";
import { LIP_LANDMARK_INDICES, type LipFrame, type Sequence } from "./types";

// ── 합성 얼굴 점 (MediaPipe 없이 — 실제 얼굴·입술 좌표를 레포에 두지 않는다) ──

const REST = 0.05; // 쉬는 입의 안쪽 입술 간격 (입꼬리 거리 1 기준)

/** 입 모양 = 안쪽 입술 간격 open, 입꼬리 거리 width (둘 다 입 크기 단위). */
interface MouthShape {
  open: number;
  width: number;
}

/** 진행도 u(0~1) → 그 순간의 입 모양. */
type Word = (u: number) => MouthShape;

/** 크게 한 번 벌림. */
const openOnce: Word = (u) => ({ open: REST + 0.45 * Math.sin(Math.PI * u), width: 1 });
/** 옆으로 늘리며 두 번 벌림. */
const stretchTwice: Word = (u) => ({
  open: REST + 0.3 * Math.abs(Math.sin(2 * Math.PI * u)),
  width: 1 + 0.35 * Math.sin(Math.PI * u),
});
/** 오므리며 늦게 벌림 — 벌림이 u ≈ 0.7에서 가장 크다. */
const purseLate: Word = (u) => ({
  open: REST + 0.4 * Math.sin(Math.PI * u * u),
  width: 1 - 0.3 * Math.sin(Math.PI * u),
});
/** 등록하지 않은 움직임: 오므리며 빠르게 세 번 벌림. 가장 가까운 템플릿(openOnce)까지 d1 ≈ 0.15. */
const unknownMove: Word = (u) => {
  const beat = Math.abs(Math.sin(3 * Math.PI * u));
  return { open: REST + 0.35 * beat, width: 1 - 0.2 * beat };
};

/** 입술 40점을 LIP_LANDMARK_INDICES 순서로 (바깥·안쪽 타원, 원점 중심, 입 크기 단위). */
function lipPoints({ open, width }: MouthShape): [number, number][] {
  const out: [number, number][] = [];
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < 20; i++) {
      // i = 0 → 왼쪽 입꼬리, 1~9 → 윗입술, 10 → 오른쪽 입꼬리, 11~19 → 아랫입술 (y는 아래로 증가)
      const theta = Math.PI - (i * Math.PI) / 10;
      const halfWidth = (ring === 0 ? 0.5 : 0.4) * width;
      const halfHeight = ring === 0 ? 0.18 + open / 2 : open / 2;
      out.push([halfWidth * Math.cos(theta), -halfHeight * Math.sin(theta)]);
    }
  }
  return out;
}

/** 얼굴 배치: 입 중심 (cx, cy)(영상 비율), 입 크기 scale(영상 세로 비율), 영상 가로·세로. */
interface Placement {
  cx: number;
  cy: number;
  scale: number;
  width: number;
  height: number;
}

const FACES = {
  A: { cx: 0.5, cy: 0.62, scale: 0.12, width: 640, height: 480 },
  B: { cx: 0.38, cy: 0.7, scale: 0.08, width: 1280, height: 720 },
  C: { cx: 0.6, cy: 0.55, scale: 0.15, width: 640, height: 480 },
  // 세로로 세운 태블릿
  D: { cx: 0.45, cy: 0.5, scale: 0.1, width: 720, height: 1280 },
} satisfies Record<string, Placement>;

/** 478점 가짜 얼굴: 입술 40점 자리에 입 모양, 나머지 0.5. */
function face(shape: MouthShape, p: Placement): LandmarkPoint[] {
  const points: LandmarkPoint[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  lipPoints(shape).forEach(([x, y], k) => {
    // extractLipFrame이 x에 가로/세로를 곱하므로 미리 나눠 둔다 — 화면에서 입 모양이 찌그러지지 않게
    points[LIP_LANDMARK_INDICES[k]] = { x: p.cx + (x * p.scale * p.height) / p.width, y: p.cy + y * p.scale };
  });
  return points;
}

/** 말하기 한 번: start부터 durMs 동안 word. 그 밖은 쉬는 입. */
interface Utterance {
  word: Word;
  start: number;
  durMs: number;
}

/** push 한 번에 넣는 것. landmarks null = 얼굴을 놓침. */
interface Input {
  landmarks: LandmarkPoint[] | null;
  width: number;
  height: number;
  t: number;
}

/** 0 ~ totalMs를 fps로 찍은 입력 스트림 (양 끝 포함). */
function faceStream(utterances: readonly Utterance[], totalMs: number, fps: number, p: Placement): Input[] {
  const n = Math.round((totalMs * fps) / 1000);
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = (k * 1000) / fps;
    const now = utterances.find((w) => t > w.start && t < w.start + w.durMs);
    const shape = now ? now.word((t - now.start) / now.durMs) : { open: REST, width: 1 };
    return { landmarks: face(shape, p), width: p.width, height: p.height, t };
  });
}

/** 쉼 1초 → 단어 하나 → 쉼 1.5초. */
function sayWord(word: Word, durMs = 600, fps = 30, p: Placement = FACES.A): Input[] {
  return faceStream([{ word, start: 1000, durMs }], durMs + 2500, fps, p);
}

/** 템플릿 녹화: 실시간과 같은 C1 → C2 → C3 경로로 한 단어를 시퀀스 하나로. */
function record(word: Word, durMs = 600, fps = 30, p: Placement = FACES.A): Sequence {
  const frames: LipFrame[] = [];
  for (const { landmarks, width, height, t } of sayWord(word, durMs, fps, p)) {
    const frame = landmarks && extractLipFrame(landmarks, width, height, t);
    if (frame) frames.push(frame);
  }
  const segments = segmentsFromFrames(frames);
  if (segments.length !== 1) throw new Error(`템플릿 녹화 구간이 1개가 아니다: ${segments.length}`);
  return segments[0].seq;
}

/** 스트림을 순서대로 넣고, 이벤트가 나온 프레임의 t와 함께 모은다. */
function run(pipeline: RecognitionPipeline, inputs: readonly Input[]): { t: number; event: RecognitionEvent }[] {
  const out: { t: number; event: RecognitionEvent }[] = [];
  for (const { landmarks, width, height, t } of inputs) {
    const event = pipeline.push(landmarks, width, height, t);
    if (event !== null) out.push({ t, event });
  }
  return out;
}

function events(inputs: readonly Input[], options: Partial<PipelineOptions> = {}): RecognitionEvent[] {
  return run(new RecognitionPipeline({ templates: TEMPLATES, ...options }), inputs).map((e) => e.event);
}

// 템플릿: 세 단어를 한 번씩, 600ms · 30fps · 얼굴 A로 녹화
const WORDS: [string, Word][] = [
  ["pain", openOnce],
  ["water", stretchTwice],
  ["toilet", purseLate],
];
const TEMPLATES: TemplateSet = buildTemplateSet(WORDS.map(([phraseId, word]) => ({ phraseId, seq: record(word) })));

const FRAME_30 = 1000 / 30;

describe("RecognitionPipeline — 인식", () => {
  const variants: [number, number, keyof typeof FACES][] = [
    [480, 15, "B"],
    [720, 24, "C"],
    [540, 30, "D"],
  ];
  const cases = WORDS.flatMap(([phraseId, word]) =>
    variants.map(([durMs, fps, faceKey]) => [phraseId, durMs, fps, faceKey, word] as const),
  );

  it.each(cases)(
    "%s를 %sms · %sfps · 얼굴 %s로 말하면 → 이벤트 1개, 정답 문장 id·텍스트, speak",
    (phraseId, durMs, fps, faceKey, word) => {
      const out = events(sayWord(word, durMs, fps, FACES[faceKey]));
      expect(out).toHaveLength(1);
      expect(out[0].phraseId).toBe(phraseId);
      expect(out[0].text).toBe(getPhrase(phraseId)?.text);
      expect(out[0].gate).toBe("speak");
    },
  );

  it("템플릿과 똑같은 움직임 → 거리 0, 점수 1, speak", () => {
    expect(events(sayWord(openOnce))).toEqual([{ phraseId: "pain", text: "아파요", score: 1, gate: "speak" }]);
  });
});

describe("RecognitionPipeline — 이벤트 시점", () => {
  it("발화가 끝나고(1600ms) 정지가 500ms 차는 프레임에서 한 번만 나온다", () => {
    const out = run(new RecognitionPipeline({ templates: TEMPLATES }), sayWord(openOnce));
    expect(out).toHaveLength(1);
    expect(out[0].t).toBeGreaterThanOrEqual(1600 + 500);
    expect(out[0].t).toBeLessThan(1600 + 500 + FRAME_30);
  });

  it("쉬기만 하면(5초) 이벤트 없음", () => {
    expect(events(faceStream([], 5000, 30, FACES.A))).toEqual([]);
  });

  it("segment 옵션을 C2에 넘긴다: stillMs 1000이면 정지 1초가 차야 나온다", () => {
    const out = run(new RecognitionPipeline({ templates: TEMPLATES, segment: { stillMs: 1000 } }), sayWord(openOnce));
    expect(out).toHaveLength(1);
    expect(out[0].t).toBeGreaterThanOrEqual(1600 + 1000);
    expect(out[0].t).toBeLessThan(1600 + 1000 + FRAME_30);
    expect(out[0].event.phraseId).toBe("pain");
  });
});

describe("RecognitionPipeline — 판정 게이트", () => {
  it.each([
    [false, "show"],
    [true, "speak"],
  ] as const)("manualSession %s → 점수 0.85에서 %s", (manualSession, gate) => {
    // 똑같은 움직임은 d1 = 0이라 점수 = ratioOffset — 0.85로 두면 0.80~0.90 사이 점수를 정확히 만든다
    const out = events(sayWord(openOnce), { manualSession, score: { ratioOffset: 0.85 } });
    expect(out).toEqual([{ phraseId: "pain", text: "아파요", score: 0.85, gate }]);
  });

  it("어느 템플릿과도 먼 움직임 → discard 이벤트(점수 0, 가장 가까운 문장) — 같은 설정에서 등록 단어는 speak", () => {
    const score = { rejectDistance: 0.1 };
    const out = events(sayWord(unknownMove), { score });
    expect(out).toEqual([{ phraseId: "pain", text: "아파요", score: 0, gate: "discard" }]);
    // 거리로 거절된 것이다 — 속도·얼굴이 달라도 등록 단어(d1 ≤ 0.074)는 그대로 통과
    expect(events(sayWord(purseLate, 480, 15, FACES.B), { score }).map((e) => e.gate)).toEqual(["speak"]);
  });

  it("dtw 옵션을 C4에 넘긴다: 폭 0(대각선만)이면 속도가 다른 발화의 거리가 커져 거절된다", () => {
    // pain 480ms · 15fps: 기본 폭이면 d1 ≈ 0.012, 폭 0이면 ≈ 0.056
    const input = sayWord(openOnce, 480, 15, FACES.B);
    const score = { rejectDistance: 0.03 };
    expect(events(input, { score }).map((e) => e.gate)).toEqual(["speak"]);
    expect(events(input, { score, dtw: { band: 0 } }).map((e) => e.gate)).toEqual(["discard"]);
  });
});

describe("RecognitionPipeline — 버리는 경우", () => {
  // pain(1.0~1.6초) → 쉼 → toilet(4.0~4.6초)
  const twoWords = faceStream(
    [
      { word: openOnce, start: 1000, durMs: 600 },
      { word: purseLate, start: 4000, durMs: 600 },
    ],
    6000,
    30,
    FACES.A,
  );
  const midFirstWord = (t: number) => t >= 1300 && t < 1300 + FRAME_30;

  it("끊김이 없으면 두 단어 모두 인식된다 (아래 사례의 대조군)", () => {
    expect(events(twoWords).map((e) => e.phraseId)).toEqual(["pain", "toilet"]);
  });

  it("얼굴 없음(null) 프레임이 발화 중에 끼면 그 구간은 버려지고, 이후 새 발화는 정상 인식", () => {
    const withLoss = twoWords.map((input) => (midFirstWord(input.t) ? { ...input, landmarks: null } : input));
    const out = events(withLoss);
    expect(out).toHaveLength(1);
    expect(out[0].phraseId).toBe("toilet");
    expect(out[0].gate).toBe("speak");
  });

  it("reset() → 진행 중 구간은 버려지고, 이후 새 발화는 정상 인식", () => {
    const pipeline = new RecognitionPipeline({ templates: TEMPLATES });
    const out: RecognitionEvent[] = [];
    for (const { landmarks, width, height, t } of twoWords) {
      if (midFirstWord(t)) pipeline.reset();
      const event = pipeline.push(landmarks, width, height, t);
      if (event) out.push(event);
    }
    expect(out.map((e) => e.phraseId)).toEqual(["toilet"]);
  });

  it("입술을 뽑을 수 없는 프레임(점 부족·영상 크기 0)은 건너뛴다 — 결과가 깨끗한 스트림과 같다", () => {
    const noisy: Input[] = [];
    twoWords.forEach((input, k) => {
      noisy.push(input);
      if (k % 5 === 2) noisy.push({ ...input, landmarks: input.landmarks?.slice(0, 100) ?? null, t: input.t + 1 });
      if (k % 7 === 3) noisy.push({ ...input, width: 0, t: input.t + 2 });
    });
    const clean = run(new RecognitionPipeline({ templates: TEMPLATES }), twoWords);
    const actual = run(new RecognitionPipeline({ templates: TEMPLATES }), noisy);
    expect(actual).toEqual(clean);
    expect(actual).toHaveLength(2);
  });

  it("템플릿이 비어 있으면({}) 이벤트 없음", () => {
    expect(events(sayWord(openOnce), { templates: {} })).toEqual([]);
  });

  it("등록되지 않은 id(zzz)로만 된 템플릿이면 이벤트 없음", () => {
    expect(events(sayWord(openOnce), { templates: { zzz: [record(openOnce)] } })).toEqual([]);
  });

  it("등록되지 않은 id가 가장 가까우면 다른 등록 문장이 있어도 이벤트 없음 — 모르는 텍스트를 띄우지 않는다", () => {
    const templates = { zzz: [record(openOnce)], water: [record(stretchTwice)] };
    expect(events(sayWord(openOnce), { templates })).toEqual([]);
    // 같은 템플릿으로 등록 문장을 말하면 정상 — 템플릿 세트 자체는 쓸 수 있다
    expect(events(sayWord(stretchTwice), { templates }).map((e) => e.phraseId)).toEqual(["water"]);
  });
});
