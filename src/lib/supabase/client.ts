"use client";

import { createBrowserClient } from "@supabase/ssr";

// 브라우저용 Supabase 클라이언트(보호자 경로 전용).
// 환경변수가 아직 없으면 null 을 돌려준다 — 대상자 화면과 dev 서버가 죽지 않게.
export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createBrowserClient(url, anon);
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
