import { describe, expect, it } from "vitest";
import type { TemplateSet } from "@/recognition/dtw";
import { FEATURE_DIM, SEQ_FRAMES, type Sequence } from "@/recognition/types";
import {
  clearTemplates,
  decodeTemplates,
  encodeTemplates,
  loadTemplates,
  saveTemplates,
  TemplateFormatError,
  type TemplateFile,
} from "./templateStore";

// ── 합성 템플릿 (실제 입술 좌표·템플릿 파일을 레포에 두지 않는다) ──

/** 행 j·열 i = sin(seed + j + i·0.1). seed마다 다른 결정적 Sequence. */
function synthetic(seed: number): Sequence {
  return Array.from({ length: SEQ_FRAMES }, (_, j) => {
    const row = new Float32Array(FEATURE_DIM);
    for (let i = 0; i < FEATURE_DIM; i++) row[i] = Math.sin(seed + j + i * 0.1);
    return row;
  });
}

const SET: TemplateSet = {
  yes: [synthetic(0), synthetic(1)],
  no: [synthetic(2)],
  pain: [synthetic(3), synthetic(4), synthetic(5)],
};

const NOW = new Date("2026-09-19T10:00:00.000Z");

/** 저장·전송을 거친 모양 그대로의 올바른 파일. 오류 테스트는 매번 새로 받아 한 곳만 망가뜨린다. */
function validFile(): TemplateFile {
  return JSON.parse(JSON.stringify(encodeTemplates(SET, NOW))) as TemplateFile;
}

describe("encodeTemplates", () => {
  it("파일 머리에 형식 버전 1과 현재 SEQ_FRAMES·FEATURE_DIM을 적는다", () => {
    const file = encodeTemplates(SET, NOW);
    expect(file.version).toBe(1);
    expect(file.seqFrames).toBe(SEQ_FRAMES);
    expect(file.featureDim).toBe(FEATURE_DIM);
  });

  it("createdAt은 주어진 시각의 ISO 문자열이다", () => {
    expect(encodeTemplates(SET, NOW).createdAt).toBe("2026-09-19T10:00:00.000Z");
  });

  it("빈 템플릿 배열인 문장은 뺀다", () => {
    const file = encodeTemplates({ yes: [], no: [synthetic(0)], water: [] }, NOW);
    expect(Object.keys(file.templates)).toEqual(["no"]);
  });

  it("행을 일반 숫자 배열로 바꾼다 (Float32Array는 JSON에서 숫자 배열이 아니라 객체가 된다)", () => {
    const file = encodeTemplates(SET, NOW);
    const row = file.templates.yes[0][0];
    expect(Array.isArray(row)).toBe(true);
    expect(row).toHaveLength(FEATURE_DIM);
    expect(row[0]).toBe(SET.yes[0][0][0]);
  });
});

