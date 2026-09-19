// 보호자 화면 그룹. 고령 사용자 기준 — 글자·터치 영역 크게.
// 포인트색(#2A52BE)은 "지금 눌러야 할 것 하나"와 "선택됨"에만.
export default function CaregiverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh" }}>
      {children}
    </div>
  );
}
