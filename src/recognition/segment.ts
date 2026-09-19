import { CORNER_A, CORNER_B, LIP_LANDMARK_INDICES, type LipFrame } from "./types";

// C2 구간 검출기. 브라우저 순수 로직 — 네트워크 없음.
// 근거: docs/ARCHITECTURE.md 컴포넌트 표 C2 (입 개폐량 시계열 → 발화 후보 구간, 움직임 시작 ~ 0.5초 정지).
// 안전 원칙: 애매한 구간(너무 짧음·너무 김·프레임 끊김)은 내보내지 않는다 — "말 안 했는데 나옴"이 사고다.

/** 안쪽 입술 위(landmark 13)·아래(landmark 14)의 LIP_LANDMARK_INDICES 안 순번. */
const UPPER_INNER = LIP_LANDMARK_INDICES.indexOf(13);
const LOWER_INNER = LIP_LANDMARK_INDICES.indexOf(14);

/** 입꼬리 거리가 이 값 이하면 개폐량의 분모로 쓸 수 없다. */
const MIN_CORNER_DISTANCE = 1e-6;

/**
 * 입 개폐량 = 안쪽 입술 위(landmark 13)·아래(landmark 14) 거리 ÷ 바깥 입꼬리(61·291) 거리.
 * 얼굴 크기·위치와 무관한 비율이다. 입꼬리 거리가 0에 가까우면(1e-6 이하) NaN.
 */
export function mouthOpenness(points: Float32Array): number {
  const width = pointDistance(points, CORNER_A, CORNER_B);
  if (!(width > MIN_CORNER_DISTANCE)) return Number.NaN;
  return pointDistance(points, UPPER_INNER, LOWER_INNER) / width;
}

function pointDistance(points: Float32Array, a: number, b: number): number {
  return Math.hypot(points[2 * b] - points[2 * a], points[2 * b + 1] - points[2 * a + 1]);
}

export interface SegmentOptions {
  /** 휴지 기준보다 이만큼 더 벌어지면 발화 시작. 기본 0.1 */
  startDelta?: number;
  /** 마지막 움직임 기준 개폐량에서 이 폭 안에서만 변하면 '정지'. 기본 0.03 */
  stillDelta?: number;
  /** 정지가 이만큼 이어지면 구간 끝(ms). 기본 500 */
  stillMs?: number;
  /** 시작 판정 이전 이만큼(ms)의 프레임도 구간에 넣는다 — 입을 떼기 직전 움직임 포함. 기본 200 */
  preRollMs?: number;
  /**
   * 움직임(시작 판정 프레임 ~ 마지막 움직임)이 이보다 짧으면 버린다(ms). 기본 250.
   * 앞에 붙인 preRoll은 세지 않는다 — 세면 preRollMs(200)만으로 거의 채워져 짧은 경련도 통과한다.
   */
  minMs?: number;
  /**
   * 구간(첫 프레임 ~ 현재)이 이보다 길어지면 버린다(ms) — 한 단어가 아니다. 기본 3000.
   * 버린 뒤에는 입이 stillMs 동안 멎을 때까지 새 구간을 시작하지 않는다 — 같은 움직임의 꼬리를 단어로 잡지 않게.
   */
  maxMs?: number;
  /** 연속 프레임 간격이 이보다 크면 진행 중 구간을 버린다(ms) — 프레임 끊김. 기본 250 */
  maxGapMs?: number;
  /** 휴지 기준(쉬는 입의 개폐량) 지수이동평균 시간 상수(ms). 기본 1000 */
  baselineTauMs?: number;
}

/** 출발값이다 — 실제 녹화 데이터로 보정한다. */
export const DEFAULT_SEGMENT_OPTIONS: Required<SegmentOptions> = Object.freeze({
  startDelta: 0.1,
  stillDelta: 0.03,
  stillMs: 500,
  preRollMs: 200,
  minMs: 250,
  maxMs: 3000,
  maxGapMs: 250,
  baselineTauMs: 1000,
});

/**
 * idle: 대기 — 휴지 기준을 따라가며 시작을 기다린다.
 * active: 발화 중 — 구간 프레임을 모은다.
 * overlong: maxMs를 넘겨 구간을 버렸다 — 입이 멎을 때까지 아무것도 모으지 않는다.
 */
type Phase = "idle" | "active" | "overlong";

/**
 * 프레임 스트림에서 발화 구간(움직임 시작 ~ stillMs 정지)을 잘라 C3에 넘길 LipFrame[]로 내보낸다.
 * 돌려주는 배열의 t는 엄격히 증가한다 (C3 normalizeSegment의 입력 조건).
 */
export class SegmentDetector {
  private readonly opts: Required<SegmentOptions>;

  private phase: Phase = "idle";
  /** 마지막으로 받아들인 프레임의 t. null이면 처음 상태. */
  private lastT: number | null = null;
  /** 휴지 기준(쉬는 입의 개폐량). null이면 다음 프레임에서 잡는다. */
  private baseline: number | null = null;
  /** 대기 중 최근 preRollMs 안의 프레임 — 시작 판정 때 구간 앞에 붙인다. */
  private preRoll: LipFrame[] = [];
  /** 발화 중 구간 프레임 (preRoll 포함). */
  private frames: LipFrame[] = [];
  /** 시작 판정 프레임의 t — 움직임 길이(minMs)를 여기서부터 잰다. */
  private startT = 0;
  /** 마지막 움직임 프레임의 frames 안 위치·t·개폐량. */
  private lastMoveIndex = 0;
  private lastMoveT = 0;
  private lastMoveOpenness = 0;

