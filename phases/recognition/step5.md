# Step 5: template-store

## 배경

이 phase는 B 담당(입모양 → 텍스트) 작업이다. 카메라 입모양을 고정 문장 5개(`STARTER_PHRASE_IDS`) 중 하나로
분류해 A의 화면에 `RecognitionEvent`로 넘기는 `Recognizer`를 만든다. C4 인식은 DTW 템플릿 매칭이라,
**대상자 본인 입모양으로 만든 템플릿**(`TemplateSet` — 문장 id → 정규화된 `Sequence` 여러 개)이 기기에 있어야 동작한다.

이 step은 템플릿을 **기기 저장소(IndexedDB)** 에 저장·조회하는 모듈과, JSON으로 내보내고 들여오는 변환 함수를 만든다.
템플릿은 생체정보 성격의 데이터라 서버로 보내지 않고 기기에만 둔다 (사용자 결정 · CLAUDE.md 영상/데이터 반출 금지 원칙).
ARCHITECTURE.md의 `src/offline/`("인식기 번들·사전 합성 오디오 저장과 재생")에 둔다.

브랜치는 execute.py가 관리하며, 브랜치 전략(`feat-recognition`)과 커밋 방식(작업 규칙 6의 형식)은 사용자와 합의가 끝났다.
이에 대해 질문하지 말고 진행하라.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (디렉토리 `src/offline/`, 상태 관리 "오프라인 자산은 단말 저장소")
- `/src/recognition/types.ts` (`Sequence`, `SEQ_FRAMES`, `FEATURE_DIM`), `/src/recognition/dtw.ts` (`TemplateSet`)
- `/src/lib/phrases.ts` (`isPhraseId`)
- `/src/offline/` 안의 기존 파일 (스타일 참고만 — 수정 금지)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/offline/templateStore.ts`

```ts
import type { TemplateSet } from "@/recognition/dtw";

/** JSON으로 옮길 수 있는 템플릿 파일 형식. */
export interface TemplateFile {
  version: 1;
  createdAt: string;            // ISO 시각
  seqFrames: number;            // SEQ_FRAMES (32)
  featureDim: number;           // FEATURE_DIM (80)
  templates: Record<string, number[][][]>; // 문장 id → 템플릿들 → 32행 → 80값
}

export class TemplateFormatError extends Error {}

/** TemplateSet → TemplateFile. 빈 템플릿 배열인 문장은 뺀다. */
export function encodeTemplates(set: TemplateSet, now?: Date): TemplateFile;

/**
 * 모르는 값(JSON.parse 결과 등) → TemplateSet. 형식이 틀리면 TemplateFormatError.
 * 검사: version === 1 · seqFrames/featureDim이 현재 상수와 같음 · 문장 id가 isPhraseId · 템플릿마다 행 SEQ_FRAMES개 × 값 FEATURE_DIM개 · 모든 값이 유한수.
 * 템플릿이 하나도 없는 파일도 오류다.
 */
export function decodeTemplates(file: unknown): TemplateSet;

/** 기기(IndexedDB)에 저장. 이전 것을 덮어쓴다. IndexedDB가 없는 환경(서버·Node)이면 throw. */
export function saveTemplates(set: TemplateSet): Promise<void>;
/** 기기에서 읽는다. 저장된 것이 없거나 IndexedDB가 없는 환경이면 null. 저장본이 깨졌으면 null(콘솔 경고). */
export function loadTemplates(): Promise<TemplateSet | null>;
/** 기기 저장본을 지운다. IndexedDB가 없으면 아무것도 안 한다. */
export function clearTemplates(): Promise<void>;
```

- IndexedDB: DB 이름 `ipmoa-recognition`, 버전 1, object store `templates`, 키 `"current"`. 값은 `encodeTemplates` 결과(TemplateFile)를 그대로 저장하고, 읽을 때 `decodeTemplates`로 검사한다 (한 형식만 쓴다).
- `globalThis.indexedDB`로 접근한다 (없으면 위 규칙대로 처리). 네트워크를 쓰지 않는다.
- `decodeTemplates`가 만드는 `Sequence`의 행은 `Float32Array`다.

### 2. 테스트 `src/offline/templateStore.test.ts`

합성 `Sequence`만 쓴다 (예: 행 j·열 i 값 = sin(j + i·0.1) 같은 결정적 값).

- encode → JSON.stringify → JSON.parse → decode 왕복이 원본과 같다 (Float32 정밀도 안에서)
- encode는 빈 템플릿 배열 문장을 뺀다, `createdAt`은 주어진 시각
- decode 오류(TemplateFormatError): version 불일치, seqFrames·featureDim 불일치, 모르는 문장 id, 행 수·값 수 불일치, NaN·Infinity·문자열 값, 템플릿 0개, null·배열·숫자 입력
- Node 환경(IndexedDB 없음): `loadTemplates()` → null, `clearTemplates()` → 에러 없이 끝남, `saveTemplates()` → throw
- IndexedDB 동작 자체는 브라우저(다음 step의 개발용 페이지)에서 확인한다 — 이 step에서 가짜 IndexedDB 라이브러리를 추가하지 마라.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
! grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon" src/recognition src/offline/templateStore.ts --include=*.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/offline/`)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/recognition/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 템플릿을 서버·Supabase·외부로 보내는 코드를 만들지 마라. 이유: 생체정보 성격 데이터는 기기에만 둔다 (사용자 결정, CLAUDE.md 반출 금지 원칙).
- npm 의존성(가짜 IndexedDB 등)을 추가하지 마라. 이유: 새 의존성은 사용자 승인 대상이다.
- `src/offline/`의 기존 파일(C의 voice-player 등), `src/types/**`, `src/lib/phrases.ts`, `src/recognition/**`, `src/app/**`를 수정하지 마라.
  이유: 다른 담당의 구현이거나 이미 검수·병합된 산출물이다.
- 실제 녹화 영상·입술 좌표·템플릿 파일을 레포에 추가하지 마라(테스트 픽스처 포함). 이유: 생체정보 성격의 학습 데이터이고 GitHub는 국외 서버다.
- 브랜치를 만들거나 바꾸지 말고, push하지 마라. 이유: 브랜치는 execute.py가 관리하고, push는 사용자 지시가 있을 때만 한다. 커밋은 작업 규칙 6의 형식대로 한다.
- 기존 테스트를 깨뜨리지 마라.
