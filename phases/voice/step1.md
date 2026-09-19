# Step 1: voice-contracts

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. A(화면)·B(입모양 인식)·C(음성)가 병렬 개발하므로,
모듈 사이 계약을 먼저 고정한다. 이 step은 A ↔ C 계약 타입과, B·C가 같이 참조하는 공용 문장 상수를 만든다.
공용 문장 상수는 팀 합의용 초안이다. 초기 단어 셋은 5개다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- `/package.json`, `/tsconfig.json`, `/vitest.config.ts` (step 0 산출물)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/types/voice.ts` — A ↔ C 계약. 아래를 **그대로** 옮긴다 (주석 포함)

```ts
export interface VoicePlayer {
  // 사전 합성된 그 사람 목소리로 해당 문장을 재생. 네트워크 없이 단말 오디오.
  speak(phraseId: string): Promise<void>;
  isReady(phraseId: string): boolean;  // 번들 다운로드 완료 여부
}
```

### 2. `src/lib/phrases.ts` — 공용 고정 문장 상수

```ts
export const PHRASES = [
  { id: 'yes',    text: '네',     tier: 3 },
  { id: 'no',     text: '아니요', tier: 3 },
  { id: 'pain',   text: '아파요', tier: 0 },
  { id: 'water',  text: '물이요', tier: 1 },
  { id: 'toilet', text: '화장실', tier: 1 },
] as const;

export type PhraseId = (typeof PHRASES)[number]['id'];
export function isPhraseId(value: unknown): value is PhraseId;
export function getPhraseText(id: PhraseId): string;
```

- tier는 기획서 §7.3 기준이다 (0 응급 · 1 생리 · 2 환경 · 3 소통).
- 이 상수는 **합성 가능한 텍스트의 유일한 원본**이다. 이후 step의 합성 함수는 텍스트가 아니라 `PhraseId`만 받아 이 상수에서 텍스트를 찾는다. 임의 텍스트 합성 경로를 구조로 막기 위해서다 (CLAUDE.md CRITICAL).
- `getPhraseText`에 `PhraseId`가 아닌 값이 캐스팅되어 들어오면 throw한다.

### 3. 테스트 `src/lib/phrases.test.ts`

- id가 중복되지 않는다
- 모든 text가 비어 있지 않다
- `isPhraseId`는 등록된 id만 true. 문장 텍스트(`'네'`)·빈 문자열·숫자·`undefined`는 false
- `getPhraseText('pain') === '아파요'`, 미등록 값 캐스팅 시 throw

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/types/`, `src/lib/`)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `src/types/recognition.ts`를 만들지 마라. 이유: A ↔ B 계약이라 C가 만들 파일이 아니다.
- `VoicePlayer` 시그니처를 바꾸지 마라 (예: `phraseId: string`을 `PhraseId`로 좁히기). 이유: 3인이 합의한 계약이고 변경은 셋의 동의로만 한다.
- 단어를 5개 외에 추가하지 마라. 이유: 초기 단어 셋은 팀 합의 대상이다.
- 기존 테스트를 깨뜨리지 마라.
