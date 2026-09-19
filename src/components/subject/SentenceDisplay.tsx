"use client";

import type { GateResult } from "@/types/recognition";

// 인식된 문장 표시(와이어프레임 s19~s23).
// speak: 흰 막대 + "음성" + 흰 글자. show: 빈 막대 + "무음". discard: 아무것도 없음.
// 발화 앞에 fade·slide·안내음을 넣지 않는다(지연 예산 약 0.6초).
export function SentenceDisplay({
  text,
  gate,
}: {
  text: string | null;
  gate: GateResult | null;
}) {
  if (!text || !gate || gate === "discard") {
    // 대기/폐기: 순수 검정. 실패를 대상자에게 알리지 않는다.
    return <div style={{ flex: 1 }} aria-hidden />;
  }

  const speaking = gate === "speak";

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        gap: 24,
        padding: "0 6%",
      }}
    >
      <div
        style={{
          width: 10,
          alignSelf: "stretch",
          margin: "8% 0",
          borderRadius: 5,
          background: speaking ? "#fff" : "transparent",
          border: speaking ? "none" : "1px solid rgba(255,255,255,0.45)",
        }}
        aria-hidden
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          style={{
            font: "700 clamp(44px, 11vw, 96px)/1.15 Pretendard",
            letterSpacing: "-0.04em",
            color: speaking ? "#fff" : "rgba(255,255,255,0.92)",
          }}
        >
          {text}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              font: '400 12px/1 "IBM Plex Mono", monospace',
              padding: "5px 8px",
              border: "1px solid currentColor",
              borderRadius: 6,
              color: "#fff",
            }}
          >
            {speaking ? "음성" : "무음"}
          </span>
          <span style={{ color: "rgba(255,255,255,0.58)", fontSize: 14 }}>
            {speaking ? "지금 소리가 나고 있습니다" : "확인 중입니다"}
          </span>
        </div>
      </div>
    </div>
  );
}
