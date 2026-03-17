# Brevoca

웹 우선 AI 회의록 서비스 워크스페이스입니다.

Brevoca는 오디오 업로드와 브라우저 녹음을 받아 OpenAI 전사와 요약으로 회의록을 생성합니다. 현재 저장소는 `Next.js` 웹 앱과 작은 공용 계약 패키지만 유지합니다. Electron 클라이언트는 추후 같은 API 계약을 사용하는 별도 앱으로 재도입하는 전제를 둡니다.

## 현재 구조

```text
apps/
└── web/                    # Next.js 웹 앱 + Route Handlers
packages/
└── contracts/              # 회의/잡 타입, 상태값, 프롬프트 자산
```

## 주요 흐름

1. 브라우저에서 오디오 파일을 업로드하거나 직접 녹음합니다.
2. `POST /api/meetings`가 회의와 작업(job)을 생성합니다.
3. 서버 내부 백그라운드 처리기가 OpenAI 전사를 수행합니다.
4. 전사 결과를 OpenAI Responses API로 요약합니다.
5. `/processing/:jobId`에서 진행 상태를 polling 하고, 완료 시 `/meeting/:meetingId`로 이동합니다.

## 기술 스택

- 프론트엔드: Next.js 15, React 18, Tailwind CSS 4
- 서버 처리: Next.js Route Handlers, Node.js runtime
- AI: OpenAI speech-to-text, OpenAI Responses API
- 공용 계약: `@brevoca/contracts`

## 환경 변수

최소한 아래 값이 필요합니다.

```bash
OPENAI_API_KEY=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

선택적으로 모델과 Storage bucket을 조정할 수 있습니다.

```bash
BREVOCA_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
BREVOCA_SUMMARY_MODEL=gpt-5-mini
SUPABASE_MEETING_AUDIO_BUCKET=meeting-audio
```

## 시작하기

```bash
pnpm install
pnpm dev
```

웹 앱은 기본적으로 `http://localhost:3000`에서 실행됩니다.

## 빌드

```bash
pnpm build
pnpm start
```

## API 개요

- `POST /api/meetings`
  - 입력: 오디오 파일, 제목, 언어, source type, prompt template id
  - 출력: `meetingId`, `jobId`, 초기 상태
- `GET /api/meetings`
  - 최근 회의 목록 반환
- `GET /api/meetings/:id`
  - 전사문, 요약 markdown, 구조화된 액션아이템 반환
- `GET /api/jobs/:id`
  - 현재 단계, 상태, 진행률, 로그 반환
- `POST /api/jobs/:id/retry`
  - 실패한 작업 재처리

## Supabase 설정

- `pnpm dlx supabase@latest login` 으로 CLI 로그인합니다.
- `pnpm dlx supabase@latest link --project-ref <project-ref>` 로 프로젝트를 연결합니다.
- [`supabase/migrations/20260317000100_init.sql`](/home/ksy/wsl-workspace/Brevoca/supabase/migrations/20260317000100_init.sql) 와 [`supabase/migrations/20260317000200_auth_workspaces.sql`](/home/ksy/wsl-workspace/Brevoca/supabase/migrations/20260317000200_auth_workspaces.sql) 기준으로 `pnpm dlx supabase@latest db push` 를 실행합니다.
- 브라우저는 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, 서버는 `SUPABASE_SERVICE_ROLE_KEY`로 각각 접근합니다.
- `SUPABASE_SERVICE_ROLE_KEY`에는 publishable key가 아니라 secret/service-role key를 넣어야 합니다.
- 오디오 파일은 private Storage bucket에 저장되고, DB에는 `storage_key`만 저장됩니다.

## 향후 Electron 재도입 원칙

- Electron은 같은 API 계약을 사용하는 별도 클라이언트로 추가합니다.
- 전사/요약 로직은 계속 서버에 둡니다.
- 데스크톱 전용 기능은 시스템 오디오 캡처, 백그라운드 녹음, 로컬 파일 연동 같은 영역에 집중합니다.
