import type { LipLandmarker } from "@/recognition/landmarker";
import { extractLipFrame, type LandmarkPoint } from "@/recognition/lips";
import type { LipFrame } from "@/recognition/types";

// 개발용 수집 페이지(/dev/lips)의 영상 처리. 브라우저 전용.
// 영상 파일은 object URL로 이 브라우저 안에서만 열고, 영상·프레임·좌표를 어디에도 보내거나 저장하지 않는다(CLAUDE.md CRITICAL).
// 파일을 <video>에 붙여 fps 간격으로 탐색(seek)하며 MediaPipe로 얼굴 점을 얻는다 — 실시간 재생이 아니라 프레임을 빠짐없이 본다.

export const DEFAULT_FPS = 30;

export interface ExtractResult {
  frames: LipFrame[];
  totalFrames: number;
  faceFrames: number;
  durationMs: number;
  width: number;
  height: number;
}

/** 탐색한 한 프레임. landmarks는 첫 얼굴의 점(478개), 얼굴이 없으면 null. t는 영상 시각(ms). */
export interface ScannedFrame {
  landmarks: LandmarkPoint[] | null;
  t: number;
  width: number;
  height: number;
}

export interface ScanResult {
  totalFrames: number;
  durationMs: number;
  width: number;
  height: number;
}

// landmarker에 넘기는 타임스탬프 — MediaPipe VIDEO 모드는 호출마다 엄격히 증가해야 한다.
// 영상 시각은 파일이 바뀌면 0으로 돌아가므로 쓰지 않는다. performance.now()를 쓰되, 같은 값이 나오면 1ms 밀어 올린다
let lastTimestampMs = 0;

function nextTimestampMs(): number {
  lastTimestampMs = Math.max(performance.now(), lastTimestampMs + 1);
  return lastTimestampMs;
}

/**
 * 파일을 object URL로 연 <video>를 fps 간격으로 탐색(seek)하며 detect → extractLipFrame.
 * LipFrame.t = 영상 시각(ms). landmarker에 넘기는 timestamp는 performance.now()처럼 계속 증가하는 값을 쓴다 (파일이 바뀌어도 증가).
 * 끝나면 object URL을 해제한다. 영상·프레임을 어디에도 저장·전송하지 않는다.
 */
export async function extractFrames(
  file: File,
  landmarker: LipLandmarker,
  fps: number = DEFAULT_FPS,
  onProgress?: (ratio: number) => void,
): Promise<ExtractResult> {
  const frames: LipFrame[] = [];
  let faceFrames = 0;
  const scan = await scanVideo(
    file,
    landmarker,
    fps,
    ({ landmarks, t, width, height }) => {
      // 얼굴이 없는 프레임은 넣지 않는다 — 빈 시간은 C2(구간 검출)가 프레임 간격으로 판단한다
      if (landmarks === null) return;
      faceFrames++;
      const frame = extractLipFrame(landmarks, width, height, t);
      if (frame !== null) frames.push(frame);
    },
    onProgress,
  );
  return { frames, faceFrames, ...scan };
}

/**
 * extractFrames의 탐색 부분. 프레임마다 얼굴 점을 그대로(얼굴이 없으면 null) onFrame에 넘긴다.
 * 인식 시험은 이것으로 RecognitionPipeline.push에 실시간과 같은 입력(얼굴 없음 = null 포함)을 넣는다.
 */
export async function scanVideo(
  file: File,
  landmarker: LipLandmarker,
  fps: number,
  onFrame: (frame: ScannedFrame) => void,
  onProgress?: (ratio: number) => void,
): Promise<ScanResult> {
  if (!(Number.isFinite(fps) && fps > 0)) throw new RangeError(`fps는 양의 유한수여야 한다: ${fps}`);

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    // 리스너를 먼저 붙이고 src를 바꾼다 — 반대로 하면 이벤트를 놓칠 수 있다
    const loaded = nextEvent(video, "loadeddata");
    video.src = url;
    await loaded;

    const durationSec = video.duration;
    const width = video.videoWidth;
    const height = video.videoHeight;
    // MediaRecorder로 만든 webm처럼 길이 정보가 없는 파일은 Infinity가 나온다 — 탐색할 범위를 모른다
    if (!(Number.isFinite(durationSec) && durationSec > 0)) throw new Error(`영상 길이를 읽을 수 없다: ${durationSec}`);
    if (!(width > 0 && height > 0)) throw new Error("영상 트랙이 없다 (가로·세로 0)");

    // 영상 안의 시각 i / fps (< 길이)만 본다 — 1.1초 × 30처럼 곱이 33.000…4로 나와도 33프레임이 되게 작은 여유를 둔다
    const totalFrames = Math.floor(durationSec * fps + 1e-6);
    for (let i = 0; i < totalFrames; i++) {
      const seeked = nextEvent(video, "seeked");
      video.currentTime = i / fps;
      await seeked;
      const landmarks = landmarker.detect(video, nextTimestampMs());
      onFrame({ landmarks, t: (i * 1000) / fps, width, height });
      onProgress?.((i + 1) / totalFrames);
    }
    return { totalFrames, durationMs: durationSec * 1000, width, height };
  } finally {
    // 디코더가 잡은 영상을 놓고 파일 참조를 푼다 — 영상은 이 함수 동안 메모리에만 있었다
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** video의 다음 type 이벤트를 기다린다. 그 전에 error가 나면 거절한다. */
function nextEvent(video: HTMLVideoElement, type: "loadeddata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(type, onEvent);
      video.removeEventListener("error", onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      const reason = video.error ? video.error.message || `코드 ${video.error.code}` : "알 수 없는 오류";
      reject(new Error(`영상을 읽지 못했다: ${reason}`));
    };
    video.addEventListener(type, onEvent);
    video.addEventListener("error", onError);
  });
}
