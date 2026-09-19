// B 내부 타입. A ↔ B 계약(src/types/recognition.ts)과 별개로, 인식 파이프라인 단계 사이에서만 쓴다.

/** C1이 뽑는 입술 점 = MediaPipe Face Landmarker 478점 중 입술 40점. 이 순서가 곧 좌표 배열 순서다. */
export const LIP_LANDMARK_INDICES = [
  // 바깥 입술: 입꼬리 61 → 윗입술 → 입꼬리 291 → 아랫입술 → 61 직전까지
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
  // 안쪽 입술: 78 → 윗입술 안쪽 → 308 → 아랫입술 안쪽 → 78 직전까지
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95,
] as const;

export const LIP_POINT_COUNT = LIP_LANDMARK_INDICES.length; // 40
export const FEATURE_DIM = LIP_POINT_COUNT * 2; // 80 = 40점 × (x, y)
export const SEQ_FRAMES = 32; // C3가 모든 구간을 맞추는 프레임 수

/** 바깥 입꼬리 두 점의 위치(LIP_LANDMARK_INDICES 안의 순번). C3가 기울기·크기 기준으로 쓴다. */
export const CORNER_A = 0; // landmark 61
export const CORNER_B = 10; // landmark 291

/** C1 출력 한 프레임. */
export interface LipFrame {
  /** 타임스탬프(ms). 한 구간 안에서 증가한다. */
  t: number;
  /** [x0, y0, x1, y1, …] 길이 FEATURE_DIM. 가로·세로 비율을 맞춘 좌표(정규화 x에 영상 가로/세로 비를 곱한 값). */
  points: Float32Array;
}

/** C3 출력. SEQ_FRAMES개 행 × FEATURE_DIM열. */
export type Sequence = Float32Array[];
