"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// 목소리 설정(와이어프레임 s26·s12). 프리셋 6개 중 선택.
// 무료 플랜이라 가족 음성 녹음·클로닝은 두지 않는다(C 안내). 프리셋 선택만.
interface Preset {
  key: string;
  label: string;
  gender: string;
  age_band: string;
  preview_url: string;
}

export default function VoicePage() {
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("subject");
    setSubjectId(id);
    fetch("/api/voice-presets")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setPresets(d.presets ?? []))
      .catch(() => setStatus("목소리 목록을 불러오지 못했습니다."));
  }, []);

  const preview = (url: string) => {
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = url;
    void audioRef.current.play().catch(() => setStatus("미리듣기를 재생하지 못했습니다."));
  };

  const save = async () => {
    if (!subjectId || !selected) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/subjects/${subjectId}/voice-preset`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset_key: selected }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("저장했습니다. 대상자 태블릿에서 새 목소리로 바뀝니다.");
    } catch {
      setStatus("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  if (!subjectId) {
    return (
      <main style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <Link href="/home" style={{ color: "#6d707a", fontSize: 13 }}>← 홈</Link>
        <h1 style={{ font: "700 20px/1.2 Pretendard", margin: 0 }}>목소리 설정</h1>
        <p style={{ color: "#5c5f67", fontSize: 14 }}>
          홈에서 대상자를 고른 뒤 &quot;목소리 설정&quot;으로 들어와 주세요.
        </p>
      </main>
    );
  }

  return (
    <main style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      <Link href="/home" style={{ color: "#6d707a", fontSize: 13 }}>← 홈</Link>
      <h1 style={{ font: "700 20px/1.2 Pretendard", margin: 0 }}>목소리 고르기</h1>
      <p style={{ color: "#5c5f67", fontSize: 13.5, margin: 0 }}>
        듣고 고릅니다. 나중에 바꿀 수 있습니다.
      </p>

      {presets.map((p) => {
        const on = selected === p.key;
        return (
          <div
            key={p.key}
            onClick={() => setSelected(p.key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              border: `1px solid ${on ? "rgba(42,82,190,0.45)" : "rgba(21,22,26,0.13)"}`,
              background: on ? "rgba(42,82,190,0.06)" : "#fff",
              borderRadius: 10,
              padding: 12,
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                border: `${on ? 1.5 : 1}px solid ${on ? "#2A52BE" : "rgba(21,22,26,0.28)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {on && (
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#2A52BE" }} />
              )}
            </span>
            <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{p.label}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                preview(p.preview_url);
              }}
              style={{
                border: "1px solid rgba(42,82,190,0.35)",
                background: "rgba(42,82,190,0.06)",
                color: "#2A52BE",
                borderRadius: 6,
                padding: "5px 10px",
                fontSize: 12.5,
              }}
            >
              듣기
            </button>
          </div>
        );
      })}

      <button
        onClick={save}
        disabled={!selected || saving}
        style={{
          background: selected ? "#2A52BE" : "#fafafa",
          color: selected ? "#fff" : "rgba(21,22,26,0.3)",
          border: "none",
          borderRadius: 10,
          padding: 15,
          fontWeight: 700,
          fontSize: 15,
          marginTop: 4,
        }}
      >
        {saving ? "저장 중…" : "선택 완료"}
      </button>

      {status && (
        <div
          style={{
            background: "#fafafa",
            border: "1px solid rgba(21,22,26,0.09)",
            borderRadius: 10,
            padding: 12,
            fontSize: 13,
            color: "#5c5f67",
          }}
        >
          {status}
        </div>
      )}

      <p style={{ color: "#9a9ca3", fontSize: 11.5, marginTop: 8, textAlign: "center" }}>
        Voice by ElevenLabs
      </p>
    </main>
  );
}
