import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAccountStore } from "@/services/account-store";
import { ensureAccount } from "@/services/account";

export const runtime = "nodejs";

// Google OAuth 콜백. code를 세션으로 교환하고, 계정 행을 보장한 뒤 홈으로 보낸다.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/home";
  const supabase = getSupabaseServerClient();

  if (code && supabase) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/login?error=auth", url.origin));
    }
    // 첫 로그인이면 accounts 행을 만든다(계정 1 : 대상자 N).
    const userId = data.user?.id;
    if (userId) {
      try {
        await ensureAccount(createSupabaseAccountStore(supabase), userId);
      } catch (e) {
        console.error("ensureAccount 실패", e);
      }
    }
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
