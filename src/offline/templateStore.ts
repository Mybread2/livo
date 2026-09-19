import { isPhraseId } from "@/lib/phrases";
import type { TemplateSet } from "@/recognition/dtw";
import { FEATURE_DIM, SEQ_FRAMES, type Sequence } from "@/recognition/types";

// 대상자 본인 입모양으로 만든 DTW 템플릿(C4)을 기기(IndexedDB)에 두고 JSON으로 옮기는 모듈.
// 템플릿은 생체정보 성격이라 서버로 보내지 않는다 — 이 파일은 네트워크를 쓰지 않는다.
// 근거: docs/ARCHITECTURE.md 상태 관리 "오프라인 자산은 단말 저장소" · CLAUDE.md 데이터 반출 금지.

/** JSON으로 옮길 수 있는 템플릿 파일 형식. */
export interface TemplateFile {
  version: 1;
  createdAt: string; // ISO 시각
  seqFrames: number; // SEQ_FRAMES (32)
  featureDim: number; // FEATURE_DIM (80)
  templates: Record<string, number[][][]>; // 문장 id → 템플릿들 → 32행 → 80값
}

export class TemplateFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateFormatError";
  }
}

const DB_NAME = "ipmoa-recognition";
const DB_VERSION = 1;
const STORE_NAME = "templates";
const CURRENT_KEY = "current";

/** TemplateSet → TemplateFile. 빈 템플릿 배열인 문장은 뺀다. */
export function encodeTemplates(set: TemplateSet, now: Date = new Date()): TemplateFile {
  const templates: Record<string, number[][][]> = {};
  for (const [id, seqs] of Object.entries(set)) {
    if (seqs.length === 0) continue;
    // Float32Array는 JSON에서 {"0": …} 객체가 되므로 일반 배열로 옮긴다
    templates[id] = seqs.map((seq) => seq.map((row) => Array.from(row)));
  }
  return { version: 1, createdAt: now.toISOString(), seqFrames: SEQ_FRAMES, featureDim: FEATURE_DIM, templates };
}

/**
 * 모르는 값(JSON.parse 결과 등) → TemplateSet. 형식이 틀리면 TemplateFormatError.
 * 검사: version === 1 · seqFrames/featureDim이 현재 상수와 같음 · 문장 id가 isPhraseId · 템플릿마다 행 SEQ_FRAMES개 × 값 FEATURE_DIM개 · 모든 값이 유한수.
 * 템플릿이 하나도 없는 파일도 오류다.
 */
export function decodeTemplates(file: unknown): TemplateSet {
  if (!isPlainRecord(file)) throw new TemplateFormatError("템플릿 파일이 객체가 아니다");
  if (file.version !== 1) throw new TemplateFormatError(`모르는 형식 버전: ${String(file.version)}`);
  if (file.seqFrames !== SEQ_FRAMES) {
    throw new TemplateFormatError(`seqFrames가 ${SEQ_FRAMES}이 아니다: ${String(file.seqFrames)}`);
  }
  if (file.featureDim !== FEATURE_DIM) {
    throw new TemplateFormatError(`featureDim이 ${FEATURE_DIM}이 아니다: ${String(file.featureDim)}`);
  }
  if (!isPlainRecord(file.templates)) throw new TemplateFormatError("templates가 객체가 아니다");

  // 키 순서를 그대로 둔다 — nearestPhrases의 동점 처리 순서다
  const set: Record<string, Sequence[]> = {};
  let count = 0;
  for (const [id, seqs] of Object.entries(file.templates)) {
    if (!isPhraseId(id)) throw new TemplateFormatError(`모르는 문장 id: ${id}`);
    if (!Array.isArray(seqs)) throw new TemplateFormatError(`templates.${id}가 배열이 아니다`);
    // encode처럼 빈 문장은 뺀다
    if (seqs.length === 0) continue;
    const decoded: Sequence[] = [];
    // map·forEach는 희소 배열의 빈 칸을 건너뛰므로 인덱스로 돈다
    for (let k = 0; k < seqs.length; k++) decoded.push(decodeSequence(seqs[k], `templates.${id}[${k}]`));
    set[id] = decoded;
    count += decoded.length;
  }
  if (count === 0) throw new TemplateFormatError("템플릿이 하나도 없다");
  return set;
}

