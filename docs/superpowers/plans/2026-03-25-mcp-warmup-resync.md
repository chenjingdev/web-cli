# MCP Warm-up / Resync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend daemon cold start 후 첫 MCP tool 호출이 자동으로 resync하여 빈 응답 없이 정상 결과를 반환하고, 10분 유휴 시 자동 종료한다.

**Architecture:** `AgagruneBackend.handleToolCall()` 최상단에 `ensureReady(3s)` 게이트를 추가한다. Session+snapshot이 없으면 `resync_request` 메시지를 extension에 보내고, content script가 `session_open` + 즉시 snapshot을 다시 전송한다. Idle shutdown은 `agrune-mcp.ts` daemon 레이어에서 `onActivity` 콜백으로 관리한다.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo (`@agrune/core`, `@agrune/mcp-server`, `packages/extension`)

---

### Task 1: `ResyncRequestMessage` 타입 추가 (`@agrune/core`)

**Files:**
- Modify: `packages/core/src/native-messages.ts:77-89` (NativeMessage union)
- Test: `packages/core/tests/native-messages.spec.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/tests/native-messages.spec.ts`에 테스트 추가:

```typescript
import { describe, it, expect } from 'vitest'
import type { NativeMessage } from '../src/native-messages'

// 기존 테스트는 유지하고 아래 추가

describe('ResyncRequestMessage', () => {
  it('is assignable to NativeMessage', () => {
    const msg: NativeMessage = { type: 'resync_request' }
    expect(msg.type).toBe('resync_request')
  })

  it('has isResyncRequest type guard', async () => {
    const { isResyncRequest } = await import('../src/native-messages')
    const msg: NativeMessage = { type: 'resync_request' }
    expect(isResyncRequest(msg)).toBe(true)
    expect(isResyncRequest({ type: 'ping' } as NativeMessage)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm test -- --run native-messages`
Expected: FAIL — `ResyncRequestMessage` type does not exist, `isResyncRequest` not exported

- [ ] **Step 3: Implement the type and guard**

`packages/core/src/native-messages.ts`에 추가:

```typescript
// PongMessage 뒤에 (line 67 부근)
export interface ResyncRequestMessage {
  type: 'resync_request'
}
```

NativeMessage union에 추가 (line 89 앞):

```typescript
  | ResyncRequestMessage
```

Type guard 함수 추가 (파일 끝):

```typescript
export function isResyncRequest(msg: NativeMessage): msg is ResyncRequestMessage {
  return msg.type === 'resync_request'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm test -- --run native-messages`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/native-messages.ts packages/core/tests/native-messages.spec.ts
git commit -m "feat(core): add ResyncRequestMessage to NativeMessage union"
```

---

### Task 2: `SessionManager` — `hasReadySession()` 및 `waitForSnapshot()` 추가

**Files:**
- Modify: `packages/mcp-server/src/session-manager.ts`
- Test: `packages/mcp-server/tests/session-manager.spec.ts`

- [ ] **Step 1: Write the failing tests**

`packages/mcp-server/tests/session-manager.spec.ts`에 추가:

```typescript
describe('hasReadySession', () => {
  it('returns false when no sessions', () => {
    const mgr = new SessionManager()
    expect(mgr.hasReadySession()).toBe(false)
  })

  it('returns false when sessions have no snapshot', () => {
    const mgr = new SessionManager()
    mgr.openSession(1, 'https://a.com', 'A')
    expect(mgr.hasReadySession()).toBe(false)
  })

  it('returns true when at least one session has a snapshot', () => {
    const mgr = new SessionManager()
    mgr.openSession(1, 'https://a.com', 'A')
    mgr.updateSnapshot(1, makeSnapshot())
    expect(mgr.hasReadySession()).toBe(true)
  })
})

