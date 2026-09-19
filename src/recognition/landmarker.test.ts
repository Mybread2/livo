import { describe, it, expect } from "vitest";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { FACE_LANDMARKER_MODEL_PATH, MEDIAPIPE_WASM_BASE } from "./landmarker";
import { LIP_LANDMARK_INDICES } from "./types";

// landmarker.ts 본체(createLipLandmarker)는 WASM·비디오가 필요해 여기서 돌리지 않는다.
// Node에서 확인할 수 있는 것만 본다: 입술 점 목록이 MediaPipe와 같은지, 에셋 경로가 같은 출처인지, 모델 파일이 놓여 있는지.

describe("입술 점 목록 = MediaPipe FACE_LANDMARKS_LIPS", () => {
  it("LIP_LANDMARK_INDICES의 점 집합이 FACE_LANDMARKS_LIPS 연결의 고유 점 집합과 같다 (40개)", () => {
    const ours = [...LIP_LANDMARK_INDICES].sort((a, b) => a - b);
    const lips = new Set<number>();
    for (const { start, end } of FaceLandmarker.FACE_LANDMARKS_LIPS) {
      lips.add(start);
      lips.add(end);
    }
    const theirs = [...lips].sort((a, b) => a - b);
    expect(theirs).toHaveLength(40);
    expect(ours).toEqual(theirs);
  });
});

describe("에셋 경로 (같은 출처 · CDN 금지)", () => {
  it.each([
    ["MEDIAPIPE_WASM_BASE", MEDIAPIPE_WASM_BASE],
    ["FACE_LANDMARKER_MODEL_PATH", FACE_LANDMARKER_MODEL_PATH],
  ])("%s는 /로 시작하고 http를 포함하지 않는다", (_name, path) => {
    expect(path.startsWith("/")).toBe(true);
    expect(path).not.toMatch(/http/i);
  });
});

describe("모델 파일 public/mediapipe/face_landmarker.task", () => {
  it("존재하고 크기가 3,758,596바이트다", () => {
    // 경로 상수는 public/ 기준 URL이다 — 저장소 안 실제 파일 위치로 옮겨 확인한다
    const file = fileURLToPath(new URL(`../../public${FACE_LANDMARKER_MODEL_PATH}`, import.meta.url));
    const stat = statSync(file);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(3_758_596);
  });
});
