import { FEATURE_DIM, LIP_LANDMARK_INDICES, LIP_POINT_COUNT, type LipFrame } from "./types";

// C1 입술 추출기의 순수 계산 부분. 브라우저 순수 함수 — 네트워크 없음.
// 근거: docs/ARCHITECTURE.md 컴포넌트 표 C1 (카메라 프레임 → {t, points[40][2]}).
// MediaPipe 호출(WASM·카메라)은 여기 두지 않는다 — 그 결과인 얼굴 점 배열만 받는다.

/** MediaPipe NormalizedLandmark와 같은 모양(구조 타입). x·y는 영상 가로·세로에 대한 0~1 비율. */
export interface LandmarkPoint {
  x: number;
  y: number;
}

/** 입술 점 중 가장 큰 번호(415). 점 배열 길이가 이보다 커야 입술 40점이 다 있다. */
const MAX_LIP_INDEX = Math.max(...LIP_LANDMARK_INDICES);

/**
 * 얼굴 점 배열에서 입술 40점을 LIP_LANDMARK_INDICES 순서대로 골라 LipFrame으로 만든다.
 * 좌표 규약(types.ts): x는 정규화 x에 (width / height)를 곱하고, y는 정규화 y 그대로 — 가로·세로 1단위 길이를 같게 한다.
 * 쓸 수 없는 입력이면 null (호출자는 그 프레임을 건너뛴다).
 */
export function extractLipFrame(
  landmarks: ArrayLike<LandmarkPoint>,
  width: number,
  height: number,
  t: number,
): LipFrame | null {
  if (landmarks.length <= MAX_LIP_INDEX) return null;
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) return null;
  if (!Number.isFinite(t)) return null;

  const aspect = width / height;
  // 새 배열에 복사한다 — MediaPipe는 결과 객체를 재사용할 수 있어 입력을 붙잡아 두면 다음 프레임에 덮인다
  const points = new Float32Array(FEATURE_DIM);
  for (let p = 0; p < LIP_POINT_COUNT; p++) {
    const { x, y } = landmarks[LIP_LANDMARK_INDICES[p]];
    points[2 * p] = x * aspect;
    points[2 * p + 1] = y;
    // 저장된 값을 검사한다 — 입력의 NaN·Infinity와 float32로 옮기며 넘친 값을 함께 거른다
    if (!Number.isFinite(points[2 * p]) || !Number.isFinite(points[2 * p + 1])) return null;
  }
  return { t, points };
}
