# Step 8: dev-collector

## 배경

이 phase는 B 담당(입모양 → 텍스트) 작업이다. C4 인식은 **대상자 본인 입모양으로 만든 템플릿**이 기기(IndexedDB)에 있어야 동작한다.
이 step은 개발·데모용 **수집 페이지**를 만든다: 녹화 영상 파일을 고르면 브라우저 안에서 MediaPipe로 입술 좌표를 뽑고,
구간을 잘라 템플릿을 만들고, 하나씩 빼고 맞히기 분석을 보여 주고, 템플릿을 기기에 저장하거나 JSON으로 내려받는다.
또 저장된 템플릿으로 영상 하나를 파이프라인에 흘려 인식 결과를 시험한다.

사용자 결정: 수집 도구는 **다른 곳에 영향이 없게** — 새 route group 폴더만 추가하고(기존 파일 무변경), 운영 빌드에서는 404.
영상은 브라우저 밖으로 나가지 않는다(업로드·서버 전송 없음). 이 페이지는 대상자 화면이 아니라 개발자용이라 버튼을 써도 된다.

쓸 모듈 (모두 이미 있음):
- `src/recognition/landmarker.ts` — `createLipLandmarker()` → `detect(video, timestampMs)` (timestamp는 호출마다 엄격히 증가해야 한다)
- `src/recognition/lips.ts` — `extractLipFrame(landmarks, width, height, t)`
- `src/recognition/analysis.ts` — `segmentsFromFrames`, `buildTemplateSet`, `leaveOneOut`
- `src/recognition/pipeline.ts` — `RecognitionPipeline`
- `src/recognition/gate.ts` — `decideGate`
- `src/offline/templateStore.ts` — `saveTemplates`, `loadTemplates`, `clearTemplates`, `encodeTemplates`
- `src/lib/phrases.ts` — `STARTER_PHRASE_IDS`, `getPhrase`

브랜치는 execute.py가 관리하며, 브랜치 전략(`feat-recognition`)과 커밋 방식(작업 규칙 6의 형식)은 사용자와 합의가 끝났다.
이에 대해 질문하지 말고 진행하라.

## 읽어야 할 파일

- `/CLAUDE.md` (CRITICAL: 영상·프레임을 서버로 보내거나 저장하지 마라)
- 위 모듈 전부와 테스트, `/src/app/layout.tsx`, `/src/app/(subject)/layout.tsx` (앱 구조·스타일 참고 — 수정 금지)
- `/docs/UI_GUIDE.md` (참고. 이 페이지는 개발용이라 대상자 화면 규칙은 적용되지 않는다)

## 작업

### 1. `src/app/(dev)/layout.tsx` — 운영 빌드 차단 (서버 컴포넌트)

```tsx
import { notFound } from "next/navigation";
export default function DevLayout({ children }: { children: React.ReactNode }) {
  // 개발 서버에서만 연다 — 운영 빌드(Vercel 포함)에서는 404
  if (process.env.NODE_ENV === "production") notFound();
  return <>{children}</>;
}
```

### 2. `src/app/(dev)/dev/lips/extractFrames.ts` — 영상 파일 → 프레임별 얼굴 점 (브라우저 전용)

```ts
import type { LipLandmarker } from "@/recognition/landmarker";
import type { LipFrame } from "@/recognition/types";

export interface ExtractResult { frames: LipFrame[]; totalFrames: number; faceFrames: number; durationMs: number; width: number; height: number }

/**
 * 파일을 object URL로 연 <video>를 fps 간격으로 탐색(seek)하며 detect → extractLipFrame.
 * LipFrame.t = 영상 시각(ms). landmarker에 넘기는 timestamp는 performance.now()처럼 계속 증가하는 값을 쓴다 (파일이 바뀌어도 증가).
 * 끝나면 object URL을 해제한다. 영상·프레임을 어디에도 저장·전송하지 않는다.
 */
export function extractFrames(file: File, landmarker: LipLandmarker, fps?: number, onProgress?: (ratio: number) => void): Promise<ExtractResult>;
```

- 기본 fps 30. `video.muted = true`, `playsInline = true`. `loadeddata`까지 기다린 뒤 `currentTime = i / fps`로 옮기고 `seeked`를 기다린다.
- 얼굴이 없는 프레임은 `frames`에 넣지 않는다(`faceFrames`만 세지 않음).

