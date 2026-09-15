# 프로젝트: 리보 (Livo)

소리를 내지 못하는 사람이 입모양만 만들면, 그 사람에게 가까운 목소리로 대신 말하는 보완대체 의사소통(AAC) 서비스.
기획 원본은 `리보_개발기획서_v5.html`이다. `docs/`와 기획서가 어긋나면 기획서를 기준으로 docs를 고친다.

## 기술 스택
- Next.js App Router + React, PWA — Vercel 배포 (Functions: Node Runtime · icn1 서울 · Fluid Compute)
- Supabase — Auth(Google OAuth 단독) · Postgres · Storage · Realtime
- 브라우저 인식 — MediaPipe Tasks(Face Landmarker, WASM), ONNX Runtime Web(CNN 방식일 때)
- 음성 합성·클로닝 — ElevenLabs API
- 오프라인 학습 — Python + PyTorch (`training/`)
- TypeScript strict mode · Tailwind CSS · Vitest — 기획서에 명시되지 않은 기본값. 팀이 바꾸기 전까지 이것을 따른다

## 아키텍처 규칙
- CRITICAL: 대상자가 쓰는 모든 경로(캘리브레이션·일상 발화)는 손을 쓰지 않고 끝나야 한다. 터치를 필수로 요구하는 대상자 화면을 만들지 마라. 손 입력은 보호자 화면과 수동 세션(옵션)에만 둔다
- CRITICAL: 고정 문장 발화 경로(구간 검출 → 정규화 → 인식 → 판정 게이트 → 재생)는 브라우저 안에서 네트워크 없이 끝나야 한다. `src/recognition/`에서 fetch·API 호출을 하지 마라
- CRITICAL: 응급 발화(Tier 0)를 자유 문장 경로에 태우지 마라. 자유 문장 트랙의 지연·장애가 고정 문장 트랙에 영향을 주면 안 된다
- CRITICAL: 카메라 영상·프레임을 서버로 보내거나 저장하지 마라. 유일한 예외는 연구 영상 동의(`consents.kind = 'research_video'`)가 있는 사람의 입 영역 크롭 수집이다
- CRITICAL: 임의 텍스트를 받아 음성을 합성하는 경로를 만들지 마라. 합성은 등록 문장(사전 합성) 또는 서버가 발급한 `candidate_id`로만 한다
- CRITICAL: ElevenLabs·LLM·음성인식 API 키와 호출은 서버(`src/services/`)에만 둔다
- CRITICAL: 모든 테이블과 `storage.objects`에 RLS를 건다. 동의 레코드 없이 음성·생체정보를 처리하지 마라 (`voice_profiles.consent_id`는 NOT NULL)
- CRITICAL: `utterances`에 좌표나 오디오를 저장하지 마라
- CRITICAL: AI Hub 데이터와 수집한 학습 데이터를 국외 서버(Colab, 해외 GPU 클라우드 등)에 올리지 마라. 이유: AI Hub 이용정책의 국외 반출 제한
- 화면·문구에 "치료·개선·호전" 같은 의료 효능 표현을 쓰지 마라. 사용 목적은 "의사소통 보조·발화 대체"로만 기술한다
- 디렉토리 구조는 `docs/ARCHITECTURE.md`를 따른다

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:)
- CLAUDE.md와 `docs/*.md`는 각각 200줄을 넘기지 않는다. 넘으면 세부 내용을 `references/`로 옮기고 원래 문서에는 요약과 경로만 남긴다. `references/`는 execute.py가 자동으로 주입하지 않으므로, 필요한 step 파일의 "읽어야 할 파일"에 경로를 적는다

## 명령어
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run test     # 테스트
python -X utf8 scripts/execute.py <task-name>   # Harness step 실행 (Windows에서는 -X utf8 필요 — 문서가 한글)
