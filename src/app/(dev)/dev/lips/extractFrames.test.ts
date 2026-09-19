import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { LipLandmarker } from "@/recognition/landmarker";
import { extractLipFrame, type LandmarkPoint } from "@/recognition/lips";
import { DEFAULT_FPS, extractFrames, scanVideo, type ScannedFrame } from "./extractFrames";

// extractFrames는 브라우저 전용(<video>·object URL)이라 Node에서는 가짜 video·landmarker로 탐색 규칙만 본다.
// 실제 디코딩·MediaPipe 동작은 개발 서버의 /dev/lips 페이지에서 확인한다. 실제 얼굴·영상은 레포에 두지 않는다.

interface VideoSpec {
  duration: number;
  width?: number;
  height?: number;
  failLoad?: boolean;
}

/** HTMLVideoElement 중 extractFrames가 쓰는 부분만. src·currentTime을 바꾸면 다음 틱에 이벤트를 낸다. */
class FakeVideo extends EventTarget {
  muted = false;
  playsInline = false;
  preload = "";
  readyState = 0;
  duration = Number.NaN;
  videoWidth = 0;
  videoHeight = 0;
  error: { code: number; message: string } | null = null;
  readonly seeks: number[] = [];
  released = false;
  private source = "";
  private time = 0;

  constructor(private readonly spec: VideoSpec) {
    super();
  }

  get src(): string {
    return this.source;
  }

  set src(url: string) {
    this.source = url;
    setTimeout(() => {
      if (this.spec.failLoad) {
        this.error = { code: 4, message: "지원하지 않는 형식" };
        this.dispatchEvent(new Event("error"));
        return;
      }
      this.duration = this.spec.duration;
      this.videoWidth = this.spec.width ?? 1280;
      this.videoHeight = this.spec.height ?? 720;
      this.readyState = 4;
      this.dispatchEvent(new Event("loadeddata"));
    }, 0);
  }

  get currentTime(): number {
    return this.time;
  }

  set currentTime(seconds: number) {
    this.time = seconds;
    this.seeks.push(seconds);
    setTimeout(() => this.dispatchEvent(new Event("seeked")), 0);
  }

  removeAttribute(name: string): void {
    if (name !== "src") return;
    this.source = "";
    this.released = true;
  }

  load(): void {}
}

/** 영상 시각(초)마다 조금씩 다른 가짜 얼굴 478점. */
function fakeFace(seconds: number): LandmarkPoint[] {
  return Array.from({ length: 478 }, (_, i) => ({ x: 0.3 + i * 0.0005 + seconds * 0.01, y: 0.4 + (i % 7) * 0.01 }));
}

/** hasFace(영상 시각)가 false인 프레임은 얼굴 없음(null). detect가 받은 타임스탬프를 모은다. */
function fakeLandmarker(hasFace: (seconds: number) => boolean = () => true) {
  const timestamps: number[] = [];
  const landmarker: LipLandmarker = {
    detect(video, timestampMs) {
      timestamps.push(timestampMs);
      const seconds = video.currentTime;
      return hasFace(seconds) ? fakeFace(seconds) : null;
    },
    close() {},
  };
  return { landmarker, timestamps };
}

const clip = (name = "yes.mp4") => new File([new Uint8Array(4)], name, { type: "video/mp4" });

let spec: VideoSpec;
let videos: FakeVideo[];
let createUrl: MockInstance<typeof URL.createObjectURL>;
let revokeUrl: MockInstance<typeof URL.revokeObjectURL>;