### 3. `src/app/(dev)/dev/lips/page.tsx` — 수집 페이지 (`"use client"`)

화면 구성(한국어):

1. 안내: "영상은 이 브라우저 안에서만 처리되고 어디에도 올라가지 않습니다." 파일 이름 규칙: `<문장 id>.mp4` (`STARTER_PHRASE_IDS`).
2. 모델 준비 상태 (createLipLandmarker 로딩 중 / 준비됨 / 실패 메시지).
3. `<input type="file" accept="video/*" multiple>` → 파일마다 순서대로 처리, 진행률 표시.
   파일 이름(확장자 앞, 소문자)이 시작 단어 id가 아니면 "건너뜀"으로 표시.
4. 결과 표: 파일 · 문장(text) · 길이(초) · 전체 프레임 · 얼굴 프레임 · 구간 수 · 구간 길이(ms 목록).
5. 하나씩 빼고 맞히기 표 (`leaveOneOut`): 표본 · 정답 · 예측 · d1 · d2 · d1/d2 · score · 게이트(`decideGate`) — 정확도 요약(맞음/전체, 잘못 나간 표시·발화 수).
6. 버튼: "기기에 템플릿 저장"(`saveTemplates(buildTemplateSet(...))`) · "템플릿 JSON 내려받기"(`encodeTemplates` → Blob → 다운로드, 파일명 `templates-<날짜>.json`)
   · "저장된 템플릿 보기"(문장별 개수) · "저장된 템플릿 지우기".
7. "영상으로 인식 시험": 파일 하나를 고르면 기기에 저장된 템플릿으로 `RecognitionPipeline`에 프레임을 순서대로 넣고
   나온 이벤트 목록(t · phraseId · text · score · gate)을 보여 준다. 저장된 템플릿이 없으면 안내.

- 결과 표의 핵심 값에는 `data-testid`를 붙인다 (자동 점검용): 파일별 행 `data-testid="clip-<id>"`(구간 수 칸 `data-testid="segments-<id>"`),
  정확도 요약 `data-testid="loo-summary"`, 저장 결과 `data-testid="store-status"`, 시험 결과 목록 `data-testid="trial-events"`, 모델 상태 `data-testid="model-status"`.
- 스타일은 인라인 스타일로 간단히(기존 페이지처럼). 새 라이브러리·CSS 파일을 만들지 않는다.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
! grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon" "src/app/(dev)" src/recognition --include=*.ts --include=*.tsx
git diff --name-only HEAD -- src/app | grep -v "^src/app/(dev)/" ; test $? -eq 1
```

(마지막 줄: `src/app` 아래에서 `(dev)` 밖의 파일이 바뀌지 않았는지 확인.)

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 새 파일이 `src/app/(dev)/` 아래에만 있는가? 기존 파일을 건드리지 않았는가?
   - CLAUDE.md CRITICAL 규칙(영상·프레임 반출 금지, 인식 경로 네트워크 금지)을 위반하지 않았는가?
3. 결과에 따라 `phases/recognition/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `src/app/(dev)/` 밖의 파일(다른 화면·레이아웃·미들웨어·API)을 수정하지 마라. 이유: 사용자 결정 — 다른 곳에 영향이 없어야 한다.
- 영상·프레임·좌표를 서버·외부로 보내거나 레포 파일로 저장하지 마라. 이유: CLAUDE.md CRITICAL, 생체정보 반출 금지.
- 이 페이지를 운영 빌드에서 열리게 하지 마라. 이유: 개발 전용 도구다.
- `src/recognition/**`, `src/offline/**`, `src/types/**`, `src/lib/**`를 수정하지 마라. 이유: 검수된 산출물·다른 담당 구현이다.
- npm 의존성을 추가하지 마라. 이유: 새 의존성은 사용자 승인 대상이다.
- 브랜치를 만들거나 바꾸지 말고, push하지 마라. 이유: 브랜치는 execute.py가 관리하고, push는 사용자 지시가 있을 때만 한다. 커밋은 작업 규칙 6의 형식대로 한다.
- 기존 테스트를 깨뜨리지 마라.
