import { describe, it, expect } from "vitest";
import { DEFAULT_SEGMENT_OPTIONS, SegmentDetector, mouthOpenness, type SegmentOptions } from "./segment";
import { normalizeSegment } from "./normalize";
import { CORNER_A, CORNER_B, FEATURE_DIM, LIP_LANDMARK_INDICES, type LipFrame } from "./types";

// ── 입 모양 생성 도우미 (합성 좌표만 쓴다 — 실제 입술 좌표를 레포에 두지 않는다) ──

const UPPER_INNER = LIP_LANDMARK_INDICES.indexOf(13);
const LOWER_INNER = LIP_LANDMARK_INDICES.indexOf(14);

function setPoint(pts: Float32Array, p: number, x: number, y: number): void {
  pts[2 * p] = x;
  pts[2 * p + 1] = y;
}

/**
 * 입꼬리 거리 1, 안쪽 입술 13·14번 사이 거리 = openness인 40점.
 * 나머지 점은 입 둘레 타원 위에 둔다 — 개폐량 계산에는 쓰이지 않지만 C3 정규화에 넣을 수 있는 모양이어야 한다.
 */
function mouth(openness: number): Float32Array {
  const pts = new Float32Array(FEATURE_DIM);
  for (let i = 0; i < 20; i++) {
    const theta = Math.PI - (i * Math.PI) / 10;
    setPoint(pts, i, 0.5 * Math.cos(theta), -0.2 * Math.sin(theta));
    setPoint(pts, i + 20, 0.4 * Math.cos(theta), -(openness / 2) * Math.sin(theta));
  }
  setPoint(pts, CORNER_A, -0.5, 0);
  setPoint(pts, CORNER_B, 0.5, 0);
  setPoint(pts, UPPER_INNER, 0, -openness / 2);
  setPoint(pts, LOWER_INNER, 0, openness / 2);
  return pts;
}

/** 시각(ms) → 그 순간의 개폐량. */
type Profile = (t: number) => number;

const REST = 0.05; // 쉬는 입의 개폐량

/** 쉬는 입의 흔들림 ±0.01 (결정적 — 난수를 쓰지 않는다). */
const wobble: Profile = (t) => 0.01 * Math.sin(t * 0.037);

/** start부터 dur 동안 개폐량이 height만큼 올랐다 내려오는(반 사인) 단어 하나. 그 밖에서는 0. */
function word(start: number, dur: number, height = 0.35): Profile {
  return (t) => (t <= start || t >= start + dur ? 0 : height * Math.sin((Math.PI * (t - start)) / dur));
}

/** 휴지 개폐량 rest에 움직임들을 더한다. */
function mouthProfile(rest: number, ...parts: Profile[]): Profile {
  return (t) => rest + parts.reduce((sum, part) => sum + part(t), 0);
}

/** 0 ~ durationMs를 fps로 찍은 LipFrame 스트림 (양 끝 포함). */
function stream(profile: Profile, durationMs: number, fps = 30): LipFrame[] {
  const n = Math.round((durationMs * fps) / 1000);
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = (k * 1000) / fps;
    return { t, points: mouth(profile(t)) };
  });
}

/** 스트림을 순서대로 push하고 내보낸 구간을 모은다. */
function detect(frames: readonly LipFrame[], detector = new SegmentDetector()): LipFrame[][] {
  const out: LipFrame[][] = [];
  for (const f of frames) {
    const seg = detector.push(f);
    if (seg !== null) out.push(seg);
  }
  return out;
}

function span(seg: readonly LipFrame[]): number {
  return seg[seg.length - 1].t - seg[0].t;
}

const FRAME_30 = 1000 / 30;
const { preRollMs, maxGapMs } = DEFAULT_SEGMENT_OPTIONS;

// 쉼 1초 → 0.6초 동안 0.05→0.4→0.05 → 쉼 1초
const ONE_WORD = mouthProfile(REST, wobble, word(1000, 600));
const ONE_WORD_MS = 2600;

