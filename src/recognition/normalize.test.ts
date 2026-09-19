import { describe, it, expect } from "vitest";
import { normalizeSegment } from "./normalize";
import {
  CORNER_A,
  CORNER_B,
  FEATURE_DIM,
  LIP_LANDMARK_INDICES,
  LIP_POINT_COUNT,
  SEQ_FRAMES,
  type LipFrame,
  type Sequence,
} from "./types";

// ── 입 모양 생성 도우미 (합성 좌표만 쓴다 — 실제 입술 좌표를 레포에 두지 않는다) ──

interface MouthShape {
  /** 바깥 입술 가로 반지름 = 입꼬리 거리의 절반. */
  rx: number;
  /** 바깥 입술 세로 반지름. */
  ry: number;
  /** 안쪽 입술 세로 반지름 = 입 벌림. */
  openY: number;
}

/** 구간 안 진행도 s(0~1) → 그 순간의 입 모양. */
type Motion = (s: number) => MouthShape;

type Transform = (x: number, y: number) => [number, number];

/**
 * 원점 중심 타원 위 40점. 바깥 20점은 입꼬리 61(왼쪽, 순번 0) → 윗입술 → 입꼬리 291(오른쪽, 순번 10)
 * → 아랫입술 순서이고, 안쪽 20점도 같은 각도 순서다. 각도가 원을 고르게 나누므로 40점 평균은 원점이다.
 */
function mouthPoints({ rx, ry, openY }: MouthShape): number[] {
  const pts = new Array<number>(FEATURE_DIM);
  for (let i = 0; i < 20; i++) {
    const theta = Math.PI - (i * Math.PI) / 10;
    // 영상 좌표는 y가 아래로 커진다 — 윗입술이 음수 y
    pts[2 * i] = rx * Math.cos(theta);
    pts[2 * i + 1] = -ry * Math.sin(theta);
    pts[2 * (i + 20)] = 0.8 * rx * Math.cos(theta);
    pts[2 * (i + 20) + 1] = -openY * Math.sin(theta);
  }
  return pts;
}

/** 크기 k로 키우고 deg만큼 돌린 뒤 (cx, cy)로 옮긴다. */
function place(cx: number, cy: number, k: number, deg: number): Transform {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return (x, y) => [cx + k * (c * x - s * y), cy + k * (s * x + c * y)];
}

function then(first: Transform, next: Transform): Transform {
  return (x, y) => next(...first(x, y));
}

/** 점 (px, py)를 중심으로 deg만큼 돌린다. */
function rotateAbout(px: number, py: number, deg: number): Transform {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return (x, y) => [px + c * (x - px) - s * (y - py), py + s * (x - px) + c * (y - py)];
}

/** 화면 가운데쯤, 얼굴 폭의 일부 크기로, 고개를 조금 기울인 기본 배치. */
const BASE = place(0.9, 0.6, 0.08, 5);

/** 움직임을 주어진 시각들에서 샘플링해 C1 출력처럼 만든다. */
function sampleSegment(motion: Motion, times: number[], transform: Transform = BASE): LipFrame[] {
  const t0 = times[0];
  const span = times[times.length - 1] - t0;
  return times.map((t) => {
    const raw = mouthPoints(motion((t - t0) / span));
    const points = new Float32Array(FEATURE_DIM);
    for (let i = 0; i < LIP_POINT_COUNT; i++) {
      const [x, y] = transform(raw[2 * i], raw[2 * i + 1]);
      points[2 * i] = x;
      points[2 * i + 1] = y;
    }
    return { t, points };
  });
}

/** fps로 durationMs 동안 찍은 시각(양 끝 포함). */
function fpsTimes(fps: number, durationMs: number): number[] {
  const n = Math.round((durationMs * fps) / 1000);
  return Array.from({ length: n + 1 }, (_, k) => (k * 1000) / fps);
}

// 말하는 듯한 움직임: 입이 벌어졌다 닫히면서 가로도 조금 늘었다 준다
const speakMotion: Motion = (s) => ({
  rx: 1 + 0.15 * Math.sin(Math.PI * s),
  ry: 0.35 + 0.15 * Math.sin(Math.PI * s),
  openY: 0.05 + 0.3 * Math.sin(Math.PI * s),
});
// 세로로만 벌린다 (입꼬리 거리 고정)
const openMotion: Motion = (s) => ({ rx: 1, ry: 0.35 + 0.2 * s, openY: 0.05 + 0.3 * s });
// 가로로만 늘린다 (입꼬리 거리 1 → 1.5배)
const widenMotion: Motion = (s) => ({ rx: 1 + 0.5 * s, ry: 0.35, openY: 0.05 });

