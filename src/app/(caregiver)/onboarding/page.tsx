"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ConsentKind } from "@/services/consent-store";
import { submitConsents } from "./actions";

// 온보딩(와이어프레임 s05~s15). 보호자가 대상자별로 1회 진행.
// 순서: 시작 → 동의 → 카메라 거치 → 목소리 → 캘리브레이션 안내 → 완료.
type Step = "intro" | "consent" | "camera" | "voice" | "calibration" | "done";
const STEPS: Step[] = ["intro", "consent", "camera", "voice", "calibration", "done"];

const card: React.CSSProperties = {
  border: "1px solid rgba(21,22,26,0.13)",
  borderRadius: 10,
  padding: 12,
};
const primary: React.CSSProperties = {
  background: "#2A52BE",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: 15,
  fontWeight: 700,
  fontSize: 15,
};

export default function OnboardingPage() {
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("intro");

  useEffect(() => {
    setSubjectId(new URLSearchParams(window.location.search).get("subject"));
  }, []);

  if (subjectId === null) {
    return (
      <Frame>
        <p style={{ color: "#5c5f67", fontSize: 14 }}>
          홈에서 대상자를 고른 뒤 온보딩을 시작해 주세요.
        </p>
        <Link href="/home" style={{ color: "#2A52BE" }}>← 홈</Link>
      </Frame>
    );
  }

  const idx = STEPS.indexOf(step);
  const go = (s: Step) => setStep(s);

  return (
    <Frame>
      <Progress idx={idx} />
      {step === "intro" && <Intro onNext={() => go("consent")} />}
      {step === "consent" && (
        <ConsentStep subjectId={subjectId} onNext={() => go("camera")} />
      )}
      {step === "camera" && <CameraStep onNext={() => go("voice")} />}
      {step === "voice" && (
        <VoiceStep subjectId={subjectId} onNext={() => go("calibration")} />
      )}
      {step === "calibration" && (
        <CalibrationStep subjectId={subjectId} onNext={() => go("done")} />
      )}
      {step === "done" && <Done />}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ font: "800 18px/1 Pretendard", color: "#2A52BE" }}>입모아</span>
        <span style={{ flex: 1 }} />
        <Link href="/home" style={{ color: "#6d707a", fontSize: 13 }}>나가기</Link>
      </div>
      {children}
    </main>
  );
}

function Progress({ idx }: { idx: number }) {
  const total = STEPS.length - 1; // done 제외
  const pct = Math.min(100, Math.round((idx / total) * 100));
  return (
    <div style={{ height: 6, borderRadius: 3, background: "rgba(21,22,26,0.09)" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: "#2A52BE", borderRadius: 3 }} />
    </div>
  );
}

function Intro({ onNext }: { onNext: () => void }) {
  const steps = ["동의 확인", "카메라 거치", "목소리 고르기", "따라하기 안내"];
  return (
    <>
      <h1 style={{ font: "700 20px/1.3 Pretendard", margin: 0 }}>네 단계를 지납니다</h1>
      {steps.map((t, i) => (
        <div key={t} style={{ ...card, display: "flex", gap: 10, alignItems: "center" }}>
          <span
            style={{
              width: 22, height: 22, borderRadius: 6, flex: "none",
              background: i === 0 ? "#2A52BE" : "rgba(21,22,26,0.06)",
              color: i === 0 ? "#fff" : "#6d707a",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700,
            }}
          >
            {i + 1}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t}</span>
        </div>
      ))}
      <div style={{ color: "#6d707a", fontSize: 13 }}>중간에 멈추어도 이어서 할 수 있습니다.</div>
      <button style={primary} onClick={onNext}>시작하기</button>
    </>
  );
}

const CONSENT_ITEMS: { kind: ConsentKind; label: string; required: boolean }[] = [
  { kind: "biometric", label: "생체정보(입술 좌표) 수집", required: true },
  { kind: "voice_self", label: "음성 사용", required: true },
  { kind: "overseas_transfer", label: "음성 국외이전", required: false },
];

