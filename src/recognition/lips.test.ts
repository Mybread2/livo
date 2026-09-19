import { describe, it, expect } from "vitest";
import { extractLipFrame } from "./lips";
import { FEATURE_DIM, LIP_LANDMARK_INDICES, LIP_POINT_COUNT, type LipFrame } from "./types";

// ── 가짜 얼굴 점 (MediaPipe 없이 — 실제 얼굴 좌표를 레포에 두지 않는다) ──

/** MediaPipe NormalizedLandmark의 전체 모양. 입술 추출은 x·y만 쓰고 나머지는 무시해야 한다. */
interface FakeLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/** 점 k의 x = k/1000, y = k/2000 — 출력 값만 보고 어느 번호의 점인지 알 수 있다. */
function fakeFace(count = 478): FakeLandmark[] {
  return Array.from({ length: count }, (_, k) => ({ x: k / 1000, y: k / 2000, z: -k / 5000, visibility: 0 }));
}

function extractOrFail(face: FakeLandmark[], width: number, height: number, t: number): LipFrame {
  const out = extractLipFrame(face, width, height, t);
  if (out === null) throw new Error("extractLipFrame이 null을 반환했다");
  return out;
}

describe("extractLipFrame (C1 입술 40점 선택)", () => {
  it("40점이 LIP_LANDMARK_INDICES 순서대로 들어간다 (정사각형 영상 — 보정 없음)", () => {
    const out = extractOrFail(fakeFace(), 640, 640, 0);
    expect(out.points).toBeInstanceOf(Float32Array);
    expect(out.points).toHaveLength(FEATURE_DIM);
    LIP_LANDMARK_INDICES.forEach((idx, p) => {
      expect(out.points[2 * p]).toBeCloseTo(idx / 1000, 6);
      expect(out.points[2 * p + 1]).toBeCloseTo(idx / 2000, 6);
    });
  });

  it.each([
    [1280, 720, "16/9", 16 / 9],
    [720, 1280, "9/16", 9 / 16],
    [640, 480, "4/3", 4 / 3],
  ])("가로세로비: %s×%s이면 x에 %s를 곱하고 y는 그대로", (width, height, _label, aspect) => {
    const out = extractOrFail(fakeFace(), width, height, 0);
    LIP_LANDMARK_INDICES.forEach((idx, p) => {
      expect(out.points[2 * p]).toBeCloseTo((idx / 1000) * aspect, 6);
      expect(out.points[2 * p + 1]).toBeCloseTo(idx / 2000, 6);
    });
  });

  it("가로세로비 보정: 1280×720 영상에서 실제 원은 출력에서도 원이다", () => {
    // 픽셀 좌표 (640, 400) 중심, 반지름 90px 원 위에 입술 40점을 고르게 놓는다
    const face = fakeFace();
    LIP_LANDMARK_INDICES.forEach((idx, p) => {
      const theta = (2 * Math.PI * p) / LIP_POINT_COUNT;
      face[idx].x = (640 + 90 * Math.cos(theta)) / 1280;
      face[idx].y = (400 + 90 * Math.sin(theta)) / 720;
    });
    const out = extractOrFail(face, 1280, 720, 0);
    // 출력 단위 = 세로 1 → 중심 (640/720, 400/720), 반지름 90/720 = 0.125.
    // 보정이 없으면 가로 반지름이 90/1280 ≈ 0.07로 줄어 타원이 된다
    for (let p = 0; p < LIP_POINT_COUNT; p++) {
      const r = Math.hypot(out.points[2 * p] - 640 / 720, out.points[2 * p + 1] - 400 / 720);
      expect(r).toBeCloseTo(0.125, 5);
    }
  });

  it("t가 그대로 들어간다", () => {
    expect(extractOrFail(fakeFace(), 640, 480, 1234.5).t).toBe(1234.5);
  });

  it("출력은 입력과 독립: 추출 뒤 입력 점을 바꿔도, 다시 추출해도 앞선 출력은 그대로", () => {
    const face = fakeFace();
    const out = extractOrFail(face, 640, 480, 0);
    const before = Array.from(out.points);
    // MediaPipe는 결과 객체를 재사용할 수 있다 — 다음 프레임이 같은 객체를 덮어쓴 상황
    for (const lm of face) {
      lm.x = 0.9;
      lm.y = 0.9;
    }
    expect(Array.from(out.points)).toEqual(before);
    // 호출마다 새 배열이어야 한다 — 모듈 버퍼를 재사용하면 앞선 프레임이 덮인다
    const next = extractOrFail(face, 640, 480, 33);
    expect(next.points).not.toBe(out.points);
    expect(Array.from(out.points)).toEqual(before);
  });

  describe("null — 쓸 수 없는 입력 (호출자는 그 프레임을 건너뛴다)", () => {
    it("점 배열이 가장 큰 입술 번호 415까지 닿지 않음 — 468점 메시는 정상", () => {
      expect(extractLipFrame([], 640, 480, 0)).toBeNull();
      expect(extractLipFrame(fakeFace(415), 640, 480, 0)).toBeNull(); // 0~414 — 415번 없음
      expect(extractLipFrame(fakeFace(416), 640, 480, 0)).not.toBeNull(); // 415번까지 있음
      expect(extractLipFrame(fakeFace(468), 640, 480, 0)).not.toBeNull(); // 홍채 점 없는 얼굴 메시
    });

    it.each([0, -640, Number.NaN, Number.POSITIVE_INFINITY])("가로 또는 세로가 %s", (bad) => {
      expect(extractLipFrame(fakeFace(), bad, 480, 0)).toBeNull();
      expect(extractLipFrame(fakeFace(), 640, bad, 0)).toBeNull();
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("t가 %s", (bad) => {
      expect(extractLipFrame(fakeFace(), 640, 480, bad)).toBeNull();
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      "고른 40점의 x 또는 y가 %s — 입술 밖 점은 상관없다",
      (bad) => {
        const badX = fakeFace();
        badX[95].x = bad; // 입술 마지막 점
        expect(extractLipFrame(badX, 640, 480, 0)).toBeNull();

        const badY = fakeFace();
        badY[291].y = bad; // 오른쪽 입꼬리
        expect(extractLipFrame(badY, 640, 480, 0)).toBeNull();

        const badNose = fakeFace();
        badNose[1].x = bad; // 코끝 — 입술 40점이 아니다
        badNose[1].y = bad;
        expect(extractLipFrame(badNose, 640, 480, 0)).not.toBeNull();
      },
    );
  });
});
