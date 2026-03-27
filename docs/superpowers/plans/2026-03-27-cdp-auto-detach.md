# CDP 디버거 자동 해제 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP 활동 기반 idle timer로 CDP 디버거를 자동 해제하여 info bar를 소멸시킴

**Architecture:** cdp-handler에 per-tab idle timer 추가, message-router에서 command_request 시 notifyActivity 호출

**Tech Stack:** TypeScript, Chrome Extensions API

**Spec:** `docs/superpowers/specs/2026-03-27-cdp-auto-detach-design.md`

---

## 파일 구조

| 파일 | 변경 | 역할 |
|------|------|------|
| `packages/extension/src/background/cdp-handler.ts` | 수정 | idle timer + notifyActivity 추가 |
| `packages/extension/src/background/message-router.ts` | 수정 | command_request 시 notifyActivity 호출 |

---

### Task 1: cdp-handler에 idle timer 추가

**Files:**
- Modify: `packages/extension/src/background/cdp-handler.ts`

- [ ] **Step 1: CdpHandler 인터페이스에 notifyActivity 추가**

```typescript
export interface CdpHandler {
  handleRequest(tabId: number, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
  notifyActivity(tabId: number): void
  detach(tabId: number): void
  detachAll(): void
  isAttached(tabId: number): boolean
  register(): void
}
```

- [ ] **Step 2: createCdpHandler 내부에 idle timer 로직 추가**

`attachedTabs` 선언 아래에 추가:

```typescript
const IDLE_TIMEOUT_MS = 120_000 // 2 minutes
const idleTimers = new Map<number, ReturnType<typeof setTimeout>>()

function resetIdleTimer(tabId: number): void {
  const existing = idleTimers.get(tabId)
  if (existing != null) clearTimeout(existing)
  idleTimers.set(tabId, setTimeout(() => {
    idleTimers.delete(tabId)
    detach(tabId)
  }, IDLE_TIMEOUT_MS))
}

function clearIdleTimer(tabId: number): void {
  const existing = idleTimers.get(tabId)
  if (existing != null) {
    clearTimeout(existing)
    idleTimers.delete(tabId)
  }
}

function notifyActivity(tabId: number): void {
  if (attachedTabs.has(tabId)) resetIdleTimer(tabId)
}
```

- [ ] **Step 3: handleRequest에서 notifyActivity 호출**

```typescript
async function handleRequest(
  tabId: number,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await ensureAttached(tabId)
  resetIdleTimer(tabId)
  const result = await api.debugger.sendCommand({ tabId }, method, params)
  return (result ?? {}) as Record<string, unknown>
}
```

- [ ] **Step 4: detach에서 idle timer 정리**

```typescript
function detach(tabId: number): void {
  if (!attachedTabs.has(tabId)) return
  attachedTabs.delete(tabId)
  clearIdleTimer(tabId)
  api.debugger.detach({ tabId }).catch(() => {})
}
```

- [ ] **Step 5: return 객체에 notifyActivity 추가**

```typescript
return { handleRequest, notifyActivity, detach, detachAll, isAttached: (id) => attachedTabs.has(id), register }
```

---

### Task 2: message-router에서 notifyActivity 호출

**Files:**
- Modify: `packages/extension/src/background/message-router.ts`

- [ ] **Step 1: cdpHandler 옵션 타입 업데이트**

```typescript
cdpHandler?: Pick<CdpHandler, 'handleRequest' | 'notifyActivity'>
```

- [ ] **Step 2: command_request 케이스에서 notifyActivity 호출**

```typescript
case 'command_request':
  if (typeof msg.tabId === 'number') {
    cdpHandler?.notifyActivity(msg.tabId)
    broadcaster.sendToTab(msg.tabId, msg as unknown as Record<string, unknown>)
  }
  break
```

---

### Task 3: 타입체크

- [ ] **Step 1: 타입체크 실행**

Run: `cd packages/extension && pnpm typecheck`

Expected: 에러 없음

---

### Task 4: 커밋

- [ ] **Step 1: 변경 파일 스테이징 및 커밋**

```bash
git add packages/extension/src/background/cdp-handler.ts packages/extension/src/background/message-router.ts docs/superpowers/specs/2026-03-27-cdp-auto-detach-design.md docs/superpowers/plans/2026-03-27-cdp-auto-detach.md
git commit -m "feat(extension): auto-detach CDP debugger after 2min idle

Track MCP activity (command requests + CDP calls) per tab. When no
activity for 2 minutes, automatically detach the debugger to dismiss
the Chrome info bar. Next MCP request re-attaches transparently."
```
