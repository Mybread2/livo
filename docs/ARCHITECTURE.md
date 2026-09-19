# 아키텍처

> 근거: 기획서 v5 §5(시스템 아키텍처) · §8(데이터 모델) · §9(컴포넌트·API). 디렉토리 구조는 기획서에 없어 여기서 정했다.

## 디렉토리 구조
```
src/
├── app/                # 페이지 + API 라우트 (Vercel Functions, Node Runtime)
│   ├── (subject)/      # 대상자 화면 — 병상 태블릿, 손 없이 동작
│   ├── (caregiver)/    # 보호자 화면 — 로그인·동의·목소리·문장 관리
│   └── api/            # 서버 엔드포인트 (아래 API 표)
├── components/         # UI 컴포넌트
├── recognition/        # 브라우저 전용 인식 파이프라인 C1~C5 — 네트워크 호출 금지
├── offline/            # 인식기 번들·사전 합성 오디오 저장과 재생, 미동기화 로그 큐
├── services/           # 서버 전용 외부 API 래퍼 (elevenlabs, Stage 3: llm·asr)
├── lib/                # 공용 유틸, Supabase 클라이언트
└── types/              # TypeScript 타입
supabase/migrations/    # 스키마 + RLS
training/               # Python 오프라인 학습 (C9) — 국내에서만 실행
public/                 # PWA manifest, service worker
```

## 두 트랙
| 항목 | 고정 문장 트랙 (Stage 1) | 자유 문장 트랙 (Stage 3) |
|------|------------------------|------------------------|
| 처리 위치 | 단말 전부 | 단말(구간 검출) + 서버(후보 생성·합성) |
| 출력 | 게이트 통과 시 자동 발화 | 후보 3개 표시 → 대상자 확인 후 발화 |
| 합성 | 사전 합성, 단말 보관 | 실시간 (ElevenLabs 스트리밍) |
| 오프라인 | 동작 | 불가 |
| 목소리 | 프리셋 · 가족 · 본인 | 프리셋 · 본인만 |
| 응급 발화 | 여기서만 | 태우지 않음 |

- 같은 구간에서 두 트랙이 결과를 내면 고정 문장 트랙의 게이트 통과 결과가 우선한다.
- 자유 문장 트랙 진입 방식은 미정(기획서 W14).

## 컴포넌트
| ID | 컴포넌트 | 위치 | 입력 → 출력 |
|----|---------|------|------------|
| C1 | 입술 추출기 | 브라우저 (MediaPipe) | 카메라 프레임 → `{t, points[40][2]}` 스트림 |
| C2 | 구간 검출기 | 브라우저 | 입 개폐량 시계열 → 발화 후보 구간 (움직임 시작 ~ 0.5초 정지) |
| C3 | 정규화기 | 브라우저 | 원시 좌표 시퀀스 → `float32[32][80]` (32프레임 리샘플) |
| C4 | 인식기 | 브라우저 (DTW 또는 소형 CNN) | `float32[32][80]` → `{label, score}` · 거절 포함 |
| C5 | 판정 게이트 | 브라우저 | `{label, score, mode}` → `speak` / `show` / `discard` |
| C6 | TTS 합성기 | ElevenLabs API | 문장 텍스트 + voice_id → 오디오 (사전 합성 · 자유 문장 실시간) |
| C6b | 사전 합성기 | Vercel + Supabase → 단말 | (문장 × voice_id) 목록 → 단말 보관 오디오 묶음 |
| C7 | 음성 프로필 등록기 | Vercel + ElevenLabs | 참조 음성 + 동의 → `voice_id` → `voice_profiles` |
| C8 | 데이터 수집 도구 | 브라우저 | 녹화 세션 → `.npz` (+ 입 영역 크롭) → Storage |
| C9 | 학습 파이프라인 | `training/` · 국내 | `.npz`·영상 → 사용자별 CNN(`.onnx`, CPU) 또는 공용 인코더(GPU) → `models` |
| C10 | 자유 문장 인식기 (Stage 3) | 단말 WebGPU 또는 서버리스 GPU (미정) | 입 영역 데이터 → 음소 확률열 |
| C11 | 대화 맥락 수집기 (Stage 3) | 브라우저 → 음성인식 API | 대화 상대 발화 → 직전 대화 텍스트 (원본 음성 비저장) |
| C12 | 후보 생성기 (Stage 3) | Vercel → LLM API | 음소 확률열 + 맥락 → 후보 3개 + `candidate_id` |

