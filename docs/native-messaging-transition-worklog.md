# Native Messaging 전환 작업 기록

## 개요

webcli-dom을 WebSocket + Companion Server 구조에서 Chrome Extension + Native Messaging + MCP 서버 구조로 전환.
Companion 서버 없이 AI Agent(Claude Code, Codex, Gemini CLI)가 브라우저를 직접 제어할 수 있도록 함.

**브랜치**: `feat/native-messaging-transition`
**기간**: 2026-03-23

---

## 아키텍처

```
[웹앱 페이지 - main world]
  런타임 (window.webcliDom) — 스냅샷, 클릭, 입력, 드래그
      ↕ window.postMessage
[Extension content script]
  DOM 스캔 (data-webcli-*) + 런타임 주입 + 통신 브릿지
      ↕ chrome.runtime.sendMessage
[Extension service worker]
  Native Messaging 연결 관리 + 탭 이벤트
      ↕ chrome.runtime.connectNative → stdin/stdout (4바이트 LE + JSON)
[Native Host 프로세스] (~/.webcli-dom/native-host)
  Native Messaging ↔ TCP 변환
      ↕ TCP localhost (포트 번호는 ~/.webcli-dom/port 파일에 기록)
[MCP 서버 프로세스] (AI Agent가 실행)
  세션 관리, 명령 큐잉, MCP 도구 8개 노출
      ↕ MCP 프로토콜 (JSON-RPC over stdio)
[AI Agent] (Claude Code / Codex / Gemini CLI)
```

---

## 패키지 구조

### 신규 패키지

**packages/extension** — Chrome Extension (MV3)
- `src/content/index.ts` — content script 진입점 (DOM 감지, 런타임 주입, 스냅샷 루프)
- `src/content/dom-scanner.ts` — `data-webcli-*` 어노테이션 스캔
- `src/content/manifest-builder.ts` — ScannedTarget → WebCliManifest 변환
- `src/content/bridge.ts` — window.postMessage 브릿지
- `src/content/runtime-injector.ts` — main world 런타임 주입
- `src/runtime/page-runtime.ts` — main world에서 실행, IIFE로 빌드
- `src/background/service-worker.ts` — Native Messaging 연결, 메시지 중계
- `src/popup/popup.html + popup.ts` — UI 옵션 (포인터 애니메이션, aurora 등)
- `src/shared/config.ts` — chrome.storage.sync 설정 관리
- `src/shared/messages.ts` — 내부 메시지 타입

**packages/mcp-server** — Native Host + MCP 서버
- `bin/webcli-mcp.ts` — 진입점 (3가지 모드: install, --native-host, 기본 MCP)
- `src/index.ts` — createMcpServer (세션/명령/MCP 도구 통합)
- `src/native-messaging.ts` — 4바이트 길이 프리픽스 프로토콜
- `src/session-manager.ts` — 탭 단위 세션 + 스냅샷 캐시
- `src/command-queue.ts` — 명령 큐잉 + 타임아웃
- `src/tools.ts` — MCP 도구 정의 (JSON Schema)
- `src/install.ts` — 자동 설치 (Extension 빌드/복사, Native Host 설정)

### 변경된 패키지

**packages/core** — `native-messages.ts` 추가 (Extension ↔ Native Host 메시지 타입)
**packages/cli** — Companion REST API → MCP 클라이언트로 리팩터

### deprecated

**packages/build-core** — Extension content script가 DOM 스캔 + 런타임 주입 대체
**packages/browser-client** — Extension content script가 통신 대체

---

## 설치 및 실행

### 설치
```bash
cd /path/to/web-cli
npx tsx packages/mcp-server/bin/webcli-mcp.ts install --extension-id=<EXTENSION_ID>
```

이 명령이 하는 일:
1. Extension 빌드 → `~/.webcli-dom/extension/` 복사
2. MCP 서버 빌드 → `~/.webcli-dom/mcp-server/` 복사
3. Native Host 래퍼 스크립트 생성 (`~/.webcli-dom/native-host`)
4. Chrome NativeMessagingHosts 설정 자동 등록
5. Chrome 열기 시도

### Extension 로드
1. `chrome://extensions` → 개발자 모드 ON
2. "압축해제된 확장 프로그램을 로드합니다" → `~/.webcli-dom/extension/` 선택

