import { NextResponse } from "next/server";

// GET /api/demo/end — 데모 쿠키를 삭제하고 로그인 화면으로 돌아간다.
export function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const res = NextResponse.redirect(new URL("/login", origin));
  res.cookies.set("livo_demo", "", { maxAge: 0, path: "/" });
  return res;
}
