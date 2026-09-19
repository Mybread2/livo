"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getPhrase, STARTER_PHRASE_IDS } from "@/lib/phrases";
import { clearTemplates, encodeTemplates, loadTemplates, saveTemplates } from "@/offline/templateStore";
import { buildTemplateSet, leaveOneOut, segmentsFromFrames, type LabeledSequence } from "@/recognition/analysis";
import type { TemplateSet } from "@/recognition/dtw";
import { decideGate } from "@/recognition/gate";
import { createLipLandmarker, type LipLandmarker } from "@/recognition/landmarker";
import { RecognitionPipeline } from "@/recognition/pipeline";
import type { Sequence } from "@/recognition/types";
import type { RecognitionEvent } from "@/types/recognition";
import { DEFAULT_FPS, extractFrames, scanVideo } from "./extractFrames";

// 입술 좌표 수집(개발·데모용). 녹화 영상 → MediaPipe 입술 좌표 → 구간 → 템플릿 → 하나씩 빼고 맞히기 → 기기 저장·JSON 내려받기.
// 영상은 이 브라우저 안에서만 처리한다 — 업로드·서버 전송 없음. 운영 빌드에서는 (dev)/layout이 404를 낸다.
// 개발자용 화면이라 버튼을 쓴다(대상자 화면의 "손 없이 완결" 규칙 대상이 아니다).

type StarterId = (typeof STARTER_PHRASE_IDS)[number];

type ModelState = { status: "loading" } | { status: "ready" } | { status: "error"; message: string };

interface ClipSegment {
  seq: Sequence;
  lengthMs: number;
}

type ClipResult =
  | { kind: "skipped"; file: string; name: string }
  | { kind: "error"; file: string; name: StarterId; message: string }
  | {
      kind: "done";
      file: string;
      name: StarterId;
      durationMs: number;
      totalFrames: number;
      faceFrames: number;
      segments: ClipSegment[];
    };

interface Progress {
  file: string;
  index: number;
  count: number;
  ratio: number;
}

type TrialEvent = RecognitionEvent & { t: number };

interface TrialState {
  file: string;
  events: TrialEvent[];
  message: string | null;
}