function normalizeOrFail(frames: LipFrame[]): Sequence {
  const out = normalizeSegment(frames);
  if (out === null) throw new Error("normalizeSegment가 null을 반환했다");
  return out;
}

function maxAbsDiff(a: Sequence, b: Sequence): number {
  expect(a.length).toBe(b.length);
  let m = 0;
  for (let j = 0; j < a.length; j++) {
    for (let i = 0; i < FEATURE_DIM; i++) m = Math.max(m, Math.abs(a[j][i] - b[j][i]));
  }
  return m;
}

function cornerDistance(row: Float32Array): number {
  return Math.hypot(row[2 * CORNER_B] - row[2 * CORNER_A], row[2 * CORNER_B + 1] - row[2 * CORNER_A + 1]);
}

const TIMES_30FPS = fpsTimes(30, 1000);

describe("입술 점 상수", () => {
  it("입꼬리 기준점은 landmark 61·291이고 40점은 서로 다르다", () => {
    expect(LIP_LANDMARK_INDICES[CORNER_A]).toBe(61);
    expect(LIP_LANDMARK_INDICES[CORNER_B]).toBe(291);
    expect(new Set(LIP_LANDMARK_INDICES).size).toBe(LIP_POINT_COUNT);
    expect(FEATURE_DIM).toBe(80);
  });
});

