import { describe, it, expect, vi } from "vitest";
import type { RecognitionEvent } from "@/types/recognition";
import { LipRecognizer, type LipRecognizerDeps } from "./lipRecognizer";
import type { LipLandmarker } from "./landmarker";
import type { CameraHandle } from "./camera";
import type { LandmarkPoint } from "./lips";
import { extractLipFrame } from "./lips";
import { segmentsFromFrames, buildTemplateSet } from "./analysis";
import { LIP_LANDMARK_INDICES, type LipFrame } from "./types";
import type { TemplateSet } from "./dtw";

// ── 합성 얼굴: 478점 중 입술 40점만 타원 입 모양 ──
type Shape = { w: number; open: number };
type Word = (s: number) => Shape;
const REST: Shape = { w: 1, open: 0.05 };
const words: Record<string, Word> = {
  pain: (s) => ({ w: 1, open: 0.05 + 0.5 * Math.sin(Math.PI * s) }),
  water: (s) => ({ w: 1 + 0.4 * Math.sin(Math.PI * s), open: 0.05 + 0.6 * Math.abs(Math.sin(2 * Math.PI * s)) }),
  toilet: (s) => ({ w: 1 - 0.25 * Math.sin(Math.PI * s), open: 0.05 + 0.45 * Math.sin(Math.PI * s) ** 3 }),
};
function face({ w, open }: Shape): LandmarkPoint[] {
  const pts: LandmarkPoint[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  for (let i = 0; i < 20; i++) {
    const th = Math.PI - (i * Math.PI) / 10;
    pts[LIP_LANDMARK_INDICES[i]] = { x: 0.5 + 0.04 * w * Math.cos(th), y: 0.6 - 0.02 * Math.sin(th) };
    pts[LIP_LANDMARK_INDICES[i + 20]] = { x: 0.5 + 0.032 * w * Math.cos(th), y: 0.6 - ((0.02 * open) / 0.5) * Math.sin(th) };
  }
  return pts;
}
/** t(ms) → 입 모양. startMs부터 speakMs 동안 word, 그 밖은 쉼. */
const timeline = (word: Word, startMs = 1000, speakMs = 700) => (t: number): Shape =>
  t < startMs || t > startMs + speakMs ? REST : word((t - startMs) / speakMs);

function templatesFor(ids: string[]): TemplateSet {
  const samples = ids.map((id) => {
    const frames: LipFrame[] = [];
    const tl = timeline(words[id]);
    for (let t = 0; t <= 2900; t += 1000 / 30) frames.push(extractLipFrame(face(tl(t)), 640, 480, t)!);
    return { phraseId: id, seq: segmentsFromFrames(frames)[0].seq };
  });
  return buildTemplateSet(samples);
}

// ── 가짜 브라우저 ──
function harness(opts: { templates?: TemplateSet | null; shapeAt?: (t: number) => Shape | null; deps?: Partial<LipRecognizerDeps> } = {}) {
  let clock = 0;
  const video = { readyState: 4, currentTime: 0, videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement;
  const pending: Array<() => void> = [];
  const camera = { stream: {} as MediaStream, stop: vi.fn() } satisfies CameraHandle;
  const landmarker = {
    detect: vi.fn((_v: HTMLVideoElement, t: number) => {
      const shape = (opts.shapeAt ?? (() => REST))(t);
      return shape ? face(shape) : null;
    }),
    close: vi.fn(),
  } satisfies LipLandmarker;
  const warnings: string[] = [];
  const events: RecognitionEvent[] = [];
  const deps: LipRecognizerDeps = {
    loadTemplates: vi.fn(async () => (opts.templates === undefined ? templatesFor(["pain", "water", "toilet"]) : opts.templates)),
    openCamera: vi.fn(async () => camera),
    createLandmarker: vi.fn(async () => landmarker),
    now: () => clock,
    scheduleFrame: (cb) => {
      pending.push(cb);
      return () => {
        const k = pending.indexOf(cb);
        if (k >= 0) pending.splice(k, 1);
      };
    },
    onWarning: (m) => warnings.push(m),
    ...opts.deps,
  };
  const recognizer = new LipRecognizer(deps);
  /** 한 프레임(33ms) 진행. */
  const frame = (n = 1) => {
    for (let i = 0; i < n; i++) {
      clock += 1000 / 30;
      (video as { currentTime: number }).currentTime += 1 / 30;
      const cb = pending.shift();
      cb?.();
    }
  };
  return { recognizer, video, camera, landmarker, deps, warnings, events, frame, pending, onResult: (e: RecognitionEvent) => events.push(e) };
}

describe("LipRecognizer", () => {
  it("템플릿이 없으면 경고하고 카메라를 켜지 않는다", async () => {
    const h = harness({ templates: null });
    await h.recognizer.start(h.video, h.onResult);
    expect(h.warnings).toHaveLength(1);
    expect(h.deps.openCamera).not.toHaveBeenCalled();
    expect(h.deps.createLandmarker).not.toHaveBeenCalled();
    h.frame(100);
    expect(h.events).toHaveLength(0);
  });

  it("단어를 말하면 정지 500ms 뒤 onResult 1회 — 올바른 문장, speak", async () => {
    const h = harness({ shapeAt: timeline(words.water) });
    await h.recognizer.start(h.video, h.onResult);
    h.frame(100); // 3.3초
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ phraseId: "water", text: "물이요", gate: "speak" });
  });

  it("manualSession이 게이트까지 전달된다 (점수 0.85: 자동 show / 수동 speak)", async () => {
    const pipeline = { score: { ratioOffset: 0.85 } };
    const auto = harness({ shapeAt: timeline(words.pain), deps: { pipeline } });
    await auto.recognizer.start(auto.video, auto.onResult);
    auto.frame(100);
    const manual = harness({ shapeAt: timeline(words.pain), deps: { pipeline } });
    await manual.recognizer.start(manual.video, manual.onResult, { manualSession: true });
    manual.frame(100);
    expect(auto.events.map((e) => e.gate)).toEqual(["show"]);
    expect(manual.events.map((e) => e.gate)).toEqual(["speak"]);
  });

  it("어느 템플릿과도 먼 움직임은 discard 이벤트로 온다", async () => {
    const h = harness({ templates: templatesFor(["pain", "water"]), shapeAt: timeline(words.toilet), deps: { pipeline: { score: { rejectDistance: 0.001 } } } });
    await h.recognizer.start(h.video, h.onResult);
    h.frame(100);
    expect(h.events.map((e) => e.gate)).toEqual(["discard"]);
  });

  it("같은 영상 시각이면 다시 추론하지 않고, readyState < 2면 건너뛴다", async () => {
    const h = harness();
    await h.recognizer.start(h.video, h.onResult);
    h.frame(1);
    const calls = h.landmarker.detect.mock.calls.length;
    const cb = h.pending.shift()!;
    cb(); // 시계·currentTime 그대로
    expect(h.landmarker.detect.mock.calls.length).toBe(calls);
    (h.video as { readyState: number }).readyState = 1;
    h.frame(3);
    expect(h.landmarker.detect.mock.calls.length).toBe(calls);
  });

  it("stop() — 카메라 끔·landmarker close·루프 취소, 두 번 불러도 된다", async () => {
    const h = harness({ shapeAt: timeline(words.pain) });
    await h.recognizer.start(h.video, h.onResult);
    h.frame(20);
    h.recognizer.stop();
    h.recognizer.stop();
    expect(h.camera.stop).toHaveBeenCalled();
    expect(h.landmarker.close).toHaveBeenCalledTimes(1);
    expect(h.pending).toHaveLength(0);
    h.frame(100);
    expect(h.events).toHaveLength(0);
  });

  it("템플릿을 읽는 중에 stop() — 카메라를 켜지 않는다", async () => {
    let release!: (v: TemplateSet) => void;
    const h = harness({ deps: { loadTemplates: () => new Promise((r) => (release = r)) } });
    const started = h.recognizer.start(h.video, h.onResult);
    h.recognizer.stop();
    release(templatesFor(["pain", "water"]));
    await started;
    expect(h.deps.openCamera).not.toHaveBeenCalled();
  });

  it("카메라를 켜는 중에 stop() — 켜진 카메라를 바로 끈다", async () => {
    let release!: () => void;
    const camera = { stream: {} as MediaStream, stop: vi.fn() };
    const h = harness({ deps: { openCamera: () => new Promise((r) => (release = () => r(camera))) } });
    const started = h.recognizer.start(h.video, h.onResult);
    await Promise.resolve();
    await Promise.resolve();
    h.recognizer.stop();
    release();
    await started;
    expect(camera.stop).toHaveBeenCalledTimes(1);
    expect(h.deps.createLandmarker).not.toHaveBeenCalled();
  });

  it("start 두 번 — 앞 실행을 정리한다", async () => {
    const h = harness();
    await h.recognizer.start(h.video, h.onResult);
    await h.recognizer.start(h.video, h.onResult);
    expect(h.camera.stop).toHaveBeenCalledTimes(1);
    expect(h.pending).toHaveLength(1);
  });

  it("카메라를 못 켜면 start는 resolve하고 경고만 남긴다", async () => {
    const h = harness({ deps: { openCamera: async () => Promise.reject(new Error("NotAllowedError")) } });
    await expect(h.recognizer.start(h.video, h.onResult)).resolves.toBeUndefined();
    expect(h.warnings.some((w) => w.includes("NotAllowedError"))).toBe(true);
    expect(h.deps.createLandmarker).not.toHaveBeenCalled();
  });

  it("onResult가 throw해도 루프는 계속되고 다음 단어도 인식한다", async () => {
    const tl1 = timeline(words.pain, 1000);
    const tl2 = timeline(words.water, 3500);
    const h = harness({ shapeAt: (t) => (t < 3000 ? tl1(t) : tl2(t)) });
    let first = true;
    await h.recognizer.start(h.video, (e) => {
      h.events.push(e);
      if (first) {
        first = false;
        throw new Error("boom");
      }
    });
    h.frame(180); // 6초
    expect(h.warnings.some((w) => w.includes("boom"))).toBe(true);
    expect(h.events.map((e) => e.phraseId)).toEqual(["pain", "water"]);
  });
});