export default function DevLipsPage() {
  const landmarkerRef = useRef<LipLandmarker | null>(null);
  const [model, setModel] = useState<ModelState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [clips, setClips] = useState<ClipResult[]>([]);
  const [storeStatus, setStoreStatus] = useState("");
  const [trial, setTrial] = useState<TrialState | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: LipLandmarker | null = null;
    createLipLandmarker().then(
      (landmarker) => {
        // 개발 모드(StrictMode)는 effect를 두 번 돈다 — 이미 정리된 effect가 만든 모델은 바로 닫는다
        if (cancelled) {
          landmarker.close();
          return;
        }
        created = landmarker;
        landmarkerRef.current = landmarker;
        setModel({ status: "ready" });
      },
      (error: unknown) => {
        if (!cancelled) setModel({ status: "error", message: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
      created?.close();
      landmarkerRef.current = null;
    };
  }, []);

  // 처리된 영상의 구간 전부 = 템플릿 후보 표본 (파일 순서 → 구간 순서)
  const samples = useMemo<LabeledSequence[]>(
    () => clips.flatMap((clip) => (clip.kind === "done" ? clip.segments.map(({ seq }) => ({ phraseId: clip.name, seq })) : [])),
    [clips],
  );

  const looRows = useMemo(() => {
    const labels = sampleLabels(samples);
    return leaveOneOut(samples).map((row) => ({
      ...row,
      label: labels[row.index],
      correct: row.predicted === row.phraseId,
      gate: decideGate({ score: row.score, rejected: row.rejected }),
    }));
  }, [samples]);

  const looSummary = useMemo(() => {
    const correct = looRows.filter((row) => row.correct).length;
    // 틀린 예측이 게이트를 통과한 것 — 실제로는 잘못된 문장이 화면에 뜨거나(show) 소리로 나간다(speak)
    const wrongShow = looRows.filter((row) => !row.correct && row.gate === "show").length;
    const wrongSpeak = looRows.filter((row) => !row.correct && row.gate === "speak").length;
    return { correct, total: looRows.length, wrongShow, wrongSpeak };
  }, [looRows]);

  const ready = model.status === "ready";

  async function collect(files: File[]) {
    const landmarker = landmarkerRef.current;
    if (landmarker === null || files.length === 0) return;
    setBusy(true);
    setClips([]);
    const results: ClipResult[] = [];
    try {
      // 한 파일씩 순서대로 — 같은 landmarker(MediaPipe VIDEO 모드)를 동시에 두 영상에 쓰지 않는다
      for (const [index, file] of files.entries()) {
        const name = baseName(file.name);
        if (!isStarterId(name)) {
          results.push({ kind: "skipped", file: file.name, name });
        } else {
          try {
            const extract = await extractFrames(file, landmarker, DEFAULT_FPS, (ratio) =>
              setProgress({ file: file.name, index, count: files.length, ratio }),
            );
            const segments = segmentsFromFrames(extract.frames).map(({ frames, seq }) => ({
              seq,
              lengthMs: frames[frames.length - 1].t - frames[0].t,
            }));
            results.push({
              kind: "done",
              file: file.name,
              name,
              durationMs: extract.durationMs,
              totalFrames: extract.totalFrames,
              faceFrames: extract.faceFrames,
              segments,
            });
          } catch (error) {
            results.push({ kind: "error", file: file.name, name, message: errorMessage(error) });
          }
        }
        // 파일 하나가 끝날 때마다 표를 갱신한다
        setClips([...results]);
      }
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  async function runStoreAction(action: () => Promise<string>) {
    setBusy(true);
    try {
      setStoreStatus(await action());
    } catch (error) {
      setStoreStatus(`실패: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const saveToDevice = () =>
    runStoreAction(async () => {
      const set = buildTemplateSet(samples);
      await saveTemplates(set);
      return `기기에 저장했습니다 — ${describeSet(set)}`;
    });

  const viewStored = () =>
    runStoreAction(async () => {
      const set = await loadTemplates();
      return set === null ? "기기에 저장된 템플릿이 없습니다" : `기기 저장본 — ${describeSet(set)}`;
    });

  const clearStored = () =>
    runStoreAction(async () => {
      await clearTemplates();
      return "기기 저장본을 지웠습니다";
    });

  function downloadJson() {
    const set = buildTemplateSet(samples);
    const fileName = `templates-${localDate(new Date())}.json`;
    // 내려받기는 이 기기의 파일로 저장될 뿐 어디에도 전송되지 않는다
    const url = URL.createObjectURL(new Blob([JSON.stringify(encodeTemplates(set))], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    // click 직후 바로 해제하면 일부 브라우저에서 내려받기가 끊긴다 — 조금 뒤에 푼다
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStoreStatus(`내려받았습니다 — ${fileName} (${describeSet(set)})`);
  }

  async function runTrial(file: File) {
    const landmarker = landmarkerRef.current;
    if (landmarker === null) return;
    setBusy(true);
    setTrial(null);
    try {
      const templates = await loadTemplates();
      if (templates === null) {
        setTrial({
          file: file.name,
          events: [],
          message: "기기에 저장된 템플릿이 없습니다. 위에서 영상을 처리하고 「기기에 템플릿 저장」을 먼저 누르세요.",
        });
        return;
      }
      const pipeline = new RecognitionPipeline({ templates });
      const events: TrialEvent[] = [];
      // 실시간과 같은 입력을 넣는다 — 얼굴이 없는 프레임은 null(진행 중 구간을 버림)
      await scanVideo(
        file,
        landmarker,
        DEFAULT_FPS,
        ({ landmarks, width, height, t }) => {
          const event = pipeline.push(landmarks, width, height, t);
          if (event !== null) events.push({ t, ...event });
        },
        (ratio) => setProgress({ file: file.name, index: 0, count: 1, ratio }),
      );
      setTrial({ file: file.name, events, message: events.length === 0 ? "나온 이벤트가 없습니다" : null });
    } catch (error) {
      setTrial({ file: file.name, events: [], message: `시험하지 못했습니다: ${errorMessage(error)}` });
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: 20, maxWidth: 1100, display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={{ font: "700 20px/1.2 Pretendard", margin: 0 }}>입술 좌표 수집 (개발용)</h1>
        <p style={{ margin: 0, fontWeight: 600 }}>영상은 이 브라우저 안에서만 처리되고 어디에도 올라가지 않습니다.</p>
        <p style={{ ...muted, margin: 0 }}>
          파일 이름 규칙: {"<문장 id>.mp4"} — 한 파일에 그 문장을 여러 번, 사이마다 입을 0.5초 넘게 멈추고 말한 영상.
          쓸 수 있는 id: {STARTER_PHRASE_IDS.map((id) => `${id}(${getPhrase(id)?.text ?? "?"})`).join(" · ")}
        </p>
        <p data-testid="model-status" style={{ margin: 0, fontSize: 14, color: model.status === "error" ? ERROR_COLOR : undefined }}>
          {model.status === "loading" && "모델 불러오는 중…"}
          {model.status === "ready" && "모델 준비됨 (MediaPipe Face Landmarker)"}
          {model.status === "error" && `모델을 불러오지 못했습니다: ${model.message}`}
        </p>
      </div>

      <section style={section}>
        <h2 style={h2}>1. 영상 처리</h2>
        <input
          type="file"
          accept="video/*"
          multiple
          disabled={!ready || busy}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            // 같은 파일을 다시 골라도 onChange가 오도록 비운다
            event.target.value = "";
            void collect(files);
          }}
        />
        {progress && (
          <div style={{ ...muted, display: "flex", alignItems: "center", gap: 8 }}>
            <span>
              처리 중: {progress.file} ({progress.index + 1}/{progress.count}) {Math.round(progress.ratio * 100)}%
            </span>
            <progress value={progress.ratio} max={1} />
          </div>
        )}
        {clips.length === 0 ? (
          <p style={{ ...muted, margin: 0 }}>영상을 고르면 여기에 결과가 나옵니다.</p>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                {["파일", "문장", "길이(초)", "전체 프레임", "얼굴 프레임", "구간 수", "구간 길이(ms)"].map((label) => (
                  <th key={label} style={th}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clips.map((clip, k) => (
                <tr key={`${clip.file}-${k}`} data-testid={`clip-${clip.name}`}>
                  <td style={td}>{clip.file}</td>
                  {clip.kind === "skipped" && (
                    <td style={{ ...td, ...muted }} colSpan={6}>
                      건너뜀 — 파일 이름이 시작 단어 id가 아닙니다
                    </td>
                  )}
                  {clip.kind === "error" && (
                    <>
                      <td style={td}>{getPhrase(clip.name)?.text}</td>
                      <td style={{ ...td, color: ERROR_COLOR }} colSpan={5}>
                        실패: {clip.message}
                      </td>
                    </>
                  )}
                  {clip.kind === "done" && (
                    <>
                      <td style={td}>{getPhrase(clip.name)?.text}</td>
                      <td style={td}>{(clip.durationMs / 1000).toFixed(2)}</td>
                      <td style={td}>{clip.totalFrames}</td>
                      <td style={td}>{clip.faceFrames}</td>
                      <td style={td} data-testid={`segments-${clip.name}`}>
                        {clip.segments.length}
                      </td>
                      <td style={td}>{clip.segments.map((s) => Math.round(s.lengthMs)).join(", ") || "–"}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={section}>
        <h2 style={h2}>2. 하나씩 빼고 맞히기</h2>
        <p style={{ ...muted, margin: 0 }}>
          표본 하나를 빼고 나머지로 템플릿을 만들어 그 표본을 맞힙니다. 게이트는 기본 모드(발화 0.90 · 표시 0.70) 기준입니다.
        </p>
        <p data-testid="loo-summary" style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          {looSummary.total === 0
            ? "표본 없음 — 영상을 먼저 처리하세요"
            : `맞음 ${looSummary.correct}/${looSummary.total} · 잘못 나간 표시 ${looSummary.wrongShow} · 잘못 나간 발화 ${looSummary.wrongSpeak}`}
        </p>
        {looRows.length > 0 && (
          <table style={table}>
            <thead>
              <tr>
                {["표본", "정답", "예측", "d1", "d2", "d1/d2", "score", "게이트"].map((label) => (
                  <th key={label} style={th}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {looRows.map((row) => (
                <tr key={row.index} style={row.correct ? undefined : { background: WRONG_BACKGROUND }}>
                  <td style={td}>{row.label}</td>
                  <td style={td}>{row.phraseId}</td>
                  <td style={td}>{row.predicted ?? "없음"}</td>
                  <td style={td}>{fixed(row.d1)}</td>
                  <td style={td}>{fixed(row.d2)}</td>
                  <td style={td}>{ratio(row.d1, row.d2)}</td>
                  <td style={td}>{fixed(row.score)}</td>
                  <td style={{ ...td, color: !row.correct && row.gate !== "discard" ? ERROR_COLOR : undefined }}>{row.gate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={section}>
        <h2 style={h2}>3. 템플릿</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <ActionButton onClick={saveToDevice} disabled={busy || samples.length === 0}>
            기기에 템플릿 저장
          </ActionButton>
          <ActionButton onClick={downloadJson} disabled={busy || samples.length === 0}>
            템플릿 JSON 내려받기
          </ActionButton>
          <ActionButton onClick={viewStored} disabled={busy}>
            저장된 템플릿 보기
          </ActionButton>
          <ActionButton onClick={clearStored} disabled={busy}>
            저장된 템플릿 지우기
          </ActionButton>
        </div>
        <p data-testid="store-status" style={{ margin: 0, fontSize: 14, minHeight: 20 }}>
          {storeStatus}
        </p>
      </section>

      <section style={section}>
        <h2 style={h2}>4. 영상으로 인식 시험</h2>
        <p style={{ ...muted, margin: 0 }}>
          기기에 저장된 템플릿으로 영상 하나를 인식 파이프라인에 프레임 순서대로 넣고, 나온 이벤트를 보여 줍니다.
        </p>
        <input
          type="file"
          accept="video/*"
          disabled={!ready || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void runTrial(file);
          }}
        />
        {trial && (
          <div data-testid="trial-events" style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
            <span style={muted}>
              {trial.file} — 이벤트 {trial.events.length}개
            </span>
            {trial.message !== null && <span>{trial.message}</span>}
            {trial.events.length > 0 && (
              <ol style={{ margin: 0, paddingLeft: 22, fontVariantNumeric: "tabular-nums" }}>
                {trial.events.map((event, k) => (
                  <li key={k}>
                    {(event.t / 1000).toFixed(2)}초 · {event.phraseId} · {event.text} · score {event.score.toFixed(3)} · {event.gate}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function ActionButton({ onClick, disabled, children }: { onClick: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ ...button, opacity: disabled ? 0.45 : 1, cursor: disabled ? "default" : "pointer" }}
    >
      {children}
    </button>
  );
}

function isStarterId(value: string): value is StarterId {
  return (STARTER_PHRASE_IDS as readonly string[]).includes(value);
}

/** "Yes.MP4" → "yes" (마지막 점 앞, 소문자). */
function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return (dot > 0 ? fileName.slice(0, dot) : fileName).toLowerCase();
}

/** 표본 표시 이름: 문장 id별 순번 ("yes #1", "yes #2", …). */
function sampleLabels(samples: readonly LabeledSequence[]): string[] {
  const counts = new Map<string, number>();
  return samples.map(({ phraseId }) => {
    const n = (counts.get(phraseId) ?? 0) + 1;
    counts.set(phraseId, n);
    return `${phraseId} #${n}`;
  });
}

/** "yes(네) 3개 · no(아니요) 3개" */
function describeSet(set: TemplateSet): string {
  return Object.entries(set)
    .map(([id, seqs]) => `${id}(${getPhrase(id)?.text ?? "?"}) ${seqs.length}개`)
    .join(" · ");
}

function fixed(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "–";
}

/** d1/d2. 비교할 둘째 문장이 없거나(d2 = ∞) 둘 다 0이면 비율이 뜻이 없다 — "–". */
function ratio(d1: number, d2: number): string {
  return Number.isFinite(d1) && Number.isFinite(d2) && d2 > 0 ? fixed(d1 / d2) : "–";
}

function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const ERROR_COLOR = "#b3261e";
const WRONG_BACKGROUND = "rgba(179,38,30,0.07)";

const muted: React.CSSProperties = { color: "#6d707a", fontSize: 13 };
const section: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
const h2: React.CSSProperties = { font: "700 16px/1.3 Pretendard", margin: 0 };
const table: React.CSSProperties = { borderCollapse: "collapse", fontSize: 13, background: "#fff", alignSelf: "flex-start" };
const th: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 10px",
  borderBottom: "1px solid rgba(21,22,26,0.2)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "6px 10px",
  borderBottom: "1px solid rgba(21,22,26,0.08)",
  fontVariantNumeric: "tabular-nums",
};
const button: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 14,
  border: "1px solid rgba(21,22,26,0.25)",
  borderRadius: 6,
  background: "#fff",
  color: "#15161a",
};