function decodeSequence(value: unknown, path: string): Sequence {
  if (!Array.isArray(value)) throw new TemplateFormatError(`${path}가 배열이 아니다`);
  if (value.length !== SEQ_FRAMES) {
    throw new TemplateFormatError(`${path}의 행이 ${SEQ_FRAMES}개가 아니다: ${value.length}`);
  }
  const seq: Sequence = [];
  for (let j = 0; j < SEQ_FRAMES; j++) {
    const row: unknown = value[j];
    if (!Array.isArray(row)) throw new TemplateFormatError(`${path}[${j}]가 배열이 아니다`);
    if (row.length !== FEATURE_DIM) {
      throw new TemplateFormatError(`${path}[${j}]의 값이 ${FEATURE_DIM}개가 아니다: ${row.length}`);
    }
    const out = new Float32Array(FEATURE_DIM);
    for (let i = 0; i < FEATURE_DIM; i++) {
      const v: unknown = row[i];
      // Float32로 옮긴 값이 유한해야 한다 — float32 범위(약 3.4e38)를 넘는 유한 double은 Infinity가 되어 DTW 거리를 망친다
      if (typeof v !== "number" || !Number.isFinite(Math.fround(v))) {
        throw new TemplateFormatError(`${path}[${j}][${i}]가 유한수가 아니다: ${String(v)}`);
      }
      out[i] = v;
    }
    seq.push(out);
  }
  return seq;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 기기(IndexedDB)에 저장. 이전 것을 덮어쓴다. IndexedDB가 없는 환경(서버·Node)이면 throw. */
export async function saveTemplates(set: TemplateSet): Promise<void> {
  const file = encodeTemplates(set);
  // 쓰기 전에 되읽을 수 있는지 본다 — 못 읽을 것을 쓰면 다음 loadTemplates가 이전 저장본까지 잃은 채 null이 된다
  decodeTemplates(file);
  const factory = globalIndexedDB();
  if (!factory) throw new Error("IndexedDB가 없는 환경이라 템플릿을 저장할 수 없다");
  await runInStore(factory, "readwrite", (store) => store.put(file, CURRENT_KEY));
}

/** 기기에서 읽는다. 저장된 것이 없거나 IndexedDB가 없는 환경이면 null. 저장본이 깨졌으면 null(콘솔 경고). */
export async function loadTemplates(): Promise<TemplateSet | null> {
  const factory = globalIndexedDB();
  if (!factory) return null;
  const stored: unknown = await runInStore(factory, "readonly", (store) => store.get(CURRENT_KEY));
  if (stored === undefined) return null;
  try {
    return decodeTemplates(stored);
  } catch (error) {
    if (!(error instanceof TemplateFormatError)) throw error;
    // 깨진 템플릿으로 인식하느니 없는 것으로 본다 — 호출 측이 캘리브레이션을 다시 하게 한다
    console.warn(`기기의 템플릿 저장본이 깨져 무시한다: ${error.message}`);
    return null;
  }
}

/** 기기 저장본을 지운다. IndexedDB가 없으면 아무것도 안 한다. */
export async function clearTemplates(): Promise<void> {
  const factory = globalIndexedDB();
  if (!factory) return;
  await runInStore(factory, "readwrite", (store) => store.delete(CURRENT_KEY));
}

// lib.dom 타입은 indexedDB가 항상 있다고 하지만 서버·Node에는 없다
function globalIndexedDB(): IDBFactory | undefined {
  return (globalThis as { indexedDB?: IDBFactory }).indexedDB;
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 한 트랜잭션에서 요청 하나를 보내고, 트랜잭션이 끝난 뒤(쓰기가 확정된 뒤) 그 결과를 돌려준다. */
async function runInStore<T>(
  factory: IDBFactory,
  mode: IDBTransactionMode,
  makeRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase(factory);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = makeRequest(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? request.error);
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB 트랜잭션이 중단됐다"));
    });
  } finally {
    db.close();
  }
}
