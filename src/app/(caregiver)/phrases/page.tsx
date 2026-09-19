import Link from "next/link";
import { PHRASES, type Tier } from "@/lib/phrases";

// 문장 관리(와이어프레임 s30). 전역 고정 문장 15개를 Tier별로 보여준다.
// 응급(T0) 4개는 삭제·비활성 불가. 상한 30개.
// "문장 추가"는 목소리마다 재합성이 필요하고 무료 플랜 슬롯 제한이 있어 지금은 막아 둔다(C와 조율 필요).
const MAX_PHRASES = 30;

const TIER_LABEL: Record<Tier, string> = {
  T0: "응급",
  T1: "생리",
  T2: "환경",
  T3: "소통",
};

export default function PhrasesPage() {
  const tiers: Tier[] = ["T0", "T1", "T2", "T3"];

  return (
    <main style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <Link href="/home" style={{ color: "#6d707a", fontSize: 13 }}>← 홈</Link>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: "#6d707a" }}>
          {PHRASES.length} / {MAX_PHRASES}
        </span>
      </div>
      <h1 style={{ font: "700 20px/1.2 Pretendard", margin: 0 }}>문장 관리</h1>

      {tiers.map((tier) => {
        const items = PHRASES.filter((p) => p.tier === tier);
        const emergency = tier === "T0";
        return (
          <div
            key={tier}
            style={{
              border: `1px solid ${emergency ? "rgba(42,82,190,0.35)" : "rgba(21,22,26,0.13)"}`,
              background: emergency ? "rgba(42,82,190,0.06)" : "#fafafa",
              borderRadius: 10,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {TIER_LABEL[tier]} · {items.length}개
              </span>
              {emergency && (
                <span
                  style={{
                    fontSize: 11,
                    color: "#2A52BE",
                    border: "1px solid rgba(42,82,190,0.35)",
                    borderRadius: 5,
                    padding: "2px 6px",
                  }}
                >
                  고정
                </span>
              )}
            </div>
            <div style={{ fontSize: 13.5, color: "#3f434c" }}>
              {items.map((p) => p.text).join(" · ")}
            </div>
            {emergency && (
              <div style={{ fontSize: 12, color: "#6d707a" }}>
                지울 수 없습니다. 결제와 무관하게 항상 동작합니다.
              </div>
            )}
          </div>
        );
      })}

      <button
        disabled
        style={{
          background: "#fafafa",
          color: "rgba(21,22,26,0.3)",
          border: "1px solid rgba(21,22,26,0.09)",
          borderRadius: 10,
          padding: 15,
          fontWeight: 700,
          fontSize: 15,
        }}
      >
        ＋ 문장 추가 (준비 중)
      </button>
      <p style={{ fontSize: 12, color: "#6d707a", margin: 0, lineHeight: 1.6 }}>
        새 문장은 목소리마다 다시 합성해야 해서 곧 열립니다. 지금은 기본 15문장이 모든 목소리로 준비돼 있습니다.
      </p>
    </main>
  );
}