describe("normalizeSegment (C3 정규화)", () => {
  const base = () => normalizeOrFail(sampleSegment(speakMotion, TIMES_30FPS));

  it("SEQ_FRAMES개 행, 각 행은 길이 FEATURE_DIM의 Float32Array", () => {
    const out = base();
    expect(out).toHaveLength(SEQ_FRAMES);
    for (const row of out) {
      expect(row).toBeInstanceOf(Float32Array);
      expect(row).toHaveLength(FEATURE_DIM);
    }
  });

  it("이동 불변: 모든 점을 (dx, dy)만큼 옮겨도 같다", () => {
    const moved = sampleSegment(speakMotion, TIMES_30FPS, then(BASE, (x, y) => [x + 0.37, y - 0.21]));
    expect(maxAbsDiff(normalizeOrFail(moved), base())).toBeLessThan(1e-4);
  });

  it.each([0.5, 3])("크기 불변: 모든 좌표에 k=%s를 곱해도 같다", (k) => {
    const scaled = sampleSegment(speakMotion, TIMES_30FPS, then(BASE, (x, y) => [k * x, k * y]));
    expect(maxAbsDiff(normalizeOrFail(scaled), base())).toBeLessThan(1e-4);
  });

  it.each([20, -20])("회전 불변: 임의 점 기준으로 %s° 돌려도 같다", (deg) => {
    const rotated = sampleSegment(speakMotion, TIMES_30FPS, then(BASE, rotateAbout(0.3, 1.1, deg)));
    expect(maxAbsDiff(normalizeOrFail(rotated), base())).toBeLessThan(1e-4);
  });

  it("프레임률 불변: 같은 움직임을 15fps와 30fps로 찍어도 거의 같다", () => {
    const at15 = normalizeOrFail(sampleSegment(speakMotion, fpsTimes(15, 1000)));
    const at30 = normalizeOrFail(sampleSegment(speakMotion, fpsTimes(30, 1000)));
    // 허용오차 1e-2 근거: 두 입력 모두 곡선을 선형 보간하므로 오차 상한은 h²/8·max|f''|다.
    // 정규화 좌표(입꼬리 거리 ≈ 2로 나눔)에서 가장 크게 움직이는 안쪽 입술은 진폭 ≈ 0.15, f'' ≤ 0.15·π² ≈ 1.5이고
    // 15fps(h = 1/15초)면 상한 ≈ 8e-4. 입꼬리 거리 중앙값도 표본 수에 따라 약 4e-4(상대) 달라진다.
    // 합쳐도 약 1e-3이라 1e-2는 10배 여유다. 프레임 수·간격이 결과를 크게 바꾸는 구현(예: 시간 대신 인덱스 기준)은 걸린다.
    expect(maxAbsDiff(at15, at30)).toBeLessThan(1e-2);
  });

  it("비균일 간격: t 간격이 들쭉날쭉해도 시간에 선형인 좌표는 정확히 보간된다", () => {
    const times = [0, 7, 40, 41, 95, 180, 233, 390, 402, 500];
    const out = normalizeOrFail(sampleSegment(openMotion, times));
    // openMotion은 입꼬리가 고정(거리 2)·중심 고정·기울기 고정이라 정규화 좌표 = mouthPoints(s) / 2 — s에 선형이다
    for (let j = 0; j < SEQ_FRAMES; j++) {
      const expected = mouthPoints(openMotion(j / (SEQ_FRAMES - 1))).map((v) => v / 2);
      // BASE의 5° 기울기는 정규화가 없앤다 — 기대값은 기울기 없는 원래 모양
      for (let i = 0; i < FEATURE_DIM; i++) {
        expect(Math.abs(out[j][i] - expected[i])).toBeLessThan(1e-5);
      }
    }
  });

  it("모양 보존: 세로로 벌림 ≠ 가로로 늘림, 가로로 늘린 비율이 결과에 남는다", () => {
    const opened = normalizeOrFail(sampleSegment(openMotion, TIMES_30FPS));
    const widened = normalizeOrFail(sampleSegment(widenMotion, TIMES_30FPS));
    expect(maxAbsDiff(opened, widened)).toBeGreaterThan(0.05);
    // 프레임마다 입꼬리 거리로 나누면 이 비율이 1로 사라진다 — 구간 중앙값 하나로 나누므로 1.5가 남는다
    const ratio = cornerDistance(widened[SEQ_FRAMES - 1]) / cornerDistance(widened[0]);
    expect(ratio).toBeCloseTo(1.5, 5);
  });

  describe("null — 애매하면 안 나오는 쪽 (호출자가 discard)", () => {
    it("프레임이 2개 미만", () => {
      expect(normalizeSegment([])).toBeNull();
      expect(normalizeSegment(sampleSegment(speakMotion, TIMES_30FPS).slice(0, 1))).toBeNull();
    });

    it("t가 엄격히 증가하지 않음 (첫·마지막 t가 같은 경우 포함)", () => {
      const withTimes = (ts: number[]): LipFrame[] => {
        const frames = sampleSegment(speakMotion, fpsTimes(30, (ts.length - 1) * (1000 / 30)));
        return frames.map((f, i) => ({ t: ts[i], points: f.points }));
      };
      expect(normalizeSegment(withTimes([0, 10, 10, 20]))).toBeNull(); // 같은 t
      expect(normalizeSegment(withTimes([0, 20, 10, 30]))).toBeNull(); // 뒤로 감
      expect(normalizeSegment(withTimes([5, 5]))).toBeNull(); // 첫 = 마지막
      expect(normalizeSegment(withTimes([0, Number.NaN, 20]))).toBeNull(); // 비교 불가
      expect(normalizeSegment(withTimes([0, 10, Number.POSITIVE_INFINITY]))).toBeNull(); // 보간 불가
    });

    it("어떤 프레임의 points 길이가 FEATURE_DIM이 아님", () => {
      for (const len of [FEATURE_DIM - 2, FEATURE_DIM + 2]) {
        const frames = sampleSegment(speakMotion, TIMES_30FPS);
        frames[3] = { t: frames[3].t, points: new Float32Array(len).fill(0.5) };
        expect(normalizeSegment(frames)).toBeNull();
      }
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      "좌표에 %s가 있음",
      (bad) => {
        const frames = sampleSegment(speakMotion, TIMES_30FPS);
        frames[5].points[17] = bad;
        expect(normalizeSegment(frames)).toBeNull();
      },
    );

    it("입꼬리 거리 중앙값이 1e-6 이하", () => {
      // 얼굴이 사실상 점 하나 (입꼬리 거리 2e-7)
      expect(normalizeSegment(sampleSegment(speakMotion, TIMES_30FPS, place(0.5, 0.5, 1e-7, 0)))).toBeNull();
      // 한 프레임만 정상이고 나머지는 입꼬리가 겹침 — 평균·최댓값이 아니라 중앙값으로 판단한다
      const frames = sampleSegment(speakMotion, [0, 10, 20]);
      for (const f of [frames[0], frames[2]]) {
        f.points[2 * CORNER_B] = f.points[2 * CORNER_A];
        f.points[2 * CORNER_B + 1] = f.points[2 * CORNER_A + 1];
      }
      expect(normalizeSegment(frames)).toBeNull();
    });
  });
});
