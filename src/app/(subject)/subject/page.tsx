"use client";

import { useEffect, useRef, useState } from "react";
import type { GateResult, Recognizer } from "@/types/recognition";
import { MockRecognizer } from "@/recognition/mockRecognizer";
import {
  createVoicePlayer,
  VoiceNotReadyError,
  type SyncableVoicePlayer,
} from "@/offline/voice-player";
import type { VoiceBundle } from "@/types/voice-bundle";
import { useWakeLock } from "@/components/subject/useWakeLock";
import { SentenceDisplay } from "@/components/subject/SentenceDisplay";
import { enqueue } from "@/offline/logQueue";

// 대상자 화면 런타임(와이어프레임 s19~s23).
// 인식(B)은 아직 mock, 목소리(C)는 실제 사전 합성 오디오로 연동됐다.
// CRITICAL: 이 화면은 손 없이 완결한다. 발화 순간 네트워크를 쓰지 않는다(sync는 미리).
export default function SubjectPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const voiceRef = useRef<SyncableVoicePlayer | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [gate, setGate] = useState<GateResult | null>(null);

  useWakeLock(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // 병상 태블릿은 URL로 대상자를 받는다: /subject?subject=<uuid>
    const subjectId = new URLSearchParams(window.location.search).get("subject");

    const recognizer: Recognizer = new MockRecognizer();
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    // C의 VoicePlayer: 번들을 받아 단말(Cache Storage)에 저장 → 이후 오프라인 재생.
    // 최초 동기화 때는 보호자 로그인 세션이 필요하다.
    void (async () => {
      if (!subjectId) return; // 대상자 미지정이면 소리 없이 텍스트만
      try {
        const player = await createVoicePlayer({
          fetchBundle: async (): Promise<VoiceBundle> => {
            const res = await fetch(`/api/bundle/${subjectId}`);
            if (!res.ok) throw new Error(`bundle ${res.status}`);
            return (await res.json()).voice as VoiceBundle;
          },
        });
        // 오프라인이면 이전에 받아 둔 오디오로 재생한다.
        await player.sync().catch(() => {});
        if (!disposed) voiceRef.current = player;
      } catch {
        // 목소리 준비 실패 — 텍스트 표시는 계속된다.
      }
    })();

    void recognizer.start(video, (e) => {
      // discard: 화면·소리 변화 없음. 로그도 남기지 않는다.
      if (e.gate === "discard") return;

      setText(e.text);
      setGate(e.gate);

      if (e.gate === "speak") {
        const player = voiceRef.current;
        if (player) {
          player.speak(e.phraseId).catch((err) => {
            // 아직 오디오를 못 받았으면 조용히 텍스트만 — 다시 말하면 된다.
            if (!(err instanceof VoiceNotReadyError)) console.error(err);
          });
        }
      }

      enqueue({
        subjectId: subjectId ?? "unknown",
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
      disposed = true;
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
