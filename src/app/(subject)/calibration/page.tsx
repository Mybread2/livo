"use client";

import { useWakeLock } from "@/components/subject/useWakeLock";
import { PHRASES } from "@/lib/phrases";

// 캘리브레이션(와이어프레임 s20). 따라 할 문장 1개만 크게.
// 진행은 발화 구간 검출로 자동 전환한다 — 버튼 없음(골격에서는 첫 문장만 표시).
export default function CalibrationPage() {
  useWakeLock(true);
  const emergency = PHRASES.filter((p) => p.emergency);
  const current = emergency[0];

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
      }}
    >
      <div style={{ color: "rgba(255,255,255,0.58)", fontSize: 15 }}>
        {emergency.length}개 중 첫번째 문장
      </div>
      <div
        style={{
          font: "700 clamp(44px, 12vw, 100px)/1.15 Pretendard",
          letterSpacing: "-0.04em",
        }}
      >
        {current.text}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: i === 0 ? "#fff" : "transparent",
              border: "1px solid rgba(255,255,255,0.5)",
            }}
          />
        ))}
      </div>
    </main>
  );
}
