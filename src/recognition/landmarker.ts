import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { LandmarkPoint } from "./lips";

// C1 입술 추출기의 브라우저 부분 — MediaPipe Face Landmarker(WASM)로 비디오 프레임에서 얼굴 점 478개를 얻는다.
// 근거: docs/ARCHITECTURE.md 컴포넌트 표 C1. 입술 40점 선택은 lips.ts(extractLipFrame)가 한다.
//
// 네트워크: createLipLandmarker를 부르는 앱 시작 때 MediaPipe가 모델·WASM을 같은 출처 정적 에셋
// (public/mediapipe/)에서 한 번 불러온다. 이 모듈이 직접 요청을 보내지는 않고, CDN·외부 URL도 쓰지 않는다.
// 발화 경로(detect — 프레임 처리) 중에는 네트워크를 쓰지 않는다. 오프라인에서 에셋을 다시 여는 캐시는 PWA 서비스워커 몫이다.
//
// WASM·비디오가 필요해 Node 단위 테스트는 경로 상수만 본다(landmarker.test.ts).

/** 같은 출처 정적 경로. CDN을 쓰지 않는다 — 오프라인 원칙(ADR-002). */
export const MEDIAPIPE_WASM_BASE = "/mediapipe/wasm";
export const FACE_LANDMARKER_MODEL_PATH = "/mediapipe/face_landmarker.task";

export interface LipLandmarkerOptions {
  wasmBase?: string; // 기본 MEDIAPIPE_WASM_BASE
  modelPath?: string; // 기본 FACE_LANDMARKER_MODEL_PATH
  delegate?: "CPU" | "GPU"; // 기본 "GPU" (실패 시 CPU로 한 번 재시도)
}

export interface LipLandmarker {
  /**
   * 비디오의 현재 프레임에서 첫 얼굴의 점(478개)을 돌려준다. 얼굴이 없으면 null.
   * timestampMs는 호출마다 엄격히 증가해야 한다(MediaPipe VIDEO 모드 조건) — 아니면 null을 돌려주고 추론하지 않는다.
   */
  detect(video: HTMLVideoElement, timestampMs: number): LandmarkPoint[] | null;
  close(): void;
}

/** HTMLMediaElement.HAVE_CURRENT_DATA — 이 값 미만이면 비디오에 아직 그릴 프레임이 없다. */
const HAVE_CURRENT_DATA = 2;

export async function createLipLandmarker(options: LipLandmarkerOptions = {}): Promise<LipLandmarker> {
  const wasmBase = options.wasmBase ?? MEDIAPIPE_WASM_BASE;
  const modelPath = options.modelPath ?? FACE_LANDMARKER_MODEL_PATH;
  const delegate = options.delegate ?? "GPU";

  // 동적 import — 서버 렌더링과 이 기능을 쓰지 않는 화면의 번들에 MediaPipe가 끼지 않게 한다
  const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
  // 브라우저 SIMD 지원 여부에 따라 vision_wasm_internal 또는 vision_wasm_nosimd_internal을 고른다
  const fileset = await FilesetResolver.forVisionTasks(wasmBase);

  const create = (d: "CPU" | "GPU") =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath, delegate: d },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });

  let landmarker: FaceLandmarker;
  try {
    landmarker = await create(delegate);
  } catch (err) {
    // GPU(WebGL) 초기화는 저가 태블릿·드라이버에서 실패할 수 있다 — CPU로 한 번만 다시 만든다
    if (delegate !== "GPU") throw err;
    landmarker = await create("CPU");
  }

  let lastTimestampMs = -Infinity;
  let closed = false;

  return {
    detect(video, timestampMs) {
      if (closed) return null;
      // 엄격히 증가하지 않는 타임스탬프를 MediaPipe에 넘기면 throw한다 — 넘기기 전에 거른다(NaN도 여기서 걸린다)
      if (!Number.isFinite(timestampMs) || !(timestampMs > lastTimestampMs)) return null;
      lastTimestampMs = timestampMs;
      if (video.readyState < HAVE_CURRENT_DATA) return null;

      const face = landmarker.detectForVideo(video, timestampMs).faceLandmarks[0];
      if (face === undefined) return null;
      // x·y만 새 객체로 복사한다 — MediaPipe 결과 객체를 붙잡아 두지 않는다
      return face.map(({ x, y }) => ({ x, y }));
    },
    close() {
      if (closed) return;
      closed = true;
      landmarker.close();
    },
  };
}
