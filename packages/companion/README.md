# @webcli-dom/companion

브라우저 페이지의 live snapshot과 명령 결과를 받아 `webcli` CLI/TUI에 제공하는 로컬 companion 서버입니다.

기본 주소:

- HTTP API: `http://127.0.0.1:9444`
- Page WS: `ws://127.0.0.1:9444/page/ws?sessionId=<id>&token=<session-token>`

## Run

```bash
pnpm --filter @webcli-dom/companion run start
```

## CLI

```bash
pnpm --filter @webcli-dom/companion run status
pnpm --filter @webcli-dom/companion run stop
```

## 저장 경로

- 상태: `~/.webcli-dom/companion/state.json`
- 에이전트 토큰: `~/.webcli-dom/companion/agent-token`
- PID: `~/.webcli-dom/companion/companion.pid`

## API 개요

- `GET /api/status`
- `GET /api/sessions`
- `POST /api/sessions/activate`
- `GET /api/snapshot`
- `POST /api/commands/act`
- `POST /api/commands/drag`
- `POST /api/commands/fill`
- `POST /api/commands/wait`
- 모든 `/api/*` 호출은 `Authorization: Bearer <agent-token>` 헤더가 필요합니다.

## 페이지 연결

- `/page/connect` 는 실제 브라우저 `Origin` 헤더를 기준으로 세션을 만들고 `sessionToken` 을 반환합니다.
- `/page/sync` 는 `Authorization: Bearer <session-token>` 헤더가 필요합니다.
- `/page/ws` 는 `token=<session-token>` query가 필요합니다.
