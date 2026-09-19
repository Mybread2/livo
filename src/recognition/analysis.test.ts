import { describe, it, expect } from "vitest";
import { buildTemplateSet, leaveOneOut, segmentsFromFrames, type LabeledSequence } from "./analysis";
import { extractLipFrame, type LandmarkPoint } from "./lips";
import { normalizeSegment } from "./normalize";
import { FEATURE_DIM, LIP_LANDMARK_INDICES, SEQ_FRAMES, type LipFrame, type Sequence } from "./types";

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

const FACE_A: Placement = { cx: 0.5, cy: 0.62, scale: 0.12, width: 640, height: 480 };
const FACE_B: Placement = { cx: 0.38, cy: 0.7, scale: 0.08, width: 1280, height: 720 };

/** 478점 가짜 얼굴: 입술 40점 자리에 입 모양, 나머지 0.5. */
function face(shape: MouthShape, p: Placement): LandmarkPoint[] {
  const points: LandmarkPoint[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  lipPoints(shape).forEach(([x, y], k) => {
    // extractLipFrame이 x에 가로/세로를 곱하므로 미리 나눠 둔다 — 화면에서 입 모양이 찌그러지지 않게
    points[LIP_LANDMARK_INDICES[k]] = { x: p.cx + (x * p.scale * p.height) / p.width, y: p.cy + y * p.scale };
  });
  return points;
}

/** 말하기 한 번: 쉼 → 단어(start부터 durMs 동안) → 쉼. */
interface Utterance {
  word: Word;
  start: number;
  durMs: number;
}

/** 0 ~ totalMs를 fps로 찍은 LipFrame 스트림. 얼굴 점을 만들어 C1(extractLipFrame)을 거친다. */
function lipStream(utterances: readonly Utterance[], totalMs: number, fps: number, p: Placement): LipFrame[] {
  const n = Math.round((totalMs * fps) / 1000);
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = (k * 1000) / fps;
    const now = utterances.find((w) => t > w.start && t < w.start + w.durMs);
    const shape = now ? now.word((t - now.start) / now.durMs) : { open: REST, width: 1 };
    const frame = extractLipFrame(face(shape, p), p.width, p.height, t);
    if (frame === null) throw new Error("합성 얼굴에서 입술을 뽑지 못했다");
    return frame;
  });
}

/** 한 단어만 말한 스트림을 정규화 시퀀스 하나로. */
function sayOnce(word: Word, durMs: number, fps: number, p: Placement): Sequence {
  const segments = segmentsFromFrames(lipStream([{ word, start: 1000, durMs }], durMs + 2000, fps, p));
  if (segments.length !== 1) throw new Error(`구간이 1개가 아니다: ${segments.length}`);
  return segments[0].seq;
}

/** 합성 행 하나짜리 시퀀스 — 묶음 테스트에서 어떤 표본인지 값으로 구분한다. */
function marker(value: number): Sequence {
  return Array.from({ length: SEQ_FRAMES }, () => new Float32Array(FEATURE_DIM).fill(value));
}

describe("segmentsFromFrames", () => {
  it("단어 두 개 스트림 → 2구간, 각 구간은 C2가 자른 프레임과 그것을 C3 정규화한 32×80 시퀀스", () => {
    const frames = lipStream(
      [
        { word: openOnce, start: 1000, durMs: 600 },
        { word: purseLate, start: 2800, durMs: 600 },
      ],
      4500,
      30,
      FACE_A,
    );
    const segments = segmentsFromFrames(frames);
    expect(segments).toHaveLength(2);
    const [first, second] = segments;
    // 두 구간은 겹치지 않고 각자의 단어 근처에 있다
    expect(first.frames[0].t).toBeLessThanOrEqual(1000);
    expect(first.frames[first.frames.length - 1].t).toBeLessThan(1700);
    expect(second.frames[0].t).toBeGreaterThan(2400);
    expect(second.frames[second.frames.length - 1].t).toBeLessThan(3500);
    for (const { frames: segFrames, seq } of segments) {
      expect(seq).toHaveLength(SEQ_FRAMES);
      for (const row of seq) expect(row).toHaveLength(FEATURE_DIM);
      expect(seq).toEqual(normalizeSegment(segFrames));
      // 입력 스트림의 프레임 객체 그대로 (복사본이 아니다)
      expect(frames).toContain(segFrames[0]);
    }
  });

  it("쉬기만 한 스트림 → 빈 배열", () => {
    expect(segmentsFromFrames(lipStream([], 3000, 30, FACE_A))).toEqual([]);
  });

  it("C2 옵션을 넘긴다: stillMs를 줄이면 0.3초 쉼을 둔 두 단어도 2구간", () => {
    const frames = lipStream(
      [
        { word: openOnce, start: 1000, durMs: 600 },
        { word: openOnce, start: 1900, durMs: 600 },
      ],
      3500,
      30,
      FACE_A,
    );
    expect(segmentsFromFrames(frames)).toHaveLength(1);
    expect(segmentsFromFrames(frames, { stillMs: 200 })).toHaveLength(2);
  });
});

