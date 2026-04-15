# Extension Removal & DevTools Web App

## Summary

Chrome extension을 완전 제거하고, DevTools 패널을 MCP 서버 내장 localhost 웹앱으로 전환한다. CDP Quick Mode가 유일한 실행 모드가 되며, `--mode` 플래그를 제거하여 CLI를 단순화한다.

## Motivation

- CDP Quick Mode가 extension의 핵심 기능(runtime 주입, 페이지 제어, 탭 관리)을 이미 대체
- Extension이 제공하는 유일한 고유 기능은 DevTools 패널뿐
- 혼자 유지보수하는 프로젝트에서 CWS 배포, native host 관리, 확장 업데이트 등의 부담 제거
- 사용자 설치 단계 단순화: npm 패키지 하나로 끝

## Architecture

### Before

```
@agrune/core
@agrune/runtime
@agrune/browser (CdpDriver + ExtensionDriver)
@agrune/mcp (MCP 서버, stdio only)
@agrune/devtools (Chrome DevTools 패널 UI)
@agrune/extension (Chrome 확장)
@agrune/build-core (deprecated)
@agrune/mcp-server (deprecated)
@agrune/cli
```

### After

```
@agrune/core
@agrune/runtime
@agrune/browser (CdpDriver only)
@agrune/mcp (MCP 서버 + HTTP/WebSocket 서버 + DevTools 정적 파일 서빙)
@agrune/devtools (순수 웹앱, chrome.* 의존 제거)
@agrune/cli
```

## CLI Changes

`--mode` 플래그 제거. CDP가 기본이자 유일한 모드.

```bash
# Chrome 자동 실행 + DevTools 웹앱
agrune

# headless
agrune --headless

# 기존 Chrome에 붙기
agrune --attach ws://127.0.0.1:9222/devtools/browser/<UUID>

# DevTools 웹앱 비활성화
agrune --no-devtools
```

모든 모드에서 `http://localhost:PORT/devtools`로 DevTools 웹앱 접근 가능.

## DevTools Web App

### Serving

MCP 서버 프로세스가 시작할 때 HTTP 서버를 함께 띄운다.

- `http://localhost:PORT/devtools` — DevTools 웹앱 정적 파일
- `ws://localhost:PORT/devtools/ws` — 스냅샷 실시간 스트리밍
- MCP 서버 시작 시 콘솔에 URL 출력
- `--no-devtools` 플래그로 HTTP/WebSocket 서버 비활성화

### WebSocket Protocol

서버 → 클라이언트:

```json
{ "type": "snapshot_update", "data": { "tabId": "...", "snapshot": {} } }
{ "type": "sessions_update", "data": [{ "tabId": "...", "url": "...", "title": "..." }] }
```

클라이언트 → 서버:

```json
{ "type": "subscribe", "tabId": "..." }
{ "type": "highlight", "targetId": "..." }
{ "type": "clear_highlight" }
```

### UI Features

기존 DevTools 패널 기능을 그대로 유지:

1. **탭 선택** — 세션 목록에서 대상 탭 선택
2. **스냅샷 뷰어** — 그룹별 타겟 목록, 실시간 갱신 (800ms)
3. **필터** — reason (ready/hidden/disabled), actionKinds (click/fill/drag)
4. **검색** — 타겟명, 그룹명, 텍스트 전문 검색
5. **상세 패널** — targetId, selector, visible, enabled, inViewport, covered, actionableNow, sensitive, textContent, valuePreview, 소스 위치
6. **하이라이트** — 페이지에서 타겟 오버레이 표시

### Connection Model

기존 extension:

```
DevTools panel ←→ chrome.runtime.connect() ←→ Background SW ←→ Content Script ←→ Page Runtime
```

변경 후:

```
DevTools 웹앱 ←→ WebSocket ←→ MCP 서버 ←→ CDP ←→ Page Runtime
```

## Removal Scope

### Package Deletion

디렉토리 통째로 삭제:

- `packages/extension/`
- `packages/build-core/`
- `packages/mcp-server/`

### Code Removal

- `packages/browser/src/extension-driver.ts` — ExtensionDriver 전체
- `packages/browser/src/` 내 native messaging 관련 코드
- `packages/mcp/bin/agrune-mcp.ts` — `--mode` 플래그 파싱 제거
- `packages/mcp/src/` 내 `createNativeMessagingTransport`, ExtensionDriver import
- `packages/mcp/src/index.ts` — ExtensionDriver 분기 제거

### Devtools Package Changes

- `chrome.devtools.panels.*`, `chrome.runtime.connect()` 의존 제거
- `chrome.runtime.sendMessage()` → WebSocket 클라이언트로 교체
- 빌드 타겟: Chrome 확장 번들 → 일반 웹앱 번들 (Vite)

### CLI Changes

- `agrune install` (native host 등록) — 제거
- `agrune update` — native host 관련 로직 제거
- CLI 기본 동작이 CDP 모드 + DevTools 서버

### External Cleanup

- CWS 등록 내리기 (수동)
- npm에서 `@agrune/build-core`, `@agrune/mcp-server` deprecate 처리
- GitHub Actions `release.yml`에서 CWS 배포 job 제거

## Test Strategy

### Removed Tests

- `packages/extension/` 테스트 83개 — 패키지 삭제와 함께 제거
- `packages/browser/` 내 ExtensionDriver 관련 테스트

### Maintained Tests

- `packages/core/` 12개 — 변경 없음
- `packages/runtime/` 65개 — 변경 없음
- `packages/browser/` CdpDriver 관련 테스트 — 유지
- `packages/mcp/` — ExtensionDriver 경로 테스트 제거

### New Tests

- DevTools HTTP 서빙 — 정적 파일 응답 확인
- WebSocket 연결 — subscribe, snapshot_update, highlight 메시지 흐름
- CLI 플래그 — `--attach`, `--headless`, `--no-devtools` 동작 확인
