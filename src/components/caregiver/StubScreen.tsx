import Link from "next/link";

// 골격 단계의 자리표시 화면. 다음 단계에서 실제 UI로 채운다.
export function StubScreen({
  title,
  note,
  wire,
}: {
  title: string;
  note: string;
  wire: string;
}) {
  return (
    <main style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <Link href="/home" style={{ color: "#6d707a", fontSize: 13 }}>
        ← 홈
      </Link>
      <h1 style={{ font: "700 20px/1.2 Pretendard", margin: 0 }}>{title}</h1>
      <p style={{ color: "#5c5f67", fontSize: 14, lineHeight: 1.7, margin: 0 }}>
        {note}
      </p>
      <div
        style={{
          background: "#fafafa",
          border: "1px dashed rgba(21,22,26,0.22)",
          borderRadius: 10,
          padding: 14,
          color: "#6d707a",
          fontSize: 12.5,
        }}
      >
        와이어프레임 참조: {wire} · 이 화면은 다음 단계에서 구현합니다.
      </div>
    </main>
  );
}