describe("mouthOpenness (C2 기준 신호)", () => {
  /** 입꼬리 (±1, 0) — 거리 2, 안쪽 입술 (0, ∓0.3) — 간격 0.6. */
  function wideMouth(): Float32Array {
    const pts = mouth(0.5);
    setPoint(pts, CORNER_A, -1, 0);
    setPoint(pts, CORNER_B, 1, 0);
    setPoint(pts, UPPER_INNER, 0, -0.3);
    setPoint(pts, LOWER_INNER, 0, 0.3);
    return pts;
  }

  function transformed(pts: Float32Array, f: (x: number, y: number) => [number, number]): Float32Array {
    const out = new Float32Array(FEATURE_DIM);
    for (let p = 0; p < FEATURE_DIM / 2; p++) {
      const [x, y] = f(pts[2 * p], pts[2 * p + 1]);
      setPoint(out, p, x, y);
    }
    return out;
  }

  it("안쪽 입술 13·14번 간격 ÷ 입꼬리 61·291번 거리 (2·0.6 → 0.3)", () => {
    expect(mouthOpenness(wideMouth())).toBeCloseTo(0.3, 6);
  });

  it("이동·확대·회전에 불변", () => {
    const r = (35 * Math.PI) / 180;
    const moved = transformed(wideMouth(), (x, y) => [x + 0.7, y - 0.4]);
    const scaled = transformed(wideMouth(), (x, y) => [0.08 * x, 0.08 * y]);
    const rotated = transformed(wideMouth(), (x, y) => [
      Math.cos(r) * x - Math.sin(r) * y,
      Math.sin(r) * x + Math.cos(r) * y,
    ]);
    for (const pts of [moved, scaled, rotated]) expect(mouthOpenness(pts)).toBeCloseTo(0.3, 5);
  });

  it("입꼬리가 겹치면(거리 1e-6 이하) NaN", () => {
    const overlapped = mouth(0.3);
    setPoint(overlapped, CORNER_B, -0.5, 0);
    expect(mouthOpenness(overlapped)).toBeNaN();
    const nearly = mouth(0.3);
    setPoint(nearly, CORNER_B, -0.5 + 5e-7, 0);
    expect(mouthOpenness(nearly)).toBeNaN();
  });
});