describe('waitForSnapshot', () => {
  it('resolves immediately if a ready session already exists', async () => {
    const mgr = new SessionManager()
    mgr.openSession(1, 'https://a.com', 'A')
    mgr.updateSnapshot(1, makeSnapshot())
    const result = await mgr.waitForSnapshot(1000)
    expect(result).toBe(true)
  })

  it('resolves when a snapshot arrives within timeout', async () => {
    const mgr = new SessionManager()
    const promise = mgr.waitForSnapshot(3000)
    // Simulate session_open + snapshot_update arriving
    mgr.openSession(1, 'https://a.com', 'A')
    mgr.updateSnapshot(1, makeSnapshot())
    const result = await promise
    expect(result).toBe(true)
  })

  it('resolves false on timeout when no snapshot arrives', async () => {
    vi.useFakeTimers()
    const mgr = new SessionManager()
    const promise = mgr.waitForSnapshot(3000)
    await vi.advanceTimersByTimeAsync(3000)
    const result = await promise
    expect(result).toBe(false)
    vi.useRealTimers()
  })

  it('multiple waiters join the same promise', async () => {
    const mgr = new SessionManager()
    const p1 = mgr.waitForSnapshot(3000)
    const p2 = mgr.waitForSnapshot(3000)
    mgr.openSession(1, 'https://a.com', 'A')
    mgr.updateSnapshot(1, makeSnapshot())
    expect(await p1).toBe(true)
    expect(await p2).toBe(true)
  })
})
```

Note: 기존 테스트 파일의 import를 `import { describe, it, expect, vi } from 'vitest'`로 수정하여 `vi`를 추가해야 한다.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/mcp-server && pnpm test -- --run session-manager`
Expected: FAIL — `hasReadySession` and `waitForSnapshot` not defined

- [ ] **Step 3: Implement `hasReadySession()` and `waitForSnapshot()`**

`packages/mcp-server/src/session-manager.ts`에 4가지 incremental 변경을 적용한다:

**변경 A** — 클래스에 `snapshotWaiters` 필드 추가 (`private sessions = ...` 뒤):

```typescript
  private snapshotWaiters: Array<() => void> = []
```

**변경 B** — 기존 `updateSnapshot()` 메서드에 `this.notifyWaiters()` 호출 추가:

```typescript
  updateSnapshot(tabId: number, snapshot: PageSnapshot): void {
    const session = this.sessions.get(tabId)
    if (session) {
      session.snapshot = snapshot
      this.notifyWaiters()
    }
  }
```

**변경 C** — `hasReadySession()` 및 `waitForSnapshot()` 메서드 추가 (`getSnapshot()` 뒤):

```typescript
  hasReadySession(): boolean {
    for (const session of this.sessions.values()) {
      if (session.snapshot !== null) return true
    }
    return false
  }

  waitForSnapshot(timeoutMs: number): Promise<boolean> {
    if (this.hasReadySession()) return Promise.resolve(true)

    return new Promise<boolean>((resolve) => {
      const onReady = () => {
        clearTimeout(timer)
        resolve(true)
      }
      const timer = setTimeout(() => {
        const idx = this.snapshotWaiters.indexOf(onReady)
        if (idx !== -1) this.snapshotWaiters.splice(idx, 1)
        resolve(false)
      }, timeoutMs)
      this.snapshotWaiters.push(onReady)
    })
  }
```

**변경 D** — `notifyWaiters()` private 메서드 추가 (클래스 끝):

