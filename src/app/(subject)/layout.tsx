// 대상자 화면 그룹. 병상 태블릿·키오스크 전용.
// 검정 배경, 손 없이 완결. 보호자용 내비게이션·헤더를 두지 않는다.
export default function SubjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="subject-screen">{children}</div>;
}
