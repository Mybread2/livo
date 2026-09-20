import { NextResponse } from "next/server";

// GET /api/demo/start — 데모 쿠키를 심고 /home 으로 리다이렉트한다.
// 심사·투표 기간 전용. Google 로그인 없이 보호자 화면을 체험할 수 있다.
export function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const res = NextResponse.redirect(new URL("/home", origin));
  res.cookies.set("livo_demo", "1", {
    httpOnly: false, // 클라이언트 컴포넌트에서도 읽어야 한다
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 14, // 14일
    path: "/",
  });
  return res;
}