- CNN 방식이면 학습(Python)과 추론(JS)의 정규화가 갈라지지 않게, 정규화를 ONNX 그래프에 넣거나 골든 픽스처로 동등성 테스트를 건다.

## 판정 게이트 (C5)
| 결과 | 조건 | 동작 |
|------|------|------|
| `discard` | NONE 클래스 또는 템플릿 거리 초과 | 아무 일도 없음. 로그도 남기지 않음 |
| `discard` | score < 0.70 | 조용히 폐기 |
| `show` | 0.70 ≤ score < 0.90 | 문장만 표시, 소리 없음. 다시 말하면 확정 |
| `speak` | score ≥ 0.90 (수동 세션은 0.80) | 문장 표시 + 사전 합성 오디오 재생 |

임계값은 출발값이다. 자연 상태 오발화 실측으로 보정한다.

## 데이터 흐름
```
[고정 문장 · 네트워크 없음]
카메라 → C1 입술 좌표 → C2 구간 → C3 정규화 → C4 인식 → C5 게이트
  → speak: 문장 크게 표시 + 단말 오디오 재생 → 로그 큐(src/offline/)
  → 연결되면 POST /api/utterances/sync

[목소리 등록]
보호자 업로드(signed URL, private bucket) → POST /api/voice-profile → 전처리
  → ElevenLabs voice 등록 → 고정 문장 전체 사전 합성 → Storage
  → 단말이 GET /api/bundle/:subject_id 로 내려받음

[프리셋 목소리 · 팔레트]
팀이 ElevenLabs 웹에서 성별·연령대 프리셋 6개 생성 → npm run precompute:presets → Storage presets/{key}/
  → 보호자가 GET /api/voice-presets 로 미리듣기 → PUT /api/subjects/:subject_id/voice-preset
  → 번들 목소리: 동의가 살아 있는 완성 프로필 → 대상자가 고른 프리셋 → 기본 프리셋(male-50s)

[자유 문장 · Stage 3]
C2 구간 → C10 음소열 + C11 대화 맥락 → POST /api/free-utterance → C12 후보 3개
  → 대상자 확인(반복·눈깜빡임·끄덕임) → POST /api/free-utterance/confirm → 스트리밍 재생
```

- 무료 플랜에서는 클로닝·Voice Design API가 막혀 있어, 성별·연령대 프리셋 6개를 웹에서 만들어 사전 합성하고 대상자별로 고른다. 클로닝 경로(`/api/voice-profile`)는 유료 전환 또는 자체 호스팅 모델용으로 남아 있다.

## API
| 메서드 · 경로 | 요청 | 응답 | 비고 |
|--------------|------|------|------|
| `POST /api/utterances/sync` | 단말에 쌓인 발화 로그 | `{synced}` | 실패해도 발화에 영향 없음. 다음 연결 때 재시도 |
| `POST /api/calibration/sample` | 좌표 시퀀스, phrase_id, session_id | `{sample_id, quality}` | 품질 미달이면 즉시 재녹화 유도 |
| `POST /api/voice-profile/upload-url` | subject_id, source | `{path, signed_url, token}` | 참조 음성 업로드용 서명 URL (private bucket) |
| `POST /api/voice-profile` | subject_id, source, ref_audio_path | `{profile_id, voice_id, preview_url}` | 등록 → 미리듣기 → 고정 문장 사전 합성. 동의는 서버가 찾는다 |
| `POST /api/voice-profile/:profile_id/precompute` | subject_id | `{synthesized, skipped}` | 사전 합성이 중간에 실패했을 때(502) 남은 문장만 재시도 |
| `GET /api/voice-presets` | — | `{presets: [{key, label, gender, age_band, preview_url}]}` | 사전 합성이 끝난 프리셋만. 미리듣기 서명 URL이라 `no-store`, voice_id 없음 |
| `PUT /api/subjects/:subject_id/voice-preset` | preset_key | `{preset_key}` | 팔레트에 없거나 합성이 덜 된 키는 400 |
| `POST /api/train` | subject_id | `{job_id}` | CNN 방식일 때만. 완료는 Supabase Realtime |
| `GET /api/bundle/:subject_id` | — | `{voice, recognizer}` | 오프라인 발화에 필요한 것을 내려받음. 서명 URL이라 `no-store`, voice_id 없음 |
| `POST /api/consents/:consent_id/revoke` | — | `{purged_profile_ids}` | 철회·대상자 삭제는 목소리 파기(ElevenLabs·Storage)를 동반해야 해서 RLS로 막고 이 서버 경로만 둔다 |
| `DELETE /api/subjects/:subject_id` | — | 204 | 위와 같음. 프로필 전부 파기 후 삭제 |
| `POST /api/free-utterance` (Stage 3) | 입 영역 데이터, subject_id, 대화 맥락 | `{candidates: [{candidate_id, text}×3]}` | 후보 생성만 |
| `POST /api/free-utterance/confirm` (Stage 3) | candidate_id | 오디오 스트림 | 텍스트를 직접 받는 합성 경로는 없다 |

