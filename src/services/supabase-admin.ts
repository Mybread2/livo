import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// service_role 키는 RLS를 우회한다. 이 클라이언트는 VoiceStore 안에서만 쓰고, 권한 판단은 서버 함수의 ownsSubject가 한다.
export function createSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았다");
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
