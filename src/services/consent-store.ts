import type { SupabaseClient } from "@supabase/supabase-js";

// 동의 기록 데이터 접근. 로직(consent.ts)은 이 인터페이스에만 의존해 테스트한다.
// 근거: docs/ADR.md ADR-008(동의를 스키마로 강제) · consents 테이블.
export type ConsentKind =
  | "biometric"
  | "voice_self"
  | "voice_family"
  | "research_use"
  | "overseas_transfer"
  | "research_video"
  | "voice_retention";

export type GrantedBy = "self" | "legal_guardian" | "family";

export interface ConsentInput {
  subjectId: string;
  kind: ConsentKind;
  grantedBy: GrantedBy;
  docVersion: string;
}

export interface ConsentStore {
  insertConsents(rows: ConsentInput[]): Promise<void>;
}

// 로그인한 사용자의 인증 클라이언트(RLS 적용). 본인 대상자의 동의만 넣을 수 있다.
export function createSupabaseConsentStore(
  supabase: SupabaseClient,
): ConsentStore {
  return {
    async insertConsents(rows) {
      if (rows.length === 0) return;
      const { error } = await supabase.from("consents").insert(
        rows.map((r) => ({
          subject_id: r.subjectId,
          kind: r.kind,
          granted_by: r.grantedBy,
          doc_version: r.docVersion,
        })),
      );
      if (error) throw error;
    },
  };
}
