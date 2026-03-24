# Native Messaging 구조 메모

## 현재 구조

`rune`의 현재 실행 경로는 아래와 같다.

```text
[웹앱 페이지 - main world]
  window.webcliDom runtime
      ↕ window.postMessage
[Extension content script]
  DOM 스캔 + 런타임 주입 + 메시지 브리지
      ↕ chrome.runtime.sendMessage
[Extension service worker]
  Native Messaging 연결 관리 + 탭 상태 중계
      ↕ stdin/stdout
[Native Host wrapper]
      ↕ TCP localhost
[MCP backend daemon]
      ↕ MCP/stdio
[AI Agent]
```

## 패키지 구성

- `packages/core`
  - 공용 실행 타입, 오류 모델, Native Messaging 메시지 타입
- `packages/build-core`
  - 내부 전용 페이지 runtime과 manifest 타입
- `packages/extension`
  - Chrome 확장 프로그램
- `packages/mcp-server`
  - 설치기, native host wrapper 진입점, MCP backend
- `apps/cli-test-page`
  - 개발용 검증 앱

## 설치 흐름

```bash
pnpm install
pnpm dlx tsx packages/mcp-server/bin/webcli-mcp.ts install
```

설치 결과:

1. 확장 프로그램 번들을 `~/.runeai/extension/`에 복사
2. MCP 서버 번들을 `~/.runeai/mcp-server/`에 복사
3. Native Messaging host wrapper 생성
4. Chrome Native Messaging 설정 파일 생성

## 남아 있는 작업

- `webcli_config` 경로의 시각 효과 적용 동작 점검
- backend daemon 싱글톤 동작 안정화
- 팝업 설정 UI 실동작 검증
- 개발용 앱 기반 수동 검증 절차 보강
