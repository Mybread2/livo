"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 동의 철회·대상자 삭제는 DB 직접이 아니라 서버 API로만(목소리 파기 동반, C 담당).
export function RevokeButton({ consentId }: { consentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const revoke = async () => {
    if (!confirm("이 동의를 철회하면 관련 원본·좌표·영상이 파기됩니다. 진행할까요?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/consents/${consentId}/revoke`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      alert("철회하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={revoke}
      disabled={busy}
      style={{
        fontSize: 12.5,
        color: "#7a2020",
        border: "1px solid rgba(122,32,32,0.3)",
        background: "#fff",
        borderRadius: 6,
        padding: "5px 10px",
      }}
    >
      {busy ? "처리 중…" : "철회"}
    </button>
  );
}

export function DeleteSubjectButton({ subjectId }: { subjectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!confirm("대상자를 삭제하면 목소리·오디오·동의 기록이 모두 파기됩니다. 되돌릴 수 없습니다. 삭제할까요?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/subjects/${subjectId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      router.push("/home");
    } catch {
      alert("삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setBusy(false);
    }
  };

  return (
    <button
      onClick={remove}
      disabled={busy}
      style={{
        background: "#fff",
        color: "#7a2020",
        border: "1px solid rgba(122,32,32,0.35)",
        borderRadius: 10,
        padding: 14,
        fontWeight: 700,
        fontSize: 14,
      }}
    >
      {busy ? "삭제 중…" : "대상자 삭제"}
    </button>
  );
}
