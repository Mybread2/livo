"use server";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseConsentStore } from "@/services/consent-store";
import { recordConsents, MissingRequiredConsentError } from "@/services/consent";
import type { ConsentKind } from "@/services/consent-store";

export interface ConsentActionResult {
  ok: boolean;
  error?: "unauthorized" | "missing_required" | "failed";
  missing?: ConsentKind[];
}

// 온보딩 동의 저장. 필수 동의가 없으면 저장하지 않는다.
export async function submitConsents(
  subjectId: string,
  grantedKinds: ConsentKind[],
  legalGuardian: boolean,
): Promise<ConsentActionResult> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: "failed" };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  try {
    await recordConsents(createSupabaseConsentStore(supabase), {
      subjectId,
      grantedKinds,
      grantedBy: legalGuardian ? "legal_guardian" : "self",
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof MissingRequiredConsentError) {
      return { ok: false, error: "missing_required", missing: err.missing };
    }
    console.error("submitConsents 실패", err);
    return { ok: false, error: "failed" };
  }
}