beforeEach(() => {
  spec = { duration: 0.5 };
  videos = [];
  vi.stubGlobal("document", {
    createElement(tag: string) {
      if (tag !== "video") throw new Error(`예상 밖 요소: ${tag}`);
      const video = new FakeVideo(spec);
      videos.push(video);
      return video;
    },
  });
  let n = 0;
  createUrl = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:fake-${++n}`);
  revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extractFrames", () => {
  it("영상 길이 × fps개 프레임을 i / fps초로 탐색하고, LipFrame.t는 영상 시각(ms)이다", async () => {
    const { landmarker } = fakeLandmarker();
    const result = await extractFrames(clip(), landmarker, 10);

    expect(videos).toHaveLength(1);
    expect(videos[0].seeks).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(result.totalFrames).toBe(5);
    expect(result.faceFrames).toBe(5);
    expect(result.durationMs).toBe(500);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.frames.map((f) => f.t)).toEqual([0, 100, 200, 300, 400]);
    // 좌표는 extractLipFrame(얼굴 점, 영상 가로, 세로, 영상 시각) 그대로 — 가로세로비 보정 포함
    result.frames.forEach((frame, i) => {
      expect(frame).toEqual(extractLipFrame(fakeFace(i / 10), 1280, 720, i * 100));
    });
  });

  it(`기본 fps는 ${DEFAULT_FPS}이고, 부동소수 오차로 마지막 프레임을 잃지 않는다 (1.1초 → 33프레임)`, async () => {
    expect(DEFAULT_FPS).toBe(30);
    spec = { duration: 1.1 };
    const { landmarker } = fakeLandmarker();
    const result = await extractFrames(clip(), landmarker);

    expect(result.totalFrames).toBe(33);
    expect(videos[0].seeks).toHaveLength(33);
    expect(videos[0].seeks[32]).toBe(32 / 30);
    expect(result.frames[32].t).toBeCloseTo((32 * 1000) / 30, 9);
  });

  it("얼굴이 없는 프레임은 frames에 넣지 않고 faceFrames에도 세지 않는다", async () => {
    const { landmarker } = fakeLandmarker((s) => s !== 0.2 && s !== 0.3);
    const result = await extractFrames(clip(), landmarker, 10);

    expect(result.totalFrames).toBe(5);
    expect(result.faceFrames).toBe(3);
    expect(result.frames.map((f) => f.t)).toEqual([0, 100, 400]);
  });

  it("landmarker 타임스탬프는 파일이 바뀌어도, performance.now()가 멈춰 있어도 엄격히 증가한다", async () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const { landmarker, timestamps } = fakeLandmarker();
    await extractFrames(clip("yes.mp4"), landmarker, 10);
    await extractFrames(clip("no.mp4"), landmarker, 10);

    expect(timestamps).toHaveLength(10);
    for (let k = 1; k < timestamps.length; k++) expect(timestamps[k]).toBeGreaterThan(timestamps[k - 1]);
  });

  it("파일은 object URL로만 열고(음소거·인라인), 끝나면 영상을 놓고 URL을 해제한다", async () => {
    const file = clip();
    const { landmarker } = fakeLandmarker();
    await extractFrames(file, landmarker, 10);

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(createUrl).toHaveBeenCalledWith(file);
    expect(videos[0].muted).toBe(true);
    expect(videos[0].playsInline).toBe(true);
    expect(videos[0].released).toBe(true);
    expect(revokeUrl).toHaveBeenCalledWith("blob:fake-1");
  });

  it("진행률은 프레임마다 늘어 1로 끝난다", async () => {
    const { landmarker } = fakeLandmarker();
    const onProgress = vi.fn();
    await extractFrames(clip(), landmarker, 10, onProgress);

    expect(onProgress.mock.calls.map(([ratio]) => ratio)).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
  });

  it("영상을 읽지 못하면 거절하고, object URL은 해제한다", async () => {
    spec = { duration: 0.5, failLoad: true };
    const { landmarker, timestamps } = fakeLandmarker();

    await expect(extractFrames(clip(), landmarker, 10)).rejects.toThrow(/영상을 읽지 못했다/);
    expect(timestamps).toHaveLength(0);
    expect(revokeUrl).toHaveBeenCalledWith("blob:fake-1");
  });

  it.each([Number.POSITIVE_INFINITY, Number.NaN, 0])("길이를 알 수 없는 영상(%s초)은 거절하고, object URL은 해제한다", async (duration) => {
    spec = { duration };
    const { landmarker, timestamps } = fakeLandmarker();

    await expect(extractFrames(clip(), landmarker, 10)).rejects.toThrow(/영상 길이/);
    expect(timestamps).toHaveLength(0);
    expect(revokeUrl).toHaveBeenCalledWith("blob:fake-1");
  });

  it("영상 트랙이 없으면(가로·세로 0) 거절한다", async () => {
    spec = { duration: 0.5, width: 0, height: 0 };
    const { landmarker } = fakeLandmarker();

    await expect(extractFrames(clip(), landmarker, 10)).rejects.toThrow(/영상 트랙/);
    expect(revokeUrl).toHaveBeenCalledWith("blob:fake-1");
  });

  it.each([0, -30, Number.NaN, Number.POSITIVE_INFINITY])("fps가 양의 유한수가 아니면(%s) 파일을 열기 전에 RangeError", async (fps) => {
    const { landmarker } = fakeLandmarker();

    await expect(extractFrames(clip(), landmarker, fps)).rejects.toThrow(RangeError);
    expect(createUrl).not.toHaveBeenCalled();
  });
});

describe("scanVideo (인식 시험용 — 얼굴 점을 그대로 넘긴다)", () => {
  it("모든 프레임을 순서대로 넘기고, 얼굴이 없는 프레임은 landmarks = null", async () => {
    spec = { duration: 0.4, width: 640, height: 480 };
    const { landmarker } = fakeLandmarker((s) => s !== 0.1);
    const seen: ScannedFrame[] = [];
    const result = await scanVideo(clip(), landmarker, 10, (frame) => seen.push(frame));

    expect(result).toEqual({ totalFrames: 4, durationMs: 400, width: 640, height: 480 });
    expect(seen.map((f) => f.t)).toEqual([0, 100, 200, 300]);
    expect(seen.map((f) => f.landmarks === null)).toEqual([false, true, false, false]);
    expect(seen[2].landmarks).toEqual(fakeFace(0.2));
    expect(seen.every((f) => f.width === 640 && f.height === 480)).toBe(true);
    expect(revokeUrl).toHaveBeenCalledWith("blob:fake-1");
  });
});
