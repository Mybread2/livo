# Step 0: voice-tooling

## 배경

리보는 3인이 병렬 개발한다. 이 phase는 **C 담당(텍스트 → 목소리: ElevenLabs 사전 합성·음성 클로닝)** 작업이다.
Next.js 골격(`create-next-app`)은 A 담당이 따로 올린다. 아직 레포에 없다. 이 phase는 Next.js 없이
TypeScript + Vitest만으로 C 모듈을 만들고, 나중에 A 골격과 합친다. API 라우트는 이 phase 범위 밖이다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- `/.claude/settings.json` — Stop 훅이 `npm run lint && npm run build && npm run test`를 실행한다
- `/.gitignore`

## 작업

최소 TypeScript 툴체인을 만든다. 설정값은 `create-next-app` 기본값과 맞춘다 — A의 골격과 합칠 때 충돌을 줄이기 위해서다.

1. `package.json` (`"private": true`, `"name": "livo"`, `"type"` 필드는 두지 않는다)
   - scripts:
     - `"lint": "eslint ."`
     - `"build": "tsc --noEmit"` — Next.js가 들어오면 A가 `next build`로 바꾼다
     - `"test": "vitest run --passWithNoTests"`
   - devDependencies: `typescript`, `vitest`, `eslint`, `@eslint/js`, `typescript-eslint`, `@types/node`
2. `tsconfig.json` — `create-next-app`의 기본 tsconfig와 같은 형태:
   `strict: true`, `noEmit: true`, `module: "esnext"`, `moduleResolution: "bundler"`, `target: "ES2017"`,
   `lib: ["dom", "dom.iterable", "esnext"]`, `isolatedModules: true`, `resolveJsonModule: true`, `skipLibCheck: true`,
   `paths: { "@/*": ["./src/*"] }`, `include: ["**/*.ts", "**/*.tsx"]`, `exclude: ["node_modules"]`
3. `vitest.config.ts` — `@` → `./src` alias. 기본 environment는 `node`
4. `eslint.config.mjs` — flat config. `@eslint/js` recommended + `typescript-eslint` recommended. `node_modules`, `phases`, `scripts`는 ignore
5. `.env.example` — 값은 비워 둔다. 각 줄 위에 한 줄 주석으로 용도를 적는다:
   ```
   ELEVENLABS_API_KEY=
   ELEVENLABS_PRESET_VOICE_ID=
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   ```
   주석에 "서버 전용 키(`ELEVENLABS_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)에는 절대 `NEXT_PUBLIC_` 접두사를 붙이지 않는다"를 적는다.
6. `.gitignore`에 `.env*`와 `!.env.example`을 추가한다. 곧 실제 키가 들어오므로 커밋되면 안 된다.

## Acceptance Criteria

```bash
npm install
npm run lint && npm run build && npm run test
python -X utf8 -m pytest scripts -q   # 기존 Harness 테스트가 깨지지 않음
git check-ignore -q .env.local && ! git check-ignore -q .env.example   # .env.local은 무시, .env.example은 추적
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `next`, `react`, `tailwindcss`를 설치하거나 `create-next-app`을 실행하지 마라. 이유: Next.js 골격은 A 담당이고, 여기서 만들면 A의 골격과 충돌한다.
- `src/` 아래에 코드를 만들지 마라. 이유: 이 step은 툴체인만 다룬다.
- 테스트 통과용 더미 테스트 파일을 만들지 마라. 이유: 빈 상태는 `--passWithNoTests`로 처리한다.
- 기존 테스트를 깨뜨리지 마라.