function ConsentStep({ subjectId, onNext }: { subjectId: string; onNext: () => void }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({
    biometric: false,
    voice_self: false,
    overseas_transfer: false,
  });
  const [legalGuardian, setLegalGuardian] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const requiredOk = CONSENT_ITEMS.filter((i) => i.required).every((i) => checked[i.kind]);

  const submit = async () => {
    setSaving(true);
    setMsg(null);
    const granted = CONSENT_ITEMS.filter((i) => checked[i.kind]).map((i) => i.kind);
    const res = await submitConsents(subjectId, granted, legalGuardian);
    setSaving(false);
    if (res.ok) onNext();
    else if (res.error === "missing_required") setMsg("필수 동의를 모두 체크해 주세요.");
    else setMsg("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  };

  return (
    <>
      <h1 style={{ font: "700 20px/1.3 Pretendard", margin: 0 }}>동의 수집</h1>
      <div style={{ fontSize: 13, fontWeight: 600 }}>필수</div>
      {CONSENT_ITEMS.filter((i) => i.required).map((i) => (
        <Check key={i.kind} label={i.label} on={checked[i.kind]}
          onToggle={() => setChecked((c) => ({ ...c, [i.kind]: !c[i.kind] }))} />
      ))}
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>선택</div>
      {CONSENT_ITEMS.filter((i) => !i.required).map((i) => (
        <Check key={i.kind} label={i.label} on={checked[i.kind]}
          onToggle={() => setChecked((c) => ({ ...c, [i.kind]: !c[i.kind] }))} />
      ))}
      <Check label="대상자가 직접 동의하기 어려워 법정대리인이 대신 동의합니다"
        on={legalGuardian} onToggle={() => setLegalGuardian((v) => !v)} />
      <div style={{ ...card, background: "#fafafa", fontSize: 12.5, color: "#5c5f67" }}>
        철회하면 원본과 추출 좌표·영상은 파기됩니다. 이미 학습이 끝난 모델은 제외되며, 이후 학습에는 쓰지 않습니다.
      </div>
      {msg && <div style={{ color: "#7a2020", fontSize: 13 }}>{msg}</div>}
      <button
        style={{ ...primary, ...(requiredOk ? {} : { background: "#fafafa", color: "rgba(21,22,26,0.3)" }) }}
        disabled={!requiredOk || saving}
        onClick={submit}
      >
        {saving ? "저장 중…" : "다음"}
      </button>
    </>
  );
}

function Check({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <div onClick={onToggle}
      style={{
        ...card, display: "flex", gap: 10, alignItems: "center", cursor: "pointer",
        borderColor: on ? "rgba(42,82,190,0.45)" : "rgba(21,22,26,0.13)",
        background: on ? "rgba(42,82,190,0.06)" : "#fff",
      }}>
      <span style={{
        width: 18, height: 18, borderRadius: 5, flex: "none",
        border: `1px solid ${on ? "#2A52BE" : "rgba(21,22,26,0.28)"}`,
        background: on ? "#2A52BE" : "#fff", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11,
      }}>{on ? "✓" : ""}</span>
      <span style={{ fontSize: 13.5 }}>{label}</span>
    </div>
  );
}

function CameraStep({ onNext }: { onNext: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play().catch(() => {});
        }
        setOk(true);
      })
      .catch(() => setErr("카메라를 켤 수 없습니다. 브라우저 권한을 허용해 주세요."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  return (
    <>
      <h1 style={{ font: "700 20px/1.3 Pretendard", margin: 0 }}>카메라 거치</h1>
      <p style={{ color: "#5c5f67", fontSize: 13.5, margin: 0 }}>
        얼굴보다 낮게, 올려다보는 각도로 두고 밝은 쪽을 보게 합니다. 영상은 저장되지 않습니다.
      </p>
      <video ref={videoRef} muted playsInline
        style={{ width: "100%", borderRadius: 12, background: "#000", aspectRatio: "4/3", objectFit: "cover" }} />
      {err && <div style={{ color: "#7a2020", fontSize: 13 }}>{err}</div>}
      <button style={{ ...primary, ...(ok ? {} : { background: "#fafafa", color: "rgba(21,22,26,0.3)" }) }}
        disabled={!ok} onClick={onNext}>다음</button>
    </>
  );
}

function VoiceStep({ subjectId, onNext }: { subjectId: string; onNext: () => void }) {
  return (
    <>
      <h1 style={{ font: "700 20px/1.3 Pretendard", margin: 0 }}>목소리 고르기</h1>
      <p style={{ color: "#5c5f67", fontSize: 13.5, margin: 0 }}>
        6개 목소리 중 하나를 고릅니다. 등록 문장이 그 목소리로 미리 합성됩니다.
      </p>
      <Link href={`/voice?subject=${subjectId}`} style={{ ...primary, textAlign: "center", textDecoration: "none", display: "block" }}>
        목소리 선택 화면 열기
      </Link>
      <button
        style={{ background: "#fff", border: "1px solid rgba(21,22,26,0.2)", borderRadius: 10, padding: 14, fontWeight: 700 }}
        onClick={onNext}
      >
        목소리를 골랐습니다 · 다음
      </button>
    </>
  );
}

function CalibrationStep({ subjectId, onNext }: { subjectId: string; onNext: () => void }) {
  return (
    <>
      <h1 style={{ font: "700 20px/1.3 Pretendard", margin: 0 }}>따라하기 (캘리브레이션)</h1>
      <p style={{ color: "#5c5f67", fontSize: 13.5, margin: 0 }}>
        대상자 태블릿에서 문장이 뜨면 소리 없이 입모양만 따라 합니다. 다음 문장은 자동으로 넘어갑니다(손 사용 없음).
      </p>
      <Link href={`/subject?subject=${subjectId}`} style={{ ...primary, textAlign: "center", textDecoration: "none", display: "block" }}>
        대상자 화면 열기
      </Link>
      <button
        style={{ background: "#fff", border: "1px solid rgba(21,22,26,0.2)", borderRadius: 10, padding: 14, fontWeight: 700 }}
        onClick={onNext}
      >
        완료로 이동
      </button>
    </>
  );
}

function Done() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "20px 0" }}>
      <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#2A52BE", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700 }}>✓</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>준비되었습니다</div>
      <p style={{ color: "#5c5f67", fontSize: 13.5, textAlign: "center", margin: 0 }}>
        응급 문장 4개를 지금부터 쓸 수 있습니다. 태블릿은 병상 옆에 두고 화면을 켠 채로 둡니다.
      </p>
      <Link href="/home" style={{ ...primary, textDecoration: "none", alignSelf: "stretch", textAlign: "center" }}>
        홈으로
      </Link>
    </div>
  );
}
