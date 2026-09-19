import { notFound } from "next/navigation";

// 개발 도구 그룹(/dev/*). 대상자·보호자 화면이 아니다.
export default function DevLayout({ children }: { children: React.ReactNode }) {
  // 개발 서버에서만 연다 — 운영 빌드(Vercel 포함)에서는 404
  if (process.env.NODE_ENV === "production") notFound();
  return <>{children}</>;
}
