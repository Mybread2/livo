import Link from "next/link";

// 보호자 홈 대시보드(와이어프레임 s16). 주요 동작 2개만 큰 버튼으로.
// 발화 로그는 횟수·시각만 — 좌표·오디오는 저장하지 않는다.
const btn: React.CSSProperties = {
  display: "block",
  padding: 17,
  borderRadius: 10,
  fontWeight: 700,
  textAlign: "center",
  textDecoration: "none",
};

export default function HomePage() {
  return (
    <main style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 4px 12px",
          borderBottom: "1px solid rgba(21,22,26,0.13)",
        }}
      >
        <span style={{ font: "800 18px/1 Pretendard", color: "#2A52BE" }}>
          입모아
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/settings" style={{ color: "#6d707a", fontSize: 13 }}>
          설정
        </Link>
      </header>

      <div
        style={{
          border: "1px solid rgba(21,22,26,0.13)",
          borderRadius: 10,
          padding: 12,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 15 }}>김O수 님</div>
        <div style={{ color: "#5c5f67", fontSize: 13 }}>
          문장 15개 · 프리셋 목소리
        </div>
      </div>

      <Link href="/phrases" style={{ ...btn, background: "#2A52BE", color: "#fff" }}>
        문장 관리
      </Link>
      <Link
        href="/voice"
        style={{
          ...btn,
          background: "rgba(42,82,190,0.06)",
          color: "#2A52BE",
          border: "1px solid rgba(42,82,190,0.4)",
        }}
      >
        목소리 설정
      </Link>

      <Link
        href="/subject"
        style={{
          ...btn,
          background: "#0a0a0c",
          color: "#fff",
          marginTop: 6,
        }}
      >
        대상자 화면 열기
      </Link>
    </main>
  );
}