  constructor(options: SegmentOptions = {}) {
    // undefined로 준 값도 기본값으로 — 펼쳐 합치면 undefined가 기본값을 덮는다
    const d = DEFAULT_SEGMENT_OPTIONS;
    this.opts = {
      startDelta: options.startDelta ?? d.startDelta,
      stillDelta: options.stillDelta ?? d.stillDelta,
      stillMs: options.stillMs ?? d.stillMs,
      preRollMs: options.preRollMs ?? d.preRollMs,
      minMs: options.minMs ?? d.minMs,
      maxMs: options.maxMs ?? d.maxMs,
      maxGapMs: options.maxGapMs ?? d.maxGapMs,
      baselineTauMs: options.baselineTauMs ?? d.baselineTauMs,
    };
  }

  /** 프레임을 하나 넣는다. 구간이 끝난 프레임이면 그 구간의 프레임 배열을, 아니면 null을 돌려준다. */
  push(frame: LipFrame): LipFrame[] | null {
    const { t } = frame;
    const openness = mouthOpenness(frame.points);
    // 쓸 수 없는 프레임은 받지 않은 것으로 친다 — 상태가 바뀌지 않는다.
    // NaN t를 받아 두면 이후 모든 t 비교가 false라 스트림 전체가 막힌다.
    if (!Number.isFinite(openness) || !Number.isFinite(t)) return null;
    if (this.lastT !== null && !(t > this.lastT)) return null;

    let dt = this.lastT === null ? 0 : t - this.lastT;
    if (dt > this.opts.maxGapMs) {
      // 프레임 끊김 — 끊긴 사이에 무슨 일이 있었는지 모르니 진행 중 구간을 버리고 첫 프레임처럼 다시 시작한다
      this.reset();
      dt = 0;
    }
    this.lastT = t;

    if (this.phase === "idle") {
      this.waitForStart(frame, openness, dt);
      return null;
    }
    return this.follow(frame, openness);
  }

  /** 진행 중 구간과 버퍼를 버리고 처음 상태로 (얼굴을 놓쳤을 때·수동 세션 OFF). 휴지 기준도 초기화. */
  reset(): void {
    this.phase = "idle";
    this.lastT = null;
    this.baseline = null;
    this.preRoll = [];
    this.frames = [];
  }

  private waitForStart(frame: LipFrame, openness: number, dt: number): void {
    const { startDelta, preRollMs, baselineTauMs } = this.opts;
    if (this.baseline === null) this.baseline = openness;

    if (openness > this.baseline + startDelta) {
      // 입을 떼기 직전 움직임도 담는다 — 문턱을 넘기 전 벌어지기 시작한 프레임들
      this.frames = this.preRoll.filter((f) => frame.t - f.t <= preRollMs);
      this.frames.push(frame);
      this.preRoll = [];
      this.phase = "active";
      this.startT = frame.t;
      this.markMove(frame.t, openness);
      return;
    }

    // 프레임 간격으로 가중치를 정해 프레임률과 무관하게 같은 시간 상수로 따라간다
    this.baseline += (1 - Math.exp(-dt / baselineTauMs)) * (openness - this.baseline);
    this.preRoll.push(frame);
    while (frame.t - this.preRoll[0].t > preRollMs) this.preRoll.shift();
  }

  /** 발화 중·너무 김 공통: 움직임을 추적하고, 정지가 stillMs 이어지면 대기로 돌아간다. */
  private follow(frame: LipFrame, openness: number): LipFrame[] | null {
    const { stillDelta, stillMs, minMs, maxMs } = this.opts;
    const collecting = this.phase === "active";
    if (collecting) this.frames.push(frame);
    if (Math.abs(openness - this.lastMoveOpenness) > stillDelta) this.markMove(frame.t, openness);

    if (frame.t - this.lastMoveT >= stillMs) {
      // 뒤따른 정지 프레임은 빼고 마지막 움직임에서 자른다
      const segment = this.frames.slice(0, this.lastMoveIndex + 1);
      const movedMs = this.lastMoveT - this.startT;
      this.toIdle(openness);
      return collecting && movedMs >= minMs ? segment : null;
    }
    if (collecting && frame.t - this.frames[0].t > maxMs) {
      // 한 단어가 아니다. 대기로 바로 돌아가면 아직 움직이는 입에서 휴지 기준을 잡아 남은 꼬리가 새 구간이 된다
      this.phase = "overlong";
      this.frames = [];
    }
    return null;
  }

  private markMove(t: number, openness: number): void {
    this.lastMoveIndex = this.frames.length - 1;
    this.lastMoveT = t;
    this.lastMoveOpenness = openness;
  }

  /** 입이 멎은 지금의 개폐량에서 휴지 기준을 다시 잡는다. */
  private toIdle(openness: number): void {
    this.phase = "idle";
    this.baseline = openness;
    this.preRoll = [];
    this.frames = [];
  }
}
