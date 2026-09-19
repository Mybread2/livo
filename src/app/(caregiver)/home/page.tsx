import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAccountStore } from "@/services/account-store";
import { ensureAccount, addSubject } from "@/services/account";

// 보호자 홈 대시보드(와이어프레임 s16 · s18). 실제 대상자 목록 + 추가.
// 발화 로그는 횟수·시각만 — 좌표·오디오는 저장하지 않는다.
const btn: React.CSSProperties = {
  display: "block",
  padding: 17,
  borderRadius: 10,
  fontWeight: 700,
  textAlign: "center",
  textDecoration: "none",
};

// 대상자 추가 서버 액션.
async function addSubjectAction(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "");
  const supabase = getSupabaseServerClient();
  if (!supabase) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const store = createSupabaseAccountStore(supabase);
  const account = await ensureAccount(store, user.id);
  if (name.trim() === "") return;
  await addSubject(store, account.id, name);
  revalidatePath("/home");
}

export default async function HomePage() {
  const supabase = getSupabaseServerClient();

  // Supabase 미연결이면(로컬 초기) 가드를 건너뛰고 빈 상태만 보여준다.
  let email: string | null = null;
  let subjects: { id: string; displayName: string }[] = [];
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    email = user.email ?? null;
    const store = createSupabaseAccountStore(supabase);
    const account = await ensureAccount(store, user.id);
    subjects = (await store.listSubjects(account.id)).map((s) => ({
      id: s.id,
      displayName: s.displayName,
    }));
  }

  return (
    <main style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 4px 12px",
          borderBottom: "1px solid rgba(21,22,26,0.13)",
        }}
      >
        <span style={{ font: "800 18px/1 Pretendard", color: "#2A52BE" }}>
          입모아
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/settings" style={{ color: "#6d707a", fontSize: 13 }}>
          설정
        </Link>
      </header>

      {email && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12.5,
            color: "#6d707a",
          }}
        >
          <span style={{ flex: 1 }}>{email} 로 로그인됨</span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              style={{
                background: "none",
                border: "1px solid rgba(21,22,26,0.13)",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 12.5,
                color: "#6d707a",
              }}
            >
              로그아웃
            </button>
          </form>
        </div>
      )}

      {/* 대상자 목록 */}
      {subjects.length === 0 ? (
        <div
          style={{
            border: "1px dashed rgba(21,22,26,0.22)",
            borderRadius: 10,
            padding: 16,
            color: "#6d707a",
            fontSize: 13.5,
          }}
        >
          아직 등록된 대상자가 없습니다. 아래에서 추가해 주세요.
        </div>
      ) : (
        subjects.map((s) => (
          <div
            key={s.id}
            style={{
              border: "1px solid rgba(21,22,26,0.13)",
              borderRadius: 10,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 15 }}>{s.displayName} 님</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link
                href={`/onboarding?subject=${s.id}`}
                style={{
                  fontSize: 13,
                  color: "#fff",
                  background: "#2A52BE",
                  borderRadius: 8,
                  padding: "8px 12px",
                  textDecoration: "none",
                }}
              >
                온보딩
              </Link>
              <Link
                href={`/voice?subject=${s.id}`}
                style={{
                  fontSize: 13,
                  color: "#2A52BE",
                  border: "1px solid rgba(42,82,190,0.4)",
                  background: "rgba(42,82,190,0.06)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  textDecoration: "none",
                }}
              >
                목소리 설정
              </Link>
              <Link
                href={`/subject?subject=${s.id}`}
                style={{
                  fontSize: 13,
                  color: "#fff",
                  background: "#0a0a0c",
                  borderRadius: 8,
                  padding: "8px 12px",
                  textDecoration: "none",
                }}
              >
                대상자 화면 열기
              </Link>
              <Link
                href={`/settings?subject=${s.id}`}
                style={{
                  fontSize: 13,
                  color: "#6d707a",
                  border: "1px solid rgba(21,22,26,0.13)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  textDecoration: "none",
                }}
              >
                설정
              </Link>
            </div>
          </div>
        ))
      )}

      {/* 대상자 추가 (계정 1 : 대상자 N) */}
      <form
        action={addSubjectAction}
        style={{ display: "flex", gap: 8, marginTop: 2 }}
      >
        <input
          name="name"
          placeholder="대상자 이름 (예: 김O수)"
          required
          style={{
            flex: 1,
            border: "1px solid rgba(21,22,26,0.2)",
            borderRadius: 10,
            padding: 12,
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          style={{
            background: "#fff",
            border: "1px solid rgba(21,22,26,0.2)",
            borderRadius: 10,
            padding: "0 16px",
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          ＋ 추가
        </button>
      </form>

      <Link href="/phrases" style={{ ...btn, background: "#2A52BE", color: "#fff", marginTop: 6 }}>
        문장 관리
      </Link>
    </main>
  );
}
