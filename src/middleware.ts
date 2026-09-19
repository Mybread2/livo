import { type NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// 보호자 경로의 세션 쿠키를 갱신한다(@supabase/ssr 권장 패턴).
// 대상자 경로((subject))와 정적 자산은 건드리지 않는다 — 로그인 없이 동작해야 한다.
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return response; // 미연결이면 통과

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
      ) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  // 보호자 화면·콜백만. 대상자 화면·API·정적 파일은 제외.
  matcher: ["/home", "/settings", "/phrases", "/voice", "/onboarding", "/login"],
};
