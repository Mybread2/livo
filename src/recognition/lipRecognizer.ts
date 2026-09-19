import type { Recognizer, RecognitionEvent, RecognizerOptions } from "@/types/recognition";
import { loadTemplates as loadDeviceTemplates } from "@/offline/templateStore";
import { openCamera as openDeviceCamera, type CameraHandle } from "./camera";
import type { TemplateSet } from "./dtw";
import { createLipLandmarker, type LipLandmarker } from "./landmarker";
import { RecognitionPipeline, type PipelineOptions } from "./pipeline";

// B의 Recognizer 구현 (A ↔ B 계약 src/types/recognition.ts).
// 카메라 → MediaPipe 얼굴 점 → RecognitionPipeline(C1~C5) → onResult(discard 포함).
// 네트워크 없음: 템플릿은 기기(IndexedDB)에서, 모델·WASM은 같은 출처 정적 에셋에서 온다. 프레임은 저장·전송하지 않는다.
// 안전: 템플릿이 없으면 아무것도 말하지 않는다(가짜 결과 금지). start는 reject하지 않는다(화면이 void로 부른다).

/** HTMLMediaElement.HAVE_CURRENT_DATA — 이 값 미만이면 그릴 프레임이 없다. */
const HAVE_CURRENT_DATA = 2;
/** 프레임 처리 최소 간격(ms) — rAF(60Hz)마다 추론하지 않고 카메라 속도(~30fps)에 맞춘다. */
const MIN_FRAME_INTERVAL_MS = 30;

export interface LipRecognizerDeps {
  loadTemplates?: () => Promise<TemplateSet | null>;
  createLandmarker?: () => Promise<LipLandmarker>;
  openCamera?: (video: HTMLVideoElement) => Promise<CameraHandle>;
  now?: () => number;
  /** 다음 프레임에 cb를 부른다. 취소 함수를 돌려준다. 기본: requestAnimationFrame. */
  scheduleFrame?: (cb: () => void) => () => void;
  pipeline?: Omit<PipelineOptions, "templates" | "manualSession">;
  onWarning?: (message: string) => void;
}

function defaultScheduleFrame(cb: () => void): () => void {
  // requestVideoFrameCallback은 숨긴 video(display:none)에서 불리지 않을 수 있어 rAF를 쓴다
  const id = requestAnimationFrame(() => cb());
  return () => cancelAnimationFrame(id);
}

function hasTemplates(set: TemplateSet | null): set is TemplateSet {
  return set !== null && Object.values(set).some((seqs) => seqs.length > 0);
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class LipRecognizer implements Recognizer {
  private readonly loadTemplates: () => Promise<TemplateSet | null>;
  private readonly createLandmarker: () => Promise<LipLandmarker>;
  private readonly openCamera: (video: HTMLVideoElement) => Promise<CameraHandle>;
  private readonly now: () => number;
  private readonly scheduleFrame: (cb: () => void) => () => void;
  private readonly pipelineOptions: LipRecognizerDeps["pipeline"];
  private readonly warn: (message: string) => void;

  /** start·stop마다 올린다 — await 사이에 멈추거나 다시 시작했는지 판단한다. */
  private generation = 0;
  private camera: CameraHandle | null = null;
  private landmarker: LipLandmarker | null = null;
  private pipeline: RecognitionPipeline | null = null;
  private cancelFrame: (() => void) | null = null;

  constructor(deps: LipRecognizerDeps = {}) {
    this.loadTemplates = deps.loadTemplates ?? loadDeviceTemplates;
    this.createLandmarker = deps.createLandmarker ?? (() => createLipLandmarker());
    this.openCamera = deps.openCamera ?? openDeviceCamera;
    this.now = deps.now ?? (() => performance.now());
    this.scheduleFrame = deps.scheduleFrame ?? defaultScheduleFrame;
    this.pipelineOptions = deps.pipeline;
    this.warn = deps.onWarning ?? ((m) => console.warn(m));
  }

  async start(
    video: HTMLVideoElement,
    onResult: (event: RecognitionEvent) => void,
    options?: RecognizerOptions,
  ): Promise<void> {
    this.stop();
    const gen = ++this.generation;
    const alive = () => gen === this.generation;
    try {
      // 템플릿부터 — 없으면 카메라를 켜지 않는다
      const templates = await this.loadTemplates();
      if (!alive()) return;
      if (!hasTemplates(templates)) {
        this.warn("기기에 입모양 템플릿이 없습니다 — /dev/lips에서 만드세요. 인식하지 않습니다.");
        return;
      }

      const camera = await this.openCamera(video);
      if (!alive()) {
        camera.stop(); // 켜는 사이에 멈췄다 — 켜진 카메라를 바로 끈다
        return;
      }
      this.camera = camera;

      const landmarker = await this.createLandmarker();
      if (!alive()) {
        landmarker.close();
        return;
      }
      this.landmarker = landmarker;
      this.pipeline = new RecognitionPipeline({
        ...this.pipelineOptions,
        templates,
        manualSession: options?.manualSession,
      });
      this.runLoop(gen, video, onResult);
    } catch (error) {
      this.warn(`입모양 인식을 시작하지 못했습니다: ${errorMessage(error)}`);
      if (alive()) this.stop();
    }
  }

  stop(): void {
    this.generation++;
    this.cancelFrame?.();
    this.cancelFrame = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.camera?.stop();
    this.camera = null;
    this.pipeline?.reset();
    this.pipeline = null;
  }

  private runLoop(gen: number, video: HTMLVideoElement, onResult: (event: RecognitionEvent) => void): void {
    let lastVideoTime = -1;
    let lastProcessedAt = Number.NEGATIVE_INFINITY;
    const tick = () => {
      if (gen !== this.generation) return;
      // 다음 프레임을 먼저 예약한다 — onResult 안에서 stop()해도 이 예약이 취소된다
      this.cancelFrame = this.scheduleFrame(tick);
      if (video.readyState < HAVE_CURRENT_DATA || !(video.currentTime > lastVideoTime)) return;
      const t = this.now();
      if (t - lastProcessedAt < MIN_FRAME_INTERVAL_MS) return;
      lastVideoTime = video.currentTime;
      lastProcessedAt = t;

      let event: RecognitionEvent | null = null;
      try {
        const landmarks = this.landmarker!.detect(video, t);
        event = this.pipeline!.push(landmarks, video.videoWidth, video.videoHeight, t);
      } catch (error) {
        this.warn(`프레임 처리 실패: ${errorMessage(error)}`);
        return;
      }
      if (event === null) return;
      try {
        onResult(event);
      } catch (error) {
        this.warn(`onResult 처리 중 오류: ${errorMessage(error)}`);
      }
    };
    this.cancelFrame = this.scheduleFrame(tick);
  }
}
