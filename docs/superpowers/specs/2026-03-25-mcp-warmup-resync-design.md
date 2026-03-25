# MCP Warm-up / Resync Design

작성일: 2026-03-25

## 문제

Backend daemon 재기동 후 in-memory session/snapshot이 비어있어 첫 `rune_snapshot` 호출이 빈 결과 또는 에러를 반환한다. Content script는 초기 진입 시에만 `session_open`을 보내고, 이후에는 주기적 snapshot만 전송하므로 cold start 직후 복구 경로가 없다.

## 설계 원칙

- **Lazy on-demand**: tool 호출 시점에만 연결/resync 수행. 불필요한 백그라운드 모니터링 없음.
- **Backend 중심 오케스트레이션**: 준비 로직을 `RuneBackend.ensureReady()`에 집중.
- **리소스 효율**: 10분 유휴 시 자동 종료, 다음 호출 시 재기동.

## 접근 방식: Backend 중심 `ensureReady`

모든 준비 로직을 backend의 `ensureReady()`에 집중시킨다. Extension은 `resync_request` 핸들러만 추가.

## 상세 설계

### 1. 메시지 프로토콜 확장

`ResyncRequestMessage` 타입 1개를 `@runeai/core`의 `NativeMessage` union에 추가한다.

```typescript
// native-messages.ts
interface ResyncRequestMessage {
  type: 'resync_request'
}
```

별도의 `resync_response`는 만들지 않는다. Backend는 기존 `session_open` + `snapshot_update` 도착으로 준비 완료를 판단한다.

`resync_request`는 backend → extension 방향 전용 메시지다. `backend.ts`의 `handleNativeMessage` switch에는 `case 'resync_request': break` no-op을 추가하여 TypeScript 완전성을 보장한다.

Background → content script으로 전달되는 `{ type: 'resync' }` 메시지는 기존 content script onMessage 리스너의 비정형 메시지 패턴(`msg.type` 직접 비교)을 따른다. `BackgroundRuntimeMessage` union에는 추가하지 않는다 (이 union은 content → background 방향 전용).

### 2. `ensureReady()` — Backend 준비 게이트

`RuneBackend`의 `handleToolCall()` 최상단에서 `ensureReady()`를 호출한다. 개별 call site가 아닌 `handleToolCall` 내부에서 일괄 처리.

**로직:**

1. native sender가 null이면 즉시 에러: `"Native host not connected. Ensure the browser extension is installed and running."`
2. 이미 session + snapshot이 있으면 즉시 통과
3. 없으면 `resync_request` 전송 (`commands.sendRaw()`)
4. `snapshot_update` 도착을 최대 3초 대기
5. 3초 내 도착하면 통과
6. 3초 초과 시 에러 반환: `"No browser sessions available. Ensure a page with rune annotations is open."`

**적용 범위:**

- 적용: `rune_sessions`, `rune_snapshot`, `rune_act`, `rune_fill`, `rune_drag`, `rune_wait`, `rune_guide` — 모두 동일한 readiness 조건(session + snapshot)을 사용한다. `rune_sessions`도 snapshot까지 대기하는데, 이는 snapshot이 있어야 유의미한 세션 정보이고 3초 timeout 안에 함께 도착하기 때문이다.
- 제외: `rune_config` (세션 없이도 설정 가능)

**구현:**

- `SessionManager`에 `hasReadySession(): boolean`과 `waitForSnapshot(timeoutMs): Promise<boolean>` 추가
- `hasReadySession()`은 session이 하나 이상 있고, 그 중 snapshot이 non-null인 것이 있으면 true
- `waitForSnapshot()`은 `updateSnapshot()` 호출 시 대기 중인 Promise를 resolve
- `openSession()` 호출 시에도 snapshot을 기다리는 것은 아니지만, 이미 도착한 snapshot이 있으면 resolve
- 이미 resync 대기 중이면 새 `resync_request`를 보내지 않고 기존 Promise에 합류 (중복 방지)

**메시지 순서 안전성:** Content script는 resync 시 `session_open`을 `safeSendMessage`로 먼저 보내고, 그 다음 `sendToBridge('request_snapshot')`을 호출한다. `session_open`은 `chrome.runtime.sendMessage` → background → native host → backend 경로를, snapshot은 bridge → page runtime → bridge → content → `chrome.runtime.sendMessage` → background → native host → backend 경로를 거친다. Snapshot 경로가 page runtime 왕복을 포함하므로 항상 더 느리다. 따라서 `session_open`이 `snapshot_update`보다 먼저 backend에 도착한다.

### 3. Content Script 변경

**즉시 스냅샷 요청:**

`runtime_ready` 시점에 `request_snapshot`을 즉시 1회 발사하여 첫 snapshot 지연(~800ms)을 제거한다.

```typescript
// content/index.ts — runtime_ready 핸들러
if (type === 'runtime_ready') {
  sendToBridge('request_snapshot', {})  // 즉시 1회
  startSnapshotLoop()
  void syncStoredConfigToRuntime(sendToBridge)
}
```

**Resync 핸들러:**

Background로부터 `resync` 메시지를 받으면:

- `session_open` 재전송 (현재 URL/title)
- `request_snapshot` 즉시 1회 발사

```typescript
// content/index.ts — onMessage 리스너에 추가
if (msg.type === 'resync') {
  safeSendMessage({
    type: 'session_open',
    url: location.href,
    title: document.title,
  })
  sendToBridge('request_snapshot', {})
}
```

