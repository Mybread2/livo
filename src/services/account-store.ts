import type { SupabaseClient } from "@supabase/supabase-js";

// 계정·대상자 데이터 접근. 로직(account.ts)은 이 인터페이스에만 의존해 테스트한다.
export interface AccountRow {
  id: string;
  userId: string;
}

export interface SubjectRow {
  id: string;
  accountId: string;
  displayName: string;
  triggerMode: string;
}

export interface AccountStore {
  getAccountByUser(userId: string): Promise<AccountRow | null>;
  createAccount(userId: string): Promise<AccountRow>;
  listSubjects(accountId: string): Promise<SubjectRow[]>;
  createSubject(accountId: string, displayName: string): Promise<SubjectRow>;
}

// 로그인한 사용자의 인증 클라이언트(RLS 적용)로 동작한다. 본인 계정·대상자만 보이고 만들 수 있다.
export function createSupabaseAccountStore(
  supabase: SupabaseClient,
): AccountStore {
  return {
    async getAccountByUser(userId) {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, user_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data ? { id: data.id, userId: data.user_id } : null;
    },
    async createAccount(userId) {
      const { data, error } = await supabase
        .from("accounts")
        .insert({ user_id: userId })
        .select("id, user_id")
        .single();
      if (error) throw error;
      return { id: data.id, userId: data.user_id };
    },
    async listSubjects(accountId) {
      const { data, error } = await supabase
        .from("subjects")
        .select("id, account_id, display_name, trigger_mode")
        .eq("account_id", accountId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        accountId: r.account_id,
        displayName: r.display_name,
        triggerMode: r.trigger_mode,
      }));
    },
    async createSubject(accountId, displayName) {
      const { data, error } = await supabase
        .from("subjects")
        .insert({ account_id: accountId, display_name: displayName })
        .select("id, account_id, display_name, trigger_mode")
        .single();
      if (error) throw error;
      return {
        id: data.id,
        accountId: data.account_id,
        displayName: data.display_name,
        triggerMode: data.trigger_mode,
      };
    },
  };
}
