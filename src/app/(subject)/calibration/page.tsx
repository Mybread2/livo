"use client";

import { useEffect, useRef, useState } from "react";
import { STARTER_PHRASE_IDS, getPhrase } from "@/lib/phrases";
import { useWakeLock } from "@/components/subject/useWakeLock";
import { openCamera, type CameraHandle } from "@/recognition/camera";
import { createLipLandmarker, type LipLandmarker } from "@/recognition/landmarker";
import { extractLipFrame } from "@/recognition/lips";
import { SegmentDetector } from "@/recognition/segment";
import { normalizeSegment } from "@/recognition/normalize";
import { buildTemplateSet, type LabeledSequence } from "@/recognition/analysis";
import { saveTemplates } from "@/offline/templateStore";

// 캘리브레이션(와이어프레임 s20). 화면이 문장을 띄우면 소리 없이 따라 한다.
// 진행은 발화 구간 검출로 자동(손 사용 0회) — 각 문장 REPS회 모으면 다음 문장으로.
// 다 모으면 본인 입모양 DTW 템플릿을 기기(IndexedDB)에 저장한다. 영상·좌표는 단말 밖으로 안 나간다.
const REPS = 3;
const PHRASE_IDS = STARTER_PHRASE_IDS;

type Phase =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "capturing" }
  | { status: "saving" }
  | { status: "done" };

export default function CalibrationPage() {
  useWakeLock(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [reps, setReps] = useState(0);

  // 렌더와 무관하게 캡처 루프가 참조하는 값들
  const phraseIndexRef = useRef(0);
  const repsRef = useRef(0);
  const samplesRef = useRef<LabeledSequence[]>([]);

  useEffect(() => {
    let camera: CameraHandle | null = null;
    let landmarker: LipLandmarker | null = null;
    let raf = 0;
    let disposed = false;
    let lastTs = 0;

    const finish = async () => {
      setPhase({ status: "saving" });
      try {
        const set = buildTemplateSet(samplesRef.current);
        await saveTemplates(set);
        if (!disposed) setPhase({ status: "done" });
      } catch {
        if (!disposed) setPhase({ status: "error", message: "템플릿을 저장하지 못했습니다." });
      }
    };

    void (async () => {
      const video = videoRef.current;
      if (!video) return;
      try {
        camera = await openCamera(video);
        landmarker = await createLipLandmarker();
      } catch {
        if (!disposed) setPhase({ status: "error", message: "카메라 또는 인식 모델을 준비하지 못했습니다." });
        return;
      }
      if (disposed) return;
      setPhase({ status: "capturing" });

      const detector = new SegmentDetector();
      const loop = () => {
        if (disposed || !landmarker || !video) return;
        // MediaPipe VIDEO 모드는 타임스탬프가 엄격히 증가해야 한다
        let t = performance.now();
        if (t <= lastTs) t = lastTs + 1;
        lastTs = t;

        const landmarks = landmarker.detect(video, t);
        if (!landmarks) {
          detector.reset();
        } else {
          const frame = extractLipFrame(landmarks, video.videoWidth, video.videoHeight, t);
          if (frame) {
            const segment = detector.push(frame);
            if (segment) {
              const seq = normalizeSegment(segment);
              if (seq) {
                const phraseId = PHRASE_IDS[phraseIndexRef.current];
                samplesRef.current.push({ phraseId, seq });
                const nextReps = repsRef.current + 1;
                if (nextReps >= REPS) {
                  // 다음 문장으로
                  repsRef.current = 0;
                  setReps(0);
                  const nextPhrase = phraseIndexRef.current + 1;
                  phraseIndexRef.current = nextPhrase;
                  if (nextPhrase >= PHRASE_IDS.length) {
                    void finish();
                    return; // 루프 종료
                  }
                  setPhraseIndex(nextPhrase);
                  detector.reset();
                } else {
                  repsRef.current = nextReps;
                  setReps(nextReps);
                }
              }
            }
          }
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      landmarker?.close();
      camera?.stop();
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        color: "#fff",
        padding: 24,
        textAlign: "center",
      }}
    >
      {/* 카메라는 동작하되 프레임은 서버로 보내지 않는다. 프리뷰는 숨긴다. */}
      <video ref={videoRef} muted playsInline style={{ display: "none" }} />

      {phase.status === "loading" && (
        <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 18 }}>준비 중입니다…</div>
      )}

      {phase.status === "error" && (
        <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 18 }}>{phase.message}</div>
      )}

      {phase.status === "capturing" && (
        <>
          <div style={{ color: "rgba(255,255,255,0.58)", fontSize: 15 }}>
            {PHRASE_IDS.length}개 중 {phraseIndex + 1}번째 문장
          </div>
          <div style={{ font: "700 clamp(44px, 12vw, 100px)/1.15 Pretendard", letterSpacing: "-0.04em" }}>
            {getPhrase(PHRASE_IDS[phraseIndex])?.text}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            {Array.from({ length: REPS }).map((_, i) => (
              <span
                key={i}
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  background: i < reps ? "#fff" : "transparent",
                  border: "1px solid rgba(255,255,255,0.5)",
                }}
              />
            ))}
          </div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, marginTop: 8 }}>
            소리 없이 입모양만 따라 하세요
          </div>
        </>
      )}

      {phase.status === "saving" && (
        <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 18 }}>저장하는 중입니다…</div>
      )}

      {phase.status === "done" && (
        <>
          <div style={{ font: "700 30px/1.2 Pretendard" }}>다 맞췄습니다</div>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 15 }}>
            이제 대상자 화면에서 입모양으로 말할 수 있습니다.
          </div>
        </>
      )}
    </main>
  );
}