## 데이터 모델 (Supabase)
| 테이블 | 핵심 컬럼 | 규칙 |
|--------|----------|------|
| `auth.users` | id, email, provider | Google OAuth 단독 |
| `accounts` | user_id, plan, billing_customer_id, org_id | 결제·플랜 귀속 단위 |
| `subjects` | id, account_id, display_name, birth_year, sex, condition, trigger_mode, voice_preset | 계정 1 : 대상자 N. `voice_preset`은 팔레트 키(null = 기본 프리셋) — 번들이 읽을 때 검증 |
| `consents` | subject_id, kind, granted_by, granted_at, revoked_at, doc_version, evidence | kind = biometric / voice_self / voice_family / research_use / overseas_transfer / research_video / voice_retention. `granted_by`로 본인·법정대리인·가족 구분 |
| `phrases` | id, text, tier, is_global, account_id | 전역 15문장 + 사용자 추가 |
| `subject_phrases` | subject_id, phrase_id, class_index(CNN만), enabled, sample_count, accuracy | 대상자별 활성 문장 |
| `calibration_sessions` | id, subject_id, started_at, device_info, lighting_score | 정확도 저하 원인 추적용 메타 |
| `landmark_samples` | id, session_id, subject_id, phrase_id, seq, mouth_video_path, voiced, frames, fps, quality, research_use | 좌표는 `.npz`로 Storage, DB엔 경로·메타. 국내 리전에만 저장 |
| `models` | id, subject_id(공용은 null), kind(dtw_templates / cnn / shared_encoder), version, artifact_path, confusion_matrix, val_accuracy, created_at | 두 인식 방식을 같은 테이블에 |
| `voice_profiles` | id, subject_id, source(preset / family / self), ref_audio_path, provider_voice_id, consent_id | `consent_id` NOT NULL |
| `phrase_audio` | subject_id, phrase_id, voice_profile_id, audio_path, char_count, created_at | 사전 합성 오디오 |
| `utterances` | id, subject_id, track(fixed / free), phrase_id, text, score, gate_result, latency_ms, created_at | 좌표·오디오 저장 금지 |
| `usage_events` | account_id, kind, qty, period | 과금·쿼터 산정 |
| `subscriptions` | account_id, plan, status, current_period_end, pg_ref | PG 웹훅으로 갱신 |

- RLS: 모든 테이블과 `storage.objects`. 대상자 데이터는 `subjects.account_id` → `accounts.user_id = auth.uid()`로 검증한다.
- 보관: 참조 음성 원본은 동의 정책(등록 후 파기 또는 암호화 보관)을 따르고 요청 시 즉시 파기. 계정 삭제 시 연쇄 파기. 민감정보는 분리 보관.

## 상태 관리
- 대상자 화면의 런타임 상태(트리거 모드, 수동 세션 ON/OFF, 게이트 결과)는 클라이언트 메모리에 둔다. 서버 응답에 의존하지 않는다.
- 오프라인 자산(인식기 번들, 사전 합성 오디오, 미동기화 로그)은 단말 저장소에 둔다. 프로필 교체 중에는 새 오디오를 다 받을 때까지 이전 오디오로 재생한다.
- 서버 상태의 원본은 Supabase. 학습 완료 같은 푸시는 클라이언트가 Supabase Realtime에 직접 붙는다(Vercel WebSocket 미사용).