### MCP 서버 등록 (전역)
`~/.mcp.json`:
```json
{
  "mcpServers": {
    "webcli": {
      "command": "node",
      "args": ["/Users/laonpeople/.webcli-dom/mcp-server/bin/webcli-mcp.js"]
    }
  }
}
```

### 웹앱에 어노테이션 추가
```html
<button data-webcli-action="click" data-webcli-name="Login" data-webcli-key="login-btn">
  로그인
</button>
```

---

## MCP 도구

| 도구 | 설명 | 필수 파라미터 |
|------|------|--------------|
| `webcli_sessions` | 활성 탭 목록 | - |
| `webcli_snapshot` | 페이지 스냅샷 | tabId (선택) |
| `webcli_act` | 클릭 | targetId |
| `webcli_fill` | 입력 | targetId, value |
| `webcli_drag` | 드래그 | sourceTargetId, destinationTargetId |
| `webcli_wait` | 상태 대기 | targetId, state |
| `webcli_guide` | 시각적 가이드 | targetId |
| `webcli_config` | 런타임 설정 | pointerAnimation, auroraGlow 등 |

---

## 해결한 문제들

### IIFE 빌드
- page-runtime.ts는 `<script>` 태그로 main world에 주입됨
- ES module이 아니라 IIFE로 빌드해야 "Cannot use import outside module" 에러 방지
- vite closeBundle 플러그인으로 별도 IIFE 빌드

### Extension context invalidation
- Extension 재로드 시 이전 content script의 `chrome.runtime.sendMessage`가 에러
- `safeSendMessage` 래퍼로 try-catch + contextValid 플래그로 스냅샷 루프 중지

### 프로세스 간 통신 (MCP 서버 ↔ Native Host)
- MCP 서버의 stdin/stdout → Claude Code가 MCP 프로토콜로 사용
- Native Host의 stdin/stdout → Chrome이 Native Messaging으로 사용
- 둘 다 stdio 점유 → TCP localhost로 해결
- MCP 서버가 랜덤 포트 열고 `~/.webcli-dom/port` 파일에 기록
- Native Host가 포트 파일 읽어서 TCP 연결

### Unix Socket → TCP 전환
- Unix Socket은 파일 lifecycle 문제 (다른 프로세스가 소켓 파일 삭제)
- TCP 포트는 파일 관리 불필요, 더 안정적

### 이전 MCP 서버 프로세스 충돌
- Claude Code 세션 종료 시 MCP 서버가 안 죽는 경우 있음
- 새 세션의 MCP 서버와 포트 파일이 충돌
- TCP 랜덤 포트로 해결 (각 세션이 새 포트)

---

## 테스트 현황

- **packages/core**: 10개 통과
- **packages/mcp-server**: 41개 통과 (유닛 37 + 통합 4)
- **packages/extension**: 27개 통과
- **합계: 78개 전부 통과**

---

## 검증 완료 항목

- [x] Extension → 페이지 런타임 주입 (main world)
- [x] DOM 스캔 (data-webcli-*) → 타겟 감지
- [x] 스냅샷 생성 + 주기적 전송 (800ms)
- [x] Extension content script ↔ page runtime (postMessage)
- [x] Extension service worker ↔ Native Host (Native Messaging)
- [x] Native Host ↔ MCP 서버 (TCP)
- [x] MCP 서버 → Claude Code (세션/스냅샷 조회)
- [x] Claude Code → 브라우저 명령 전송 (webcli_act → 클릭 성공)

---

## 남은 작업

### 높은 우선순위
- [ ] 포인터 애니메이션 / aurora glow 동작 안 됨 — `webcli_config`로 설정 전달은 되지만 실제 시각 효과가 나타나지 않음. 런타임의 `applyConfig` 경로 디버깅 필요
- [ ] MCP 서버 싱글톤 — 현재 Claude Code 세션마다 별도 MCP 서버가 뜨고 포트 파일을 덮어씀. 다중 세션 시 마지막 세션만 브라우저 데이터 수신 가능. 이미 떠있는 MCP 서버가 있으면 새로 안 띄우고 기존 포트에 연결하는 방식으로 변경 필요

### 중간 우선순위
- [ ] Codex, Gemini CLI에서 MCP 서버 연동 테스트
- [ ] Extension popup UI 실제 동작 테스트
- [ ] Chrome Web Store 배포

### 낮은 우선순위
- [ ] build-core, browser-client 패키지 완전 제거 (현재 deprecated)
