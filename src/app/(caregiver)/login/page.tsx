"use client";

import { useState, useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// 보호자 로그인(와이어프레임 s02·s03). Google OAuth 단독.
// Supabase 미연결이면 안내만 하고 dev 흐름을 막지 않는다.
export default function LoginPage() {
  const [msg, setMsg] = useState<string | null>(null);

  // 콜백에서 실패로 돌아온 경우(?error=auth) 사유를 보여준다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) {
      setMsg("로그인이 되지 않았습니다. 다시 시도해 주세요.");
    }
  }, []);

  const onGoogle = async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setMsg("인터넷에 연결되어 있지 않습니다. 연결 후 다시 시도해 주세요.");
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setMsg("Supabase가 아직 연결되지 않았습니다(.env.local 필요).");
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // 코드 교환은 /auth/callback 이 한다 → 거기서 /home 으로 보낸다.
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/home` },
    });
    if (error) setMsg("로그인이 되지 않았습니다. 다시 시도해 주세요.");
  };

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        padding: 24,
        gap: 16,
      }}
    >
      <div style={{ flex: 1 }} />
      <div style={{ textAlign: "center" }}>
        <div style={{ font: "800 24px/1 Pretendard", letterSpacing: "-0.045em" }}>
          입모아
        </div>
        <div style={{ color: "#6d707a", marginTop: 8 }}>
          보호자 계정으로 시작합니다
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <button
        onClick={onGoogle}
        style={{
          background: "#2A52BE",
          color: "#fff",
          border: "none",
          borderRadius: 10,
          padding: 16,
          fontSize: 16,
          fontWeight: 700,
        }}
      >
        Google로 계속하기
      </button>
      <a
        href="/api/demo/start"
        style={{
          display: "block",
          textAlign: "center",
          padding: 14,
          borderRadius: 10,
          border: "1px solid rgba(42,82,190,0.35)",
          background: "rgba(42,82,190,0.06)",
          color: "#2A52BE",
          fontSize: 15,
          fontWeight: 700,
          textDecoration: "none",
        }}
      >
        로그인 없이 데모 체험
      </a>
      {msg && (
        <div
          style={{
            background: "#fafafa",
            border: "1px solid rgba(21,22,26,0.09)",
            borderRadius: 10,
            padding: 12,
            fontSize: 13.5,
            color: "#5c5f67",
          }}
        >
          {msg}
        </div>
      )}
      <div style={{ textAlign: "center", color: "#6d707a", fontSize: 12.5 }}>
        병상 태블릿은 한 번 로그인하면 유지됩니다.
      </div>
    </main>
  );
}
