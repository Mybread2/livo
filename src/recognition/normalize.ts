import {
  CORNER_A,
  CORNER_B,
  FEATURE_DIM,
  LIP_POINT_COUNT,
  SEQ_FRAMES,
  type LipFrame,
  type Sequence,
} from "./types";

// C3 정규화기. 브라우저 순수 함수 — 네트워크 없음.
// 근거: docs/ARCHITECTURE.md 컴포넌트 표 C3 (원시 좌표 시퀀스 → float32[32][80]).
// 처리 순서가 계약이다: 중심 이동 → 기울기 제거 → 구간 크기 정규화 → 시간 리샘플.

/** 입꼬리 거리 중앙값이 이 값 이하면 얼굴이 사실상 점이라 크기 기준을 잡을 수 없다. */
const MIN_CORNER_DISTANCE = 1e-6;

/**
 * 한 발화 구간의 입술 좌표를 얼굴 위치·고개 기울기·카메라 거리·프레임률과 무관한 모양으로 바꾼다.
 * 입력이 애매하면 null — 호출자가 discard한다(안 나오는 쪽이 안전하다).
 */
export function normalizeSegment(frames: readonly LipFrame[]): Sequence | null {
  if (!isValidSegment(frames)) return null;

  // 1~2. 프레임마다 원점으로 옮기고 입꼬리 방향을 +x축에 맞춘다
  const aligned = frames.map((f) => centerAndLevel(f.points));

  // 3. 구간 전체의 입꼬리 거리 중앙값 하나로 나눈다.
  //    프레임마다 나누면 입을 옆으로 벌리거나 오므리는 변화(단어 정보)가 사라진다.
  const scale = median(aligned.map(cornerDistance));
  if (!(scale > MIN_CORNER_DISTANCE)) return null;
  for (const pts of aligned) {
    for (let i = 0; i < FEATURE_DIM; i++) pts[i] /= scale;
  }

  // 4. 시간 축을 SEQ_FRAMES개로 맞춘다
  return resample(
    aligned,
    frames.map((f) => f.t),
  );
}

function isValidSegment(frames: readonly LipFrame[]): boolean {
  if (frames.length < 2) return false;
  for (let k = 0; k < frames.length; k++) {
    const { t, points } = frames[k];
    // NaN은 비교가 항상 false라 부정형으로 걸러진다. 무한대 t는 보간할 수 없다.
    if (!Number.isFinite(t)) return false;
    if (k > 0 && !(t > frames[k - 1].t)) return false;
    if (points.length !== FEATURE_DIM) return false;
    for (let i = 0; i < FEATURE_DIM; i++) {
      if (!Number.isFinite(points[i])) return false;
    }
  }
  return true;
}

/** 40점 평균을 원점으로 옮긴 뒤, CORNER_A → CORNER_B 방향이 +x축과 나란하도록 돌린다. */
function centerAndLevel(points: Float32Array): Float64Array {
  let cx = 0;
  let cy = 0;
  for (let p = 0; p < LIP_POINT_COUNT; p++) {
    cx += points[2 * p];
    cy += points[2 * p + 1];
  }
  cx /= LIP_POINT_COUNT;
  cy /= LIP_POINT_COUNT;

  const angle = Math.atan2(
    points[2 * CORNER_B + 1] - points[2 * CORNER_A + 1],
    points[2 * CORNER_B] - points[2 * CORNER_A],
  );
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const out = new Float64Array(FEATURE_DIM);
  for (let p = 0; p < LIP_POINT_COUNT; p++) {
    const x = points[2 * p] - cx;
    const y = points[2 * p + 1] - cy;
    // -angle 회전: 입꼬리 방향 벡터 (cos, sin)이 (1, 0)이 된다
    out[2 * p] = x * cos + y * sin;
    out[2 * p + 1] = -x * sin + y * cos;
  }
  return out;
}

function cornerDistance(pts: Float64Array): number {
  return Math.hypot(pts[2 * CORNER_B] - pts[2 * CORNER_A], pts[2 * CORNER_B + 1] - pts[2 * CORNER_A + 1]);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 첫 t부터 마지막 t까지 양 끝 포함 균등 간격 SEQ_FRAMES개 시각에서 선형 보간한다.
 * 입력 간격이 균일하지 않아도 인덱스가 아니라 t 기준으로 보간한다.
 */
function resample(rows: Float64Array[], times: number[]): Sequence {
  const t0 = times[0];
  const t1 = times[times.length - 1];
  const out: Sequence = [];
  let k = 0; // 목표 시각을 감싸는 입력 구간 [times[k], times[k + 1]]
  for (let j = 0; j < SEQ_FRAMES; j++) {
    // 마지막 목표는 t1로 고정한다 — 부동소수 누적 오차로 끝을 넘지 않게
    const target = j === SEQ_FRAMES - 1 ? t1 : t0 + ((t1 - t0) * j) / (SEQ_FRAMES - 1);
    while (k < times.length - 2 && times[k + 1] < target) k++;
    const w = (target - times[k]) / (times[k + 1] - times[k]);
    const a = rows[k];
    const b = rows[k + 1];
    const row = new Float32Array(FEATURE_DIM);
    for (let i = 0; i < FEATURE_DIM; i++) row[i] = a[i] + w * (b[i] - a[i]);
    out.push(row);
  }
  return out;
}