describe("SegmentDetector (C2 구간 검출)", () => {
  it("쉬기만 하면(0.05 ± 0.01 흔들림, 3초) 한 번도 내보내지 않는다", () => {
    expect(detect(stream(mouthProfile(REST, wobble), 3000))).toHaveLength(0);
  });

  it("단어 하나 → 정확히 1구간: 시작은 preRoll 안쪽, 끝은 움직임이 멎은 시각 ± 한 프레임, C3에 넣을 수 있다", () => {
    const segments = detect(stream(ONE_WORD, ONE_WORD_MS));
    expect(segments).toHaveLength(1);
    const [seg] = segments;
    // 입을 떼기 직전 움직임까지 담되, 그보다 앞의 쉼은 담지 않는다
    expect(seg[0].t).toBeGreaterThanOrEqual(1000 - preRollMs);
    expect(seg[0].t).toBeLessThanOrEqual(1000);
    // 정지 대기(stillMs) 동안의 프레임은 빠지고 마지막 움직임에서 끝난다
    expect(Math.abs(seg[seg.length - 1].t - 1600)).toBeLessThanOrEqual(FRAME_30 + 1e-9);
    for (let k = 1; k < seg.length; k++) expect(seg[k].t).toBeGreaterThan(seg[k - 1].t);
    expect(normalizeSegment(seg)).not.toBeNull();
  });

  it("단어 두 개가 0.8초 쉼을 두고 → 2구간, 서로 겹치지 않는다", () => {
    const profile = mouthProfile(REST, wobble, word(1000, 600), word(2400, 600));
    const segments = detect(stream(profile, 4000));
    expect(segments).toHaveLength(2);
    expect(segments[0][segments[0].length - 1].t).toBeLessThan(1700);
    expect(segments[1][0].t).toBeGreaterThanOrEqual(2400 - preRollMs);
  });

  it("단어 두 개가 0.3초 쉼(< stillMs)을 두고 → 1구간으로 합쳐진다", () => {
    const profile = mouthProfile(REST, wobble, word(1000, 600), word(1900, 600));
    const segments = detect(stream(profile, 3500));
    expect(segments).toHaveLength(1);
    expect(segments[0][0].t).toBeLessThanOrEqual(1000);
    expect(Math.abs(segments[0][segments[0].length - 1].t - 2500)).toBeLessThanOrEqual(FRAME_30 + 1e-9);
  });

  it("너무 짧은 움직임(0.1초) → 내보내지 않는다", () => {
    // 길이는 움직임(시작 판정 ~ 마지막 움직임)으로 잰다 — 앞에 붙인 preRoll(200ms)까지 세면 0.1초 움직임도 250ms를 넘는다
    const profile = mouthProfile(REST, wobble, word(1000, 100));
    expect(detect(stream(profile, 2500))).toHaveLength(0);
  });

  it("너무 긴 움직임(4초 동안 계속) → 내보내지 않고, 그 뒤 쉼 → 단어는 정상 1구간 (회복)", () => {
    // 0.5초 주기로 입을 계속 여닫는다 (씹기·긴 혼잣말). 1초~5초
    const chewing: Profile = (t) => (t <= 1000 || t >= 5000 ? 0 : 0.35 * Math.sin((Math.PI * (t - 1000)) / 500) ** 2);
    const profile = mouthProfile(REST, wobble, chewing, word(6000, 600));
    const segments = detect(stream(profile, 7600));
    // maxMs(3초)에서 버린 뒤 남은 1초 꼬리도 새 구간으로 잡지 않는다
    expect(segments).toHaveLength(1);
    // 긴 움직임의 어느 조각도 아니고, 뒤의 단어다
    expect(segments[0][0].t).toBeGreaterThanOrEqual(6000 - preRollMs);
    expect(segments[0][0].t).toBeLessThanOrEqual(6000);
  });

  it("발화 중 프레임 간격이 maxGapMs보다 크게 끊기면 그 구간은 내보내지 않는다 (뒤 단어는 정상)", () => {
    const profile = mouthProfile(REST, wobble, word(1000, 600), word(3000, 600));
    // 단어 한가운데 1200~1500ms 프레임이 빠진다 (간격 300ms > 250ms)
    const frames = stream(profile, 4600).filter((f) => f.t <= 1200 || f.t >= 1500);
    expect(1500 - 1200).toBeGreaterThan(maxGapMs);
    const segments = detect(frames);
    expect(segments).toHaveLength(1);
    expect(segments[0][0].t).toBeGreaterThanOrEqual(3000 - preRollMs);
  });

  it("프레임률: 같은 단어를 15fps·30fps로 → 둘 다 1구간, 구간 길이 차이 < 150ms", () => {
    const at15 = detect(stream(ONE_WORD, ONE_WORD_MS, 15));
    const at30 = detect(stream(ONE_WORD, ONE_WORD_MS, 30));
    expect(at15).toHaveLength(1);
    expect(at30).toHaveLength(1);
    expect(Math.abs(span(at15[0]) - span(at30[0]))).toBeLessThan(150);
  });

  describe("휴지 기준 적응", () => {
    it("살짝 벌린 채(0.12) 쉬어도 시작하지 않고, 거기서 단어를 말하면 1구간", () => {
      // 1초에 0.05 → 0.12로 벌리고(차이 0.07 < startDelta) 3초 쉰 뒤 4초에 단어
      const ajar: Profile = (t) => (t < 1000 ? 0 : 0.07);
      const rest = mouthProfile(REST, wobble, ajar);
      expect(detect(stream(rest, 4000))).toHaveLength(0);

      const segments = detect(stream(mouthProfile(REST, wobble, ajar, word(4000, 600)), 5600));
      expect(segments).toHaveLength(1);
      expect(segments[0][0].t).toBeGreaterThanOrEqual(4000 - preRollMs);
      expect(segments[0][0].t).toBeLessThanOrEqual(4000);
    });

    it.each([15, 30])(
      "천천히(1~5초, 초당 0.07) 벌어지면 처음 기준 + startDelta를 넘어도 시작하지 않는다 — %sfps",
      (fps) => {
        // 시간 상수 1초면 휴지 기준이 0.07 이내로 따라온다(< startDelta).
        // 가중치를 프레임 간격이 아니라 프레임마다 고정하면 낮은 프레임률에서 더 늦게 따라와 드리프트를 발화로 잡는다
        const drift: Profile = (t) => 0.07 * Math.min(Math.max(t - 1000, 0) / 1000, 4);
        const segments = detect(stream(mouthProfile(REST, drift, word(7000, 600)), 8600, fps));
        expect(segments).toHaveLength(1);
        expect(segments[0][0].t).toBeGreaterThanOrEqual(7000 - preRollMs);
      },
    );
  });

  it("reset() → 진행 중 구간이 버려지고, 이후 새 단어는 정상 검출", () => {
    const detector = new SegmentDetector();
    const frames = stream(mouthProfile(REST, wobble, word(1000, 600), word(3000, 600)), 4600);
    const out: LipFrame[][] = [];
    for (const f of frames) {
      // 첫 단어 한가운데서 얼굴을 놓쳤다
      if (f.t >= 1300 && f.t < 1300 + FRAME_30) detector.reset();
      const seg = detector.push(f);
      if (seg !== null) out.push(seg);
    }
    expect(out).toHaveLength(1);
    expect(out[0][0].t).toBeGreaterThanOrEqual(3000 - preRollMs);
  });

  it("reset() 뒤에는 시간축이 처음부터 다시 시작해도 받는다 (카메라 재시작)", () => {
    const detector = new SegmentDetector();
    expect(detect(stream(ONE_WORD, ONE_WORD_MS), detector)).toHaveLength(1);
    detector.reset();
    const segments = detect(stream(ONE_WORD, ONE_WORD_MS), detector);
    expect(segments).toHaveLength(1);
    expect(segments[0][0].t).toBeLessThanOrEqual(1000);
  });

  it("개폐량이 NaN인 프레임·t가 증가하지 않는 프레임은 무시된다 (결과가 깨끗한 스트림과 같다)", () => {
    const clean = stream(ONE_WORD, ONE_WORD_MS);
    const noisy: LipFrame[] = [];
    clean.forEach((f, k) => {
      noisy.push(f);
      if (k % 7 === 3) {
        const overlapped = mouth(0.9);
        setPoint(overlapped, CORNER_B, -0.5, 0); // 입꼬리가 겹침 → NaN
        noisy.push({ t: f.t + 1, points: overlapped });
      }
      if (k % 11 === 5) noisy.push({ t: f.t, points: mouth(0.9) }); // 같은 t
      if (k % 13 === 6) noisy.push({ t: f.t - 10, points: mouth(0.9) }); // 뒤로 감
      if (k === 40) noisy.push({ t: Number.NaN, points: mouth(0.9) }); // 비교 불가
    });
    const expected = detect(clean);
    const actual = detect(noisy);
    expect(actual).toHaveLength(1);
    expect(actual[0].map((f) => f.t)).toEqual(expected[0].map((f) => f.t));
  });

  describe("옵션", () => {
    it("기본값 = DEFAULT_SEGMENT_OPTIONS", () => {
      expect(DEFAULT_SEGMENT_OPTIONS).toEqual({
        startDelta: 0.1,
        stillDelta: 0.03,
        stillMs: 500,
        preRollMs: 200,
        minMs: 250,
        maxMs: 3000,
        maxGapMs: 250,
        baselineTauMs: 1000,
      });
    });

    const twoWordsClose = stream(mouthProfile(REST, wobble, word(1000, 600), word(1900, 600)), 3500);

    it("stillMs를 줄이면 0.3초 쉼에서도 끊긴다", () => {
      expect(detect(twoWordsClose, new SegmentDetector({ stillMs: 200 }))).toHaveLength(2);
    });

    it("값을 undefined로 주면 기본값을 쓴다", () => {
      const options: SegmentOptions = { stillMs: undefined };
      expect(detect(twoWordsClose, new SegmentDetector(options))).toHaveLength(1);
    });

    it("minMs를 줄이면 짧은 움직임도 내보낸다", () => {
      const short = stream(mouthProfile(REST, wobble, word(1000, 100)), 2500);
      expect(detect(short, new SegmentDetector({ minMs: 50 }))).toHaveLength(1);
    });

    it("maxMs를 줄이면 보통 단어도 버린다", () => {
      expect(detect(stream(ONE_WORD, ONE_WORD_MS), new SegmentDetector({ maxMs: 500 }))).toHaveLength(0);
    });
  });
});