describe("decodeTemplates", () => {
  it("encode → JSON 문자열 → decode 왕복이 원본과 같다", () => {
    const decoded = decodeTemplates(validFile());

    // 키 순서 = nearestPhrases의 동점 처리 순서라 순서까지 보존해야 한다
    expect(Object.keys(decoded)).toEqual(Object.keys(SET));
    for (const [id, templates] of Object.entries(SET)) {
      expect(decoded[id]).toHaveLength(templates.length);
      templates.forEach((template, k) => {
        expect(decoded[id][k]).toHaveLength(SEQ_FRAMES);
        template.forEach((row, j) => {
          expect(decoded[id][k][j]).toBeInstanceOf(Float32Array);
          // Float32 값을 double로 적고 되읽으므로 Float32 정밀도 안에서 같다
          expect(decoded[id][k][j]).toEqual(row);
        });
      });
    }
  });

  it("빈 배열인 문장은 결과에서 뺀다 (encode 결과와 같은 모양)", () => {
    const file = validFile();
    file.templates = { water: [], ...file.templates };
    expect(Object.keys(decodeTemplates(file))).toEqual(Object.keys(SET));
  });

  const broken: [string, (file: TemplateFile & Record<string, unknown>) => void][] = [
    ["version 불일치 (2)", (f) => (f.version = 2 as unknown as 1)],
    ["version이 문자열", (f) => (f.version = "1" as unknown as 1)],
    ["version 없음", (f) => delete (f as Partial<TemplateFile>).version],
    ["seqFrames 불일치", (f) => (f.seqFrames = SEQ_FRAMES - 1)],
    ["featureDim 불일치", (f) => (f.featureDim = FEATURE_DIM / 2)],
    ["모르는 문장 id", (f) => (f.templates.hello = f.templates.yes)],
    ["templates가 null", (f) => (f.templates = null as unknown as TemplateFile["templates"])],
    ["templates가 배열", (f) => (f.templates = [] as unknown as TemplateFile["templates"])],
    ["문장 값이 배열 아님", (f) => (f.templates.yes = {} as unknown as number[][][])],
    ["템플릿이 배열 아님", (f) => (f.templates.yes[0] = "x" as unknown as number[][])],
    ["행 수 부족", (f) => f.templates.yes[0].pop()],
    ["행 수 초과", (f) => f.templates.yes[0].push(f.templates.yes[0][0])],
    ["빈 행 칸(희소 배열)", (f) => delete f.templates.yes[0][3]],
    ["행이 배열 아님", (f) => (f.templates.no[0][5] = 0 as unknown as number[])],
    ["값 수 부족", (f) => f.templates.no[0][5].pop()],
    ["값 수 초과", (f) => f.templates.no[0][5].push(0)],
    ["NaN 값", (f) => (f.templates.pain[2][31][79] = Number.NaN)],
    ["Infinity 값", (f) => (f.templates.pain[2][31][79] = Number.POSITIVE_INFINITY)],
    ["-Infinity 값", (f) => (f.templates.pain[2][31][79] = Number.NEGATIVE_INFINITY)],
    ["Float32로 옮기면 Infinity가 되는 값 (1e39)", (f) => (f.templates.pain[2][31][79] = 1e39)],
    ["문자열 값", (f) => (f.templates.pain[2][31][79] = "0.5" as unknown as number)],
    ["null 값 (JSON.stringify가 NaN을 바꾼 모양)", (f) => (f.templates.pain[2][31][79] = null as unknown as number)],
    ["템플릿 0개 (빈 객체)", (f) => (f.templates = {})],
    ["템플릿 0개 (빈 배열 문장만)", (f) => (f.templates = { yes: [], no: [] })],
  ];

  it.each(broken)("형식 오류: %s → TemplateFormatError", (_, breakIt) => {
    const file = validFile() as TemplateFile & Record<string, unknown>;
    breakIt(file);
    expect(() => decodeTemplates(file)).toThrow(TemplateFormatError);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["배열", []],
    ["숫자", 42],
    ["문자열", "templates"],
  ])("파일이 객체가 아니면 TemplateFormatError: %s", (_, value) => {
    expect(() => decodeTemplates(value)).toThrow(TemplateFormatError);
  });
});

describe("기기 저장소 — IndexedDB가 없는 환경 (Node)", () => {
  it("전제: 이 테스트 환경에는 IndexedDB가 없다", () => {
    expect((globalThis as { indexedDB?: unknown }).indexedDB).toBeUndefined();
  });

  it("loadTemplates는 null", async () => {
    await expect(loadTemplates()).resolves.toBeNull();
  });

  it("clearTemplates는 에러 없이 끝난다", async () => {
    await expect(clearTemplates()).resolves.toBeUndefined();
  });

  it("saveTemplates는 IndexedDB가 없다는 오류로 실패한다", async () => {
    const saving = saveTemplates(SET);
    await expect(saving).rejects.toThrow(/IndexedDB/);
    await expect(saving).rejects.not.toBeInstanceOf(TemplateFormatError);
  });

  it.each([
    ["템플릿 0개", {}],
    ["모르는 문장 id", { hello: [synthetic(0)] }],
    ["행 수 불일치", { yes: [synthetic(0).slice(1)] }],
  ])("saveTemplates는 되읽을 수 없는 세트를 쓰기 전에 거절한다: %s", async (_, set) => {
    await expect(saveTemplates(set)).rejects.toBeInstanceOf(TemplateFormatError);
  });
});
