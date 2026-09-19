# Step 10: subject-wiring

## 배경

이 phase는 B 담당(입모양 → 텍스트) 작업이다. B의 실제 `Recognizer` 구현 `LipRecognizer`(`src/recognition/lipRecognizer.ts`)가 준비됐다.
A의 README는 "B·C 실구현이 나오면 `src/app/(subject)/subject/page.tsx`에서 생성자만 교체한다"고 정해 두었다.
이 step은 대상자 화면의 `new MockRecognizer()`를 `LipRecognizer`로 바꾼다. A가 화면 작업 때 목을 계속 쓸 수 있도록
`?recognizer=mock`을 붙이면 기존 `MockRecognizer`를 쓰게 한다 (그 밖의 화면 동작은 그대로).

브랜치는 execute.py가 관리하며, 브랜치 전략(`feat-recognition`)과 커밋 방식(작업 규칙 6의 형식)은 사용자와 합의가 끝났다.
이에 대해 질문하지 말고 진행하라.

## 읽어야 할 파일

- `/src/app/(subject)/subject/page.tsx` (A의 대상자 화면 — 이 step에서 고칠 유일한 A 파일)
- `/src/recognition/lipRecognizer.ts`, `/src/recognition/mockRecognizer.ts`, `/src/types/recognition.ts`
- `/README.md` ("붙이는 지점" 절 — 읽기만)

## 작업

`src/app/(subject)/subject/page.tsx`에서 **아래만** 바꾼다:

1. `import { LipRecognizer } from "@/recognition/lipRecognizer";` 추가.
2. `useEffect` 안에서 URL 파라미터를 한 번 읽어 두고(`new URLSearchParams(window.location.search)`), 기존 `subject` 파라미터도 거기서 읽는다.
3. `const recognizer: Recognizer = new MockRecognizer();` →
   `?recognizer=mock`이면 `new MockRecognizer()`, 아니면 `new LipRecognizer()`.
4. 파일 머리 주석의 "인식(B)은 아직 mock" 문장을 "인식(B)은 LipRecognizer(기기 템플릿 필요 — /dev/lips), `?recognizer=mock`이면 목"으로 고친다.

그 밖의 줄(목소리 연동·로그·표시 타이머·JSX)은 한 글자도 바꾸지 않는다.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
git diff --name-only HEAD -- src | grep -v "^src/app/(subject)/subject/page.tsx$" ; test $? -eq 1
grep -q "new LipRecognizer()" "src/app/(subject)/subject/page.tsx"
grep -q "recognizer\") === \"mock\"\|recognizer') === 'mock'" "src/app/(subject)/subject/page.tsx"
```

(둘째 줄: `src` 아래에서 대상자 화면 파일 말고는 바뀌지 않았는지 확인.)

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 대상자 화면이 손 없이 완결되는가? (새 버튼·모달·토스트 없음 — CLAUDE.md CRITICAL)
   - 네트워크·계약 변경이 없는가?
3. 결과에 따라 `phases/recognition/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 대상자 화면에 버튼·모달·토스트 등 터치가 필요한 요소를 추가하지 마라. 이유: CLAUDE.md CRITICAL — 손 없이 완결.
- `page.tsx`의 목소리(C) 연동·로그·표시 로직을 바꾸지 마라. 이유: A·C의 구현이다. 인식기 생성 한 곳만 바꾼다.
- `src/app/(subject)/subject/page.tsx` 외의 파일을 수정하지 마라(README 포함). 이유: 다른 곳에 영향이 없어야 한다.
- npm 의존성을 추가하지 마라. 네트워크 호출을 추가하지 마라.
- 브랜치를 만들거나 바꾸지 말고, push하지 마라. 이유: 브랜치는 execute.py가 관리하고, push는 사용자 지시가 있을 때만 한다. 커밋은 작업 규칙 6의 형식대로 한다.
- 기존 테스트를 깨뜨리지 마라.
