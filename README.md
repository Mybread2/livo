# 입모아 (IP-MOA)

입모양으로 말하는 보완대체 의사소통(AAC) 서비스. 소리를 내지 못하는 사람이 입모양만 만들면
그 사람에게 가까운 목소리로 대신 말한다.

기획 원본은 `리보_개발기획서_v5.html`, 설계 요약은 `docs/`에 있다.
(서비스명은 **입모아**로 통일. 일부 기획 문서·CLAUDE.md는 아직 옛 이름 "리보"를 쓴다 — 점진 정리 예정.)

## 실행
```bash
npm install
npm run dev      # http://localhost:3000
npm run test     # 판정 게이트·문장 목록 단위 테스트
npm run build
npm run lint
```

환경변수는 `.env.example`를 `.env.local`로 복사해서 채운다.
값이 없어도 개발 서버와 **대상자 화면**은 동작한다(고정 문장 발화는 단말 완결이 원칙).

## 3인 분담과 이 골격의 역할
- **A (이 레포):** 와이어프레임 → 프론트 골격 + Vercel/Supabase 연결 + B·C가 꽂힐 인터페이스.
- **B:** 입술 좌표 → AI 추론 → 텍스트. `src/recognition/`의 `Recognizer`를 구현(네트워크 금지).
- **C:** 음성 파일 → 유사 목소리 발화. `src/services/`(서버·키 보관) + `VoicePlayer` 구현.

### 붙이는 지점 (계약)
- `src/types/recognition.ts` — `Recognizer` (A ↔ B)
- `src/types/voice.ts` — `VoicePlayer` (A ↔ C)
- `src/lib/phrases.ts` — 공용 고정 문장 목록(B·C 공유)

지금은 `MockRecognizer`(src/recognition)·`MockVoicePlayer`(src/offline)로 흐름이 돈다.
B·C 실구현이 나오면 `src/app/(subject)/subject/page.tsx`에서 생성자만 교체한다.

## 주요 화면
| 경로 | 화면 | 비고 |
|------|------|------|
| `/` | 스플래시/진입 | 골격 |
| `/subject` | 대상자 런타임 | idle/discard/show/speak, 손 없이 완결, Wake Lock |
| `/calibration` | 캘리브레이션 | 따라 할 문장 1개 |
| `/login` | 보호자 로그인 | Google OAuth |
| `/home` | 보호자 홈 | 문장·목소리 진입 |
| `/phrases` `/voice` `/settings` `/onboarding` | 보호자 스텁 | 다음 단계 |

## 지켜야 할 CRITICAL 규칙 (CLAUDE.md 발췌)
1. 대상자 화면은 손 없이 완결 — 확인 버튼·모달·토스트 금지.
2. 고정 문장 인식은 브라우저에서 네트워크 없이 — `src/recognition/`에서 fetch 금지.
3. 카메라 영상·프레임을 서버로 보내거나 저장하지 않는다.
4. 임의 텍스트 → 음성 합성 경로를 만들지 않는다(등록 문장/candidate_id만).
5. ElevenLabs·LLM 키·호출은 서버(`src/services/`)에만.
6. 모든 테이블·Storage에 RLS. `voice_profiles.consent_id` NOT NULL.

## 디렉토리
`docs/ARCHITECTURE.md`를 따른다. (`src/app`, `recognition`, `offline`, `services`, `lib`, `types`, `supabase/migrations`)
