"use client";

import { useEffect, useRef, useState } from "react";
import type { GateResult, Recognizer } from "@/types/recognition";
import type { VoicePlayer } from "@/types/voice";
import { MockRecognizer } from "@/recognition/mockRecognizer";
import { MockVoicePlayer } from "@/offline/mockVoicePlayer";
import { useWakeLock } from "@/components/subject/useWakeLock";
import { SentenceDisplay } from "@/components/subject/SentenceDisplay";
import { enqueue } from "@/offline/logQueue";

// 대상자 화면 런타임(와이어프레임 s19~s23).
// A는 §계약(Recognizer·VoicePlayer)에만 의존한다 — 지금은 mock, 나중에 B·C 실구현으로 교체.
// CRITICAL: 이 화면은 손 없이 완결한다. 확인 버튼·모달·토스트를 두지 않는다.
export default function SubjectPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [gate, setGate] = useState<GateResult | null>(null);

  useWakeLock(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // 여기서 실제 모듈로 갈아끼운다: new BRecognizer() / new CVoicePlayer()
    const recognizer: Recognizer = new MockRecognizer();
    const voice: VoicePlayer = new MockVoicePlayer();
    let clearTimer: ReturnType<typeof setTimeout> | null = null;

    void recognizer.start(video, (e) => {
      // discard: 화면·소리 변화 없음. 로그도 남기지 않는다.
      if (e.gate === "discard") return;

      setText(e.text);
      setGate(e.gate);

      if (e.gate === "speak") {
        void voice.speak(e.phraseId);
      }

      enqueue({
        subjectId: "demo",
        track: "fixed",
        phraseId: e.phraseId,
        text: e.text,
        score: e.score,
        gateResult: e.gate,
        latencyMs: 0,
        createdAt: new Date().toISOString(),
      });

      // 표시는 잠깐 유지한 뒤 대기(검정)로 돌아간다.
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        setText(null);
        setGate(null);
      }, 2500);
    });

    return () => {
      recognizer.stop();
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 카메라는 동작하되 프레임은 서버로 보내지 않는다. 프리뷰는 숨긴다. */}
      <video ref={videoRef} muted playsInline style={{ display: "none" }} />
      <SentenceDisplay text={text} gate={gate} />
    </main>
  );
}