Runtime 재주입이나 bridge 재설정은 불필요. 이미 돌고 있는 상태에서 session/snapshot만 다시 보내면 됨.

**한계:** `contextValid === false`인 탭(extension context가 무효화된 경우)은 resync 불가. `safeSendMessage`가 메시지를 drop하고, `broadcastToAllTabs`의 `sendToTab`도 silent fail한다. 이런 탭은 페이지 새로고침이 필요하며, 이는 알려진 한계로 별도 처리하지 않는다.

### 4. Background 메시지 라우팅

`message-router.ts`의 `handleNativeHostMessage`에 case 1개 추가:

```typescript
case 'resync_request':
  broadcaster.broadcastToAllTabs({ type: 'resync' })
  break
```

`TabBroadcaster` 변경 없음. 기존 `broadcastToAllTabs()` 활용.

### 5. Idle Shutdown

10분 유휴 시 backend daemon 프로세스를 자동 종료한다.

**구현 위치:** `rune-mcp.ts`의 `--backend-daemon` 섹션. `RuneBackend`는 라이브러리 클래스이므로 `process.exit()`을 직접 호출하지 않는다.

**메커니즘:**

- `RuneBackend`에 `onActivity` 콜백을 추가한다. `handleToolCall()` 진입 시 호출.
- `rune-mcp.ts`에서 `onActivity` 콜백에 idle 타이머 리셋 로직을 연결한다.
- 10분 경과 시 TCP 서버를 닫고 `process.exit(0)`.
- 종료 전 별도 cleanup 없음 (모든 상태가 in-memory, 다음 기동 시 resync로 복구).
- 다음 MCP tool 호출 시 MCP frontend의 `ensureBackendDaemon()`이 프로세스를 다시 기동 → `ensureReady()` → resync.

```typescript
// rune-mcp.ts — --backend-daemon 섹션
const IDLE_TIMEOUT_MS = 10 * 60 * 1000

let idleTimer = setTimeout(() => shutdown(), IDLE_TIMEOUT_MS)

backend.onActivity = () => {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => shutdown(), IDLE_TIMEOUT_MS)
}

function shutdown() {
  tcpServer.close()
  process.exit(0)
}
```

## 메시지 흐름 요약

```
MCP tool 호출
  → ensureBackendDaemon() (MCP frontend — 이미 있으면 skip)
  → backend.handleToolCall()
    → ensureReady(3s)
      → native sender null? → 에러 "Native host not connected"
      → session+snapshot 있음? → 즉시 통과
      → 없음?
        → resync_request 전송 (backend → native host → background)
        → background: broadcastToAllTabs({ type: 'resync' })
        → content script: session_open 재전송 + request_snapshot 즉시 발사
        → page runtime: snapshot 생성 → content → background → native host → backend
        → SessionManager.updateSnapshot() → 대기 중인 Promise resolve
        → ensureReady 통과
    → tool 로직 실행
    → onActivity 콜백 → idle 타이머 리셋 (10분)
```

## 변경 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `packages/core/src/native-messages.ts` | `ResyncRequestMessage` 타입 추가, `NativeMessage` union 확장 |
| `packages/mcp-server/src/backend.ts` | `ensureReady()`, `onActivity` 콜백, `handleToolCall` 진입점 수정, `handleNativeMessage`에 `resync_request` no-op case |
| `packages/mcp-server/src/session-manager.ts` | `hasReadySession()`, `waitForSnapshot()` 추가 |
| `packages/mcp-server/bin/rune-mcp.ts` | `--backend-daemon` 섹션에 idle 타이머 연결 |
| `packages/extension/src/background/message-router.ts` | `resync_request` → `broadcastToAllTabs` 라우팅 |
| `packages/extension/src/content/index.ts` | 즉시 snapshot 요청, `resync` 핸들러 |

## 엣지 케이스 및 한계

- **Extension context 무효화된 탭:** resync 메시지를 수신할 수 없으므로 페이지 새로고침 필요. 시스템 장애가 아닌 알려진 한계.
- **Rune annotation이 없는 탭:** `init()`에서 `hasAnnotations()` 체크에 의해 content script가 동작하지 않으므로, resync broadcast를 받아도 반응하지 않음. 정상 동작.
- **동시 다중 tool 호출:** `ensureReady()`의 중복 방지 로직에 의해 하나의 resync_request만 전송되고, 모든 대기자가 동일한 Promise에 합류.
- **Native host 미연결 상태:** `ensureReady()`에서 sender null 체크로 즉시 에러 반환. 3초 무의미 대기 방지.

## 완료 기준

- Backend를 내린 뒤 다시 띄워도 첫 `rune_snapshot`이 빈 응답 없이 정상 결과를 돌려준다.
- 준비 중에는 무한 대기하지 않고, 3초 timeout 시 원인이 드러나는 에러를 반환한다.
- Agent 프롬프트나 수동 재시도 없이 시스템 내부 로직만으로 cold start를 흡수한다.
- 10분 유휴 후 backend가 자동 종료되고, 다음 tool 호출 시 자연스럽게 복구된다.
- 모든 tool(`rune_sessions`, `rune_snapshot`, `rune_act`, `rune_fill`, `rune_drag`, `rune_wait`, `rune_guide`)이 동일한 준비 게이트를 거친다.