describe("buildTemplateSet", () => {
  it("문장별로 묶는다 — 문장은 처음 나온 순서, 문장 안 템플릿은 입력 순서", () => {
    const [a1, b1, a2, c1, b2] = [1, 2, 3, 4, 5].map(marker);
    const samples: LabeledSequence[] = [
      { phraseId: "water", seq: a1 },
      { phraseId: "pain", seq: b1 },
      { phraseId: "water", seq: a2 },
      { phraseId: "toilet", seq: c1 },
      { phraseId: "pain", seq: b2 },
    ];
    const set = buildTemplateSet(samples);
    expect(Object.keys(set)).toEqual(["water", "pain", "toilet"]);
    expect(set.water).toEqual([a1, a2]);
    expect(set.pain).toEqual([b1, b2]);
    expect(set.toilet).toEqual([c1]);
    // 시퀀스는 복사하지 않고 그대로 담는다
    expect(set.water[0]).toBe(a1);
  });

  it("빈 입력 → 빈 세트", () => {
    expect(buildTemplateSet([])).toEqual({});
  });
});

describe("leaveOneOut", () => {
  // 각 단어를 서로 다른 속도·프레임률·얼굴 위치로 3회
  const takes: { durMs: number; fps: number; p: Placement }[] = [
    { durMs: 600, fps: 30, p: FACE_A },
    { durMs: 480, fps: 15, p: FACE_B },
    { durMs: 720, fps: 24, p: { ...FACE_A, cx: 0.6, cy: 0.55, scale: 0.15 } },
  ];
  const words: [string, Word][] = [
    ["pain", openOnce],
    ["water", stretchTwice],
    ["toilet", purseLate],
  ];
  const samples: LabeledSequence[] = words.flatMap(([phraseId, word]) =>
    takes.map(({ durMs, fps, p }) => ({ phraseId, seq: sayOnce(word, durMs, fps, p) })),
  );

  it("합성 3단어 × 3회 → 9행 모두 정답, 거절 없음", () => {
    const rows = leaveOneOut(samples);
    expect(rows).toHaveLength(9);
    rows.forEach((row, k) => {
      expect(row.index).toBe(k);
      expect(row.phraseId).toBe(samples[k].phraseId);
      expect(row.predicted).toBe(samples[k].phraseId);
      expect(row.rejected).toBe(false);
      // 가장 가까운 문장이 두 번째 문장보다 가깝고, 점수는 0~1
      expect(row.d1).toBeLessThan(row.d2);
      expect(row.score).toBeGreaterThan(0);
      expect(row.score).toBeLessThanOrEqual(1);
    });
  });

  it("자기 자신은 템플릿에서 빠진다 — 같은 표본이 템플릿이면 d1이 0이지만 여기서는 0보다 크다", () => {
    for (const row of leaveOneOut(samples)) expect(row.d1).toBeGreaterThan(0);
  });

  it("표본이 하나뿐이면 남은 템플릿이 없다 → predicted null, 거절, 점수 0", () => {
    expect(leaveOneOut([samples[0]])).toEqual([
      {
        index: 0,
        phraseId: "pain",
        predicted: null,
        d1: Number.POSITIVE_INFINITY,
        d2: Number.POSITIVE_INFINITY,
        score: 0,
        rejected: true,
      },
    ]);
  });

  it("빈 입력 → 빈 배열", () => {
    expect(leaveOneOut([])).toEqual([]);
  });
});