```typescript
  private notifyWaiters(): void {
    if (!this.hasReadySession()) return
    const waiters = this.snapshotWaiters.splice(0)
    for (const waiter of waiters) waiter()
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/mcp-server && pnpm test -- --run session-manager`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/session-manager.ts packages/mcp-server/tests/session-manager.spec.ts
git commit -m "feat(mcp-server): add hasReadySession and waitForSnapshot to SessionManager"
```

---

### Task 3: `CommandQueue.hasSender()` 접근자 추가

**Files:**
- Modify: `packages/mcp-server/src/command-queue.ts`
- Test: `packages/mcp-server/tests/command-queue.spec.ts`

- [ ] **Step 1: Write the failing test**

`packages/mcp-server/tests/command-queue.spec.ts`에 추가:

```typescript
describe('hasSender', () => {
  it('returns false when no sender is set', () => {
    const queue = new CommandQueue()
    expect(queue.hasSender()).toBe(false)
  })

  it('returns true when a sender is set', () => {
    const queue = new CommandQueue()
    queue.setSender(vi.fn())
    expect(queue.hasSender()).toBe(true)
  })

  it('returns false after sender is cleared', () => {
    const queue = new CommandQueue()
    queue.setSender(vi.fn())
    queue.setSender(null)
    expect(queue.hasSender()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/mcp-server && pnpm test -- --run command-queue`
Expected: FAIL — `hasSender` not defined

- [ ] **Step 3: Implement `hasSender()`**

`packages/mcp-server/src/command-queue.ts`의 `CommandQueue` 클래스에 추가:

```typescript
  hasSender(): boolean {
    return this.sender !== null
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/mcp-server && pnpm test -- --run command-queue`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/command-queue.ts packages/mcp-server/tests/command-queue.spec.ts
git commit -m "feat(mcp-server): add hasSender accessor to CommandQueue"
```

---

### Task 4: `AgagruneBackend.ensureReady()` + `onActivity` 콜백 구현

**Files:**
- Modify: `packages/mcp-server/src/backend.ts`
- Test: `packages/mcp-server/tests/backend.spec.ts`

- [ ] **Step 1: Write the failing tests**

`packages/mcp-server/tests/backend.spec.ts`에 추가:

```typescript
describe('ensureReady', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns error when native sender is null', async () => {
    const backend = new AgagruneBackend()
    // No sender set
    const result = await backend.handleToolCall('agrune_snapshot', {})
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Native host not connected')
  })

  it('passes through immediately when session+snapshot exists', async () => {
    const backend = new AgagruneBackend()
    backend.setNativeSender(vi.fn())
    backend.handleNativeMessage({
      type: 'session_open', tabId: 1, url: 'https://a.com', title: 'A',
    } as NativeMessage)
    backend.handleNativeMessage({
      type: 'snapshot_update', tabId: 1,
      snapshot: { version: 1, capturedAt: Date.now(), url: 'https://a.com', title: 'A', groups: [], targets: [] },
    } as NativeMessage)

    const result = await backend.handleToolCall('agrune_sessions', {})
    expect(result.isError).toBeFalsy()
  })

  it('sends resync_request and waits for snapshot when no session exists', async () => {
    const sent: NativeMessage[] = []
    const backend = new AgagruneBackend()
    backend.setNativeSender((msg) => sent.push(msg))

    const promise = backend.handleToolCall('agrune_snapshot', {})

    // ensureReady should have sent resync_request
    expect(sent).toContainEqual({ type: 'resync_request' })

    // Simulate resync response
    backend.handleNativeMessage({
      type: 'session_open', tabId: 1, url: 'https://a.com', title: 'A',
    } as NativeMessage)
    backend.handleNativeMessage({
      type: 'snapshot_update', tabId: 1,
      snapshot: { version: 1, capturedAt: Date.now(), url: 'https://a.com', title: 'A', groups: [], targets: [] },
    } as NativeMessage)

    const result = await promise
    expect(result.isError).toBeFalsy()
  })

  it('deduplicates concurrent resync_request messages', async () => {
    const sent: NativeMessage[] = []
    const backend = new AgagruneBackend()
    backend.setNativeSender((msg) => sent.push(msg))

    // Fire two concurrent tool calls — should only send one resync_request
    const p1 = backend.handleToolCall('agrune_sessions', {})
    const p2 = backend.handleToolCall('agrune_snapshot', {})

    const resyncCount = sent.filter(m => m.type === 'resync_request').length
    expect(resyncCount).toBe(1)

    // Resolve both by providing session+snapshot
    backend.handleNativeMessage({
      type: 'session_open', tabId: 1, url: 'https://a.com', title: 'A',
    } as NativeMessage)
    backend.handleNativeMessage({
      type: 'snapshot_update', tabId: 1,
      snapshot: { version: 1, capturedAt: Date.now(), url: 'https://a.com', title: 'A', groups: [], targets: [] },
    } as NativeMessage)

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.isError).toBeFalsy()
    expect(r2.isError).toBeFalsy()
  })

  it('returns timeout error when no snapshot arrives within 3s', async () => {
    const backend = new AgagruneBackend()
    backend.setNativeSender(vi.fn())

    const promise = backend.handleToolCall('agrune_snapshot', {})
    await vi.advanceTimersByTimeAsync(3000)

    const result = await promise
    expect(result.isError).toBe(true)
    expect(result.text).toContain('No browser sessions available')
  })

  it('skips ensureReady for agrune_config even without a native sender', async () => {
    const backend = new AgagruneBackend()
    // No sender set — ensureReady would return "Native host not connected" error,
    // but agrune_config should skip ensureReady entirely
    const result = await backend.handleToolCall('agrune_config', { autoScroll: true })
    expect(result.isError).toBeFalsy()
    expect(result.text).toBe('Configuration updated.')
  })
})

describe('onActivity callback', () => {
  it('calls onActivity on each handleToolCall', async () => {
    const backend = new AgagruneBackend()
    const onActivity = vi.fn()
    backend.onActivity = onActivity
    backend.setNativeSender(vi.fn())
    backend.handleNativeMessage({
      type: 'session_open', tabId: 1, url: 'https://a.com', title: 'A',
    } as NativeMessage)
    backend.handleNativeMessage({
      type: 'snapshot_update', tabId: 1,
      snapshot: { version: 1, capturedAt: Date.now(), url: 'https://a.com', title: 'A', groups: [], targets: [] },
    } as NativeMessage)

    await backend.handleToolCall('agrune_sessions', {})
    expect(onActivity).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/mcp-server && pnpm test -- --run backend`
Expected: FAIL — `ensureReady` not implemented, `onActivity` not defined

- [ ] **Step 3: Implement `ensureReady()` and `onActivity`**

`packages/mcp-server/src/backend.ts`에 5가지 incremental 변경을 적용한다:

**변경 A** — 상수 추가. 기존 `const ACTIVITY_TAIL_BLOCK_MS = 5_000` 뒤에:

```typescript
const ENSURE_READY_TIMEOUT_MS = 3_000
```

**변경 B** — 클래스 필드 추가. `private lastAgentActivityAt: number | null = null` 뒤에:

```typescript
  onActivity: (() => void) | null = null
  private pendingResync: Promise<boolean> | null = null
```

**변경 C** — `handleNativeMessage` switch에 `resync_request` no-op case 추가. 기존 `case 'pong':` 앞에:

```typescript
      case 'resync_request':
```

이렇게 하면 기존 `case 'pong': case 'status_response': break` 와 함께 fall-through로 처리된다.

**변경 D** — `handleToolCall()` 메서드 시작 부분 수정. 기존 `this.lastAgentActivityAt = Date.now()` 뒤, `switch (name) {` 앞에 삽입:

```typescript
    this.onActivity?.()

    if (name !== 'agrune_config') {
      const readyError = await this.ensureReady()
      if (readyError) return readyError
    }
```

기존 switch문 내부의 모든 case (`agrune_sessions`, `agrune_snapshot` 등)는 그대로 유지한다.

**변경 E** — `ensureReady()` private 메서드 추가. `withActivityBlocks` 메서드 앞에:

```typescript
  private async ensureReady(): Promise<ToolHandlerResult | null> {
    if (!this.commands.hasSender()) {
      return this.textResult(
        'Native host not connected. Ensure the browser extension is installed and running.',
        true,
      )
    }

    if (this.sessions.hasReadySession()) return null

    // Dedup: join existing resync if already in progress
    if (!this.pendingResync) {
      this.commands.sendRaw({ type: 'resync_request' } as NativeMessage)
      this.pendingResync = this.sessions.waitForSnapshot(ENSURE_READY_TIMEOUT_MS)
        .finally(() => { this.pendingResync = null })
    }

    const ready = await this.pendingResync
    if (!ready) {
      return this.textResult(
        'No browser sessions available. Ensure a page with agrune annotations is open.',
        true,
      )
    }

    return null
  }
```

Note: 기존 switch문 내부의 `agrune_sessions`, `agrune_snapshot` 등의 tool별 "No active sessions" 에러 분기는 그대로 유지한다. `ensureReady`가 session+snapshot 존재만 보장하고, 특정 tabId 해석은 여전히 각 tool이 담당한다.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/mcp-server && pnpm test -- --run backend`
Expected: ALL PASS

- [ ] **Step 5: Run all mcp-server tests**

Run: `cd packages/mcp-server && pnpm test`
Expected: ALL PASS — 기존 테스트에서는 이미 session+snapshot을 세팅한 후 tool을 호출하므로 `ensureReady`가 즉시 통과함

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-server/src/backend.ts packages/mcp-server/tests/backend.spec.ts
git commit -m "feat(mcp-server): add ensureReady gate and onActivity callback to AgagruneBackend"
```

---

### Task 5: Background message router — `resync_request` 라우팅

**Files:**
- Modify: `packages/extension/src/background/message-router.ts:22-36`
- Test: `packages/extension/tests/background/message-router.spec.ts`

- [ ] **Step 1: Write the failing test**

`packages/extension/tests/background/message-router.spec.ts`에 추가:

```typescript
  it('broadcasts resync to all tabs when receiving resync_request from native host', () => {
    const chrome = createChromeMock()
    const controller = {
      postMessage: vi.fn(),
      requestStatus: vi.fn(),
      reconnect: vi.fn(),
      getStatus: vi.fn(() => ({
        hostName: 'com.agrune.agrune',
        phase: 'connected' as NativeHostPhase,
        connected: true,
        lastError: null,
      })),
    }
    const broadcaster = {
      broadcastToAllTabs: vi.fn(),
      sendToTab: vi.fn(),
      broadcastConfig: vi.fn(),
      broadcastAgentActivity: vi.fn(),
      broadcastNativeHostStatus: vi.fn(),
    }

    const router = createBackgroundMessageRouter({
      api: chrome.chromeMock,
      controller,
      broadcaster,
    })
    router.register()

    router.handleNativeHostMessage({ type: 'resync_request' } as never)

    expect(broadcaster.broadcastToAllTabs).toHaveBeenCalledWith({ type: 'resync' })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && pnpm test -- --run message-router`
Expected: FAIL — `resync_request` case not handled, `broadcastToAllTabs` not called

- [ ] **Step 3: Implement the routing**

`packages/extension/src/background/message-router.ts`의 `handleNativeHostMessage` switch에 추가 (line 34, `break` 뒤):

```typescript
      case 'resync_request':
        broadcaster.broadcastToAllTabs({ type: 'resync' })
        break
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && pnpm test -- --run message-router`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/background/message-router.ts packages/extension/tests/background/message-router.spec.ts
git commit -m "feat(extension): route resync_request to all tabs via broadcastToAllTabs"
```

---

### Task 6: Content script — 즉시 snapshot 요청 + resync 핸들러

**Files:**
- Modify: `packages/extension/src/content/index.ts:52-55,71-85`
- Test: `packages/extension/tests/content-init.spec.ts`

- [ ] **Step 1: Write the failing tests**

`packages/extension/tests/content-init.spec.ts`에 추가:

```typescript
  it('sends immediate request_snapshot on runtime_ready before starting loop', async () => {
    await import('../src/content/index')

    // Simulate runtime_ready
    mocks.getBridgeHandler()?.('runtime_ready', {})

    // First call should be immediate request_snapshot
    expect(mocks.sendToBridge).toHaveBeenCalledWith('request_snapshot', {})
    expect(mocks.syncStoredConfigToRuntime).toHaveBeenCalled()
  })

  it('handles resync message by re-sending session_open and requesting snapshot', async () => {
    await import('../src/content/index')

    const runtimeSendMessage = (globalThis as unknown as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } }).chrome.runtime.sendMessage
    const onMessageListener = (globalThis as unknown as { chrome: { runtime: { onMessage: { addListener: ReturnType<typeof vi.fn> } } } }).chrome.runtime.onMessage.addListener

    // Get the listener that was registered
    const listener = onMessageListener.mock.calls[0]?.[0]
    expect(listener).toBeDefined()

    // Emit resync message
    listener({ type: 'resync' })

    // Should re-send session_open
    expect(runtimeSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session_open' }),
    )

    // Should request immediate snapshot
    expect(mocks.sendToBridge).toHaveBeenCalledWith('request_snapshot', {})
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && pnpm test -- --run content-init`
Expected: FAIL — no immediate `request_snapshot` on `runtime_ready`, no `resync` handler

- [ ] **Step 3: Implement the changes**

`packages/extension/src/content/index.ts`:

**Change 1** — `runtime_ready` 핸들러에 즉시 snapshot 요청 추가 (line 52-55):

```typescript
    if (type === 'runtime_ready') {
      sendToBridge('request_snapshot', {})
      startSnapshotLoop()
      void syncStoredConfigToRuntime(sendToBridge)
    }
```

**Change 2** — `onMessage` 리스너에 `resync` 핸들러 추가 (line 83, `agent_activity` 블록 뒤):

```typescript
    if (msg.type === 'resync') {
      safeSendMessage({
        type: 'session_open',
        url: location.href,
        title: document.title,
      })
      sendToBridge('request_snapshot', {})
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && pnpm test -- --run content-init`
Expected: ALL PASS

- [ ] **Step 5: Run all extension tests**

Run: `cd packages/extension && pnpm test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/content/index.ts packages/extension/tests/content-init.spec.ts
git commit -m "feat(extension): add immediate snapshot on runtime_ready and resync handler"
```

---

### Task 7: Idle shutdown in `agrune-mcp.ts`

**Files:**
- Modify: `packages/mcp-server/bin/agrune-mcp.ts:76-193` (`--backend-daemon` 섹션)

이 파일은 daemon entry point이므로 단위 테스트 대상이 아니다. Idle 타이머의 핵심 로직은 `onActivity` 콜백(Task 4에서 테스트 완료)에 의존하므로, 여기서는 배선만 추가한다.

- [ ] **Step 1: Add idle timer wiring**

`packages/mcp-server/bin/agrune-mcp.ts`의 `--backend-daemon` 섹션에 추가.

TCP 서버 listen 성공 후 (line 191, `resolve()` 뒤):

```typescript
  // Idle shutdown: exit after 10 minutes of no tool activity
  const IDLE_TIMEOUT_MS = 10 * 60 * 1000

  const shutdown = () => {
    process.stderr.write('[agrune-backend] idle timeout — shutting down\n')
    tcpServer.close()
    process.exit(0)
  }

  let idleTimer = setTimeout(shutdown, IDLE_TIMEOUT_MS)

  backend.onActivity = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(shutdown, IDLE_TIMEOUT_MS)
  }
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/mcp-server && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Run all tests to ensure nothing broke**

Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-server/bin/agrune-mcp.ts
git commit -m "feat(mcp-server): add 10-minute idle shutdown to backend daemon"
```

---

### Task 8: Typecheck + 전체 테스트 통과 확인

**Files:** None (verification only)

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: No errors across all packages

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: ALL PASS across all packages

- [ ] **Step 3: Build check**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Final commit (if any fixes needed)**

Fix any issues found and commit with appropriate message.
