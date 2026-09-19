import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  RevokeButton,
  DeleteSubjectButton,
} from "@/components/caregiver/SettingsActions";

// 설정(와이어프레임 s31·s32). 대상자별: 동의 관리(철회) + 대상자 삭제.
// 철회·삭제는 서버 API로만 한다(목소리 파기 동반, C 담당). DB 직접 불가.
const KIND_LABEL: Record<string, string> = {
  biometric: "생체정보(입술 좌표) 수집",
  voice_self: "음성 사용",
  voice_family: "가족 음성 사용",
  research_use: "연구 활용",
  overseas_transfer: "음성 국외이전",
  research_video: "연구 영상",
  voice_retention: "참조 음성 보관",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { subject?: string };
}) {
  const subjectId = searchParams.subject;
  const supabase = getSupabaseServerClient();

  if (!subjectId) {
    return (
      <main style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <Link href="/home" style={{ color: "#6d707a", fontSize: 13 }}>← 홈</Link>
        <h1 style={{ font: "700 20px/1.2 Pretendard", margin: 0 }}>설정</h1>
        <p style={{ color: "#5c5f67", fontSize: 14 }}>
          홈에서 대상자를 고른 뒤 설정으로 들어와 주세요.
        </p>
      </main>
    );
  }

  let subjectName = "대상자";
  let consents: {
    id: string;
    kind: string;
    granted_at: string;
    revoked_at: string | null;
  }[] = [];

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const { data: subj } = await supabase
      .from("subjects")
      .select("display_name")
      .eq("id", subjectId)
      .maybeSingle();
    if (subj) subjectName = subj.display_name;

    const { data: rows } = await supabase
      .from("consents")
      .select("id, kind, granted_at, revoked_at")
      .eq("subject_id", subjectId)
      .order("granted_at", { ascending: true });
    consents = rows ?? [];
  }

  return (
    <main style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      <Link href="/home" style={{ color: "#6d707a", fontSize: 13 }}>← 홈</Link>
      <h1 style={{ font: "700 20px/1.2 Pretendard", margin: 0 }}>
        설정 · {subjectName} 님
      </h1>

      <h2 style={{ font: "700 15px/1.2 Pretendard", margin: "8px 0 0" }}>동의 관리</h2>
      {consents.length === 0 ? (
        <div style={{ color: "#6d707a", fontSize: 13.5 }}>
          기록된 동의가 없습니다. 온보딩에서 동의를 먼저 받아 주세요.
        </div>
      ) : (
        consents.map((c) => {
          const revoked = c.revoked_at !== null;
          return (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                border: "1px solid rgba(21,22,26,0.13)",
                borderRadius: 10,
                padding: 12,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {KIND_LABEL[c.kind] ?? c.kind}
                </div>
                <div style={{ fontSize: 12.5, color: "#6d707a" }}>
                  {revoked
                    ? `철회됨 · ${new Date(c.revoked_at as string).toLocaleDateString("ko-KR")}`
                    : `동의 · ${new Date(c.granted_at).toLocaleDateString("ko-KR")}`}
                </div>
              </div>
              {!revoked && <RevokeButton consentId={c.id} />}
            </div>
          );
        })
      )}

      <div
        style={{
          background: "#fafafa",
          border: "1px solid rgba(21,22,26,0.09)",
          borderRadius: 10,
          padding: 12,
          fontSize: 12.5,
          color: "#5c5f67",
        }}
      >
        철회하면 원본과 추출 좌표·영상은 파기됩니다. 이미 학습이 끝난 모델은 제외되며, 이후 학습에는 쓰지 않습니다. 응급 문장 발화는 철회 후에도 동작합니다.
      </div>

      <h2 style={{ font: "700 15px/1.2 Pretendard", margin: "12px 0 0", color: "#7a2020" }}>
        대상자 삭제
      </h2>
      <DeleteSubjectButton subjectId={subjectId} />
    </main>
  );
}
