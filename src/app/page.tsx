import Link from "next/link";

// 스플래시/진입(와이어프레임 s01). 골격 단계에서는 두 경로로 가는 입구만 둔다.
// 실제로는 세션 유무로 자동 분기한다(다음 단계).
export default function Home() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            font: "800 34px/1 Pretendard",
            letterSpacing: "-0.045em",
            color: "#2A52BE",
          }}
        >
          입모아
        </div>
        <div style={{ marginTop: 8, color: "#6d707a", fontSize: 14 }}>
          의사소통 보조
        </div>
      </div>

      <nav style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        <Link
          href="/login"
          style={{
            background: "#2A52BE",
            color: "#fff",
            padding: "14px 22px",
            borderRadius: 10,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          보호자 화면
        </Link>
        <Link
          href="/subject"
          style={{
            background: "#0a0a0c",
            color: "#fff",
            padding: "14px 22px",
            borderRadius: 10,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          대상자 화면 (병상 태블릿)
        </Link>
      </nav>

      <p style={{ color: "#6d707a", fontSize: 12.5, maxWidth: 420, textAlign: "center", lineHeight: 1.7 }}>
        골격 화면입니다. 대상자 화면은 손 없이 완결되고 고정 문장 발화는 단말에서 네트워크 없이 동작합니다.
      </p>
    </main>
  );
}
