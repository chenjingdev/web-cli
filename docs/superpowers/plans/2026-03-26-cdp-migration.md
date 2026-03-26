# CDP Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all synthetic event dispatch with CDP `Input.dispatchMouseEvent` for `isTrusted:true` events, and decompose `page-agent-runtime.ts` into focused modules.

**Architecture:** Page runtime orchestrates cursor animation + CDP event timing. Background service worker acts as thin CDP proxy via `chrome.debugger`. Communication uses bridge messages (`cdp_request`/`cdp_response`/`cdp_event`) through content script relay.

**Tech Stack:** TypeScript, Chrome Extension Manifest V3, Chrome DevTools Protocol, Vitest, pnpm monorepo

**Spec:** `docs/superpowers/specs/2026-03-26-cdp-migration-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/extension/src/background/cdp-handler.ts` | CDP lifecycle (attach/detach) + command execution via chrome.debugger |
| `packages/build-core/src/runtime/cdp-client.ts` | Page-side CDP request/response wrapper over bridge |
| `packages/build-core/src/runtime/event-sequences.ts` | CDP-based event sequences (click, drag, etc.) |
| `packages/build-core/src/runtime/cursor-animator.ts` | Cursor overlay DOM creation, animation, press/release |
| `packages/build-core/src/runtime/command-handlers.ts` | Command orchestration (act, drag, fill, pointer, wait, guide, read) |
| `packages/build-core/src/runtime/snapshot.ts` | Snapshot capture, DOM scan, rect collection |
| `packages/build-core/src/runtime/dom-utils.ts` | Coordinate resolution, visibility, scroll, element queries |
| `packages/extension/tests/background/cdp-handler.spec.ts` | CDP handler tests |
| `packages/build-core/tests/cdp-client.spec.ts` | CDP client tests |
| `packages/build-core/tests/event-sequences.spec.ts` | Event sequence tests |

### Modified Files
| File | Changes |
|------|---------|
| `packages/core/src/native-messages.ts` | Add CdpRequest/CdpResponse/CdpEvent message types |
| `packages/core/src/index.ts` | Export new types |
| `packages/extension/manifest.json` | Add `"debugger"` permission |
| `packages/extension/src/background/service-worker.ts` | Register CDP handler |
| `packages/extension/src/background/message-router.ts` | Route cdp_request/cdp_response/cdp_event |
| `packages/extension/src/background/messages.ts` | Add CdpRequestMessage to BackgroundRuntimeMessage union |
| `packages/extension/src/content/bridge.ts` | Add cdp message relay helpers |
| `packages/extension/src/content/index.ts` | Wire CDP bridge relay |
| `packages/extension/src/runtime/page-runtime.ts` | Route cdp_response/cdp_event to runtime |
| `packages/build-core/src/types.ts` | Add `postMessage` callback to AgagruneRuntimeOptions |
| `packages/build-core/src/runtime/page-agent-runtime.ts` | Slim to entry point, delegate to modules |
| `packages/build-core/src/runtime/action-queue.ts` | No changes (keep as-is) |

---

## Phase 1: Infrastructure

### Task 1: Backup & Branch

- [ ] **Step 1: Create backup branch from current main**

```bash
cd /Users/chenjing/dev/agrune/agrune
git branch backup/pre-cdp-migration main
```

- [ ] **Step 2: Create feature branch**

```bash
git checkout -b feat/cdp-migration
```

- [ ] **Step 3: Verify**

```bash
git branch --list 'backup/*' 'feat/*'
```
Expected: `backup/pre-cdp-migration` and `feat/cdp-migration` listed.

---

### Task 2: Core Message Types

**Files:**
- Modify: `packages/core/src/native-messages.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add CDP message types to native-messages.ts**

After the existing message interfaces (around line 71), add:

```typescript
export interface CdpRequestMessage {
  type: 'cdp_request'
  tabId?: number
  requestId: string
  method: string
  params: Record<string, unknown>
}

export interface CdpResponseMessage {
  type: 'cdp_response'
  requestId: string
  result?: Record<string, unknown>
  error?: string
}

export interface CdpEventMessage {
  type: 'cdp_event'
  method: string
  params: Record<string, unknown>
}
```

- [ ] **Step 2: Add to NativeMessage union type**

Add `CdpRequestMessage | CdpResponseMessage | CdpEventMessage` to the union.

- [ ] **Step 3: Add type guard functions**

```typescript
export function isCdpRequest(msg: NativeMessage): msg is CdpRequestMessage {
  return msg.type === 'cdp_request'
}
export function isCdpResponse(msg: NativeMessage): msg is CdpResponseMessage {
  return msg.type === 'cdp_response'
}
export function isCdpEvent(msg: NativeMessage): msg is CdpEventMessage {
  return msg.type === 'cdp_event'
}
```

- [ ] **Step 4: Export from index.ts**

Add exports for `CdpRequestMessage`, `CdpResponseMessage`, `CdpEventMessage`, `isCdpRequest`, `isCdpResponse`, `isCdpEvent`.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/core run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/native-messages.ts packages/core/src/index.ts
git commit -m "feat(core): add CDP message types to native message protocol"
```

---

### Task 3: Background CDP Handler

**Files:**
- Create: `packages/extension/src/background/cdp-handler.ts`
- Create: `packages/extension/tests/background/cdp-handler.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/extension/tests/background/cdp-handler.spec.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChromeMock } from './chrome-mock'

// Read chrome-mock.ts first to understand the mock API available

describe('createCdpHandler', () => {
  it('lazy-attaches on first CDP request', async () => {
    // Test that ensureAttached is called with correct tabId and protocol version
    // Verify chrome.debugger.attach called with { tabId: 42 }, '1.3'
  })

  it('reuses existing attachment on subsequent requests', async () => {
    // Second request to same tabId should NOT call attach again
  })

  it('forwards CDP method to chrome.debugger.sendCommand', async () => {
    // Verify sendCommand called with correct method and params
  })

  it('detaches on tab removal', async () => {
    // Simulate chrome.tabs.onRemoved, verify detach called
  })

  it('cleans up on debugger detach event', async () => {
    // Simulate chrome.debugger.onDetach, verify tab removed from set
  })

  it('throws CdpAttachError when attach fails', async () => {
    // Mock attach to reject, verify error propagation
  })

  it('relays Input.dragIntercepted events to tab', async () => {
    // Simulate chrome.debugger.onEvent with dragIntercepted
    // Verify chrome.tabs.sendMessage called with cdp_event type
  })
})
```

Note: Read `packages/extension/tests/background/chrome-mock.ts` first to understand available mocks. Extend it if needed to support `chrome.debugger` mock.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/extension run test -- cdp-handler
```

- [ ] **Step 3: Extend chrome-mock.ts for debugger API**

Add `chrome.debugger.attach`, `chrome.debugger.detach`, `chrome.debugger.sendCommand`, `chrome.debugger.onDetach`, `chrome.debugger.onEvent` to the mock.

- [ ] **Step 4: Implement cdp-handler.ts**

```typescript
// packages/extension/src/background/cdp-handler.ts

export class CdpAttachError extends Error {
  constructor(message: string) {
    super(`CDP attach failed: ${message}`)
    this.name = 'CdpAttachError'
  }
}

export interface CdpHandler {
  handleRequest(tabId: number, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
  detach(tabId: number): void
  detachAll(): void
  isAttached(tabId: number): boolean
  register(): void
}

export interface CdpHandlerOptions {
  api: typeof chrome
}

export function createCdpHandler(options: CdpHandlerOptions): CdpHandler {
  const { api } = options
  const attachedTabs = new Set<number>()

  async function ensureAttached(tabId: number): Promise<void> {
    if (attachedTabs.has(tabId)) return
    try {
      await api.debugger.attach({ tabId }, '1.3')
      attachedTabs.add(tabId)
    } catch (err: unknown) {
      throw new CdpAttachError(err instanceof Error ? err.message : String(err))
    }
  }

  function detach(tabId: number): void {
    if (!attachedTabs.has(tabId)) return
    attachedTabs.delete(tabId)
    api.debugger.detach({ tabId }).catch(() => {})
  }

  function detachAll(): void {
    for (const tabId of attachedTabs) {
      detach(tabId)
    }
  }

  async function handleRequest(
    tabId: number,
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    await ensureAttached(tabId)
    const result = await api.debugger.sendCommand({ tabId }, method, params)
    return (result ?? {}) as Record<string, unknown>
  }

  function register(): void {
    api.debugger.onDetach.addListener((source: chrome.debugger.Debuggee) => {
      if (source.tabId != null) attachedTabs.delete(source.tabId)
    })

    api.debugger.onEvent.addListener(
      (source: chrome.debugger.Debuggee, method: string, params?: object) => {
        if (method === 'Input.dragIntercepted' && source.tabId != null) {
          api.tabs.sendMessage(source.tabId, {
            type: 'cdp_event',
            method,
            params: params ?? {},
          })
        }
      },
    )

    api.tabs.onRemoved.addListener((tabId: number) => {
      detach(tabId)
    })
  }

  return { handleRequest, detach, detachAll, isAttached: (id) => attachedTabs.has(id), register }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/extension run test -- cdp-handler
```

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/background/cdp-handler.ts packages/extension/tests/background/cdp-handler.spec.ts packages/extension/tests/background/chrome-mock.ts
git commit -m "feat(extension): add CDP handler with lazy attach and event relay"
```

---

### Task 4: Extension Wiring

**Files:**
- Modify: `packages/extension/manifest.json`
- Modify: `packages/extension/src/background/messages.ts`
- Modify: `packages/extension/src/background/service-worker.ts`
- Modify: `packages/extension/src/background/message-router.ts`
- Modify: `packages/extension/tests/background/message-router.spec.ts`

- [ ] **Step 1: Add debugger permission to manifest.json**

Add `"debugger"` to the permissions array.

- [ ] **Step 2: Add CdpRequestMessage to BackgroundRuntimeMessage union**

In `packages/extension/src/background/messages.ts`, add `CdpRequestMessage` (with `type: 'cdp_request'`, `requestId: string`, `method: string`, `params: Record<string, unknown>`) to the `BackgroundRuntimeMessage` union type. This is needed for `message-router.ts` to type-check `msg.method` and `msg.params` on cdp_request messages.

- [ ] **Step 3: Write failing test for cdp_request routing**

Add to `packages/extension/tests/background/message-router.spec.ts`:

```typescript
it('routes cdp_request from content script to cdp handler', async () => {
  // Emit cdp_request message from content script
  // Verify cdpHandler.handleRequest called with tabId, method, params
  // Verify sendResponse called with cdp_response
})

it('routes cdp_response back to content script tab', async () => {
  // After handleRequest resolves, verify chrome.tabs.sendMessage
  // called with { type: 'cdp_response', requestId, result }
})

it('routes cdp_request error as cdp_response with error', async () => {
  // Mock handleRequest to reject
  // Verify cdp_response with error field sent back
})
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/extension run test -- message-router
```

- [ ] **Step 5: Wire CDP handler into message-router.ts**

In `createBackgroundMessageRouter`, accept `cdpHandler` option. Add handler for `cdp_request` messages:

```typescript
// In the runtime message handler section
if (msg.type === 'cdp_request' && sender.tab?.id) {
  const tabId = sender.tab.id
  cdpHandler.handleRequest(tabId, msg.method, msg.params)
    .then(result => {
      api.tabs.sendMessage(tabId, {
        type: 'cdp_response',
        requestId: msg.requestId,
        result,
      })
    })
    .catch(err => {
      api.tabs.sendMessage(tabId, {
        type: 'cdp_response',
        requestId: msg.requestId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  return true // async response
}
```

- [ ] **Step 6: Wire CDP handler into service-worker.ts**

```typescript
import { createCdpHandler } from './cdp-handler'

const cdpHandler = createCdpHandler({ api: chrome })
cdpHandler.register()

// Pass to message router
const router = createBackgroundMessageRouter({
  api: chrome,
  controller,
  broadcaster,
  cdpHandler,
})
```

- [ ] **Step 7: Run tests**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/extension run test
```

- [ ] **Step 8: Typecheck**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/extension run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add packages/extension/
git commit -m "feat(extension): wire CDP handler into message router and service worker"
```

---

## Phase 2: Bridge & Client

### Task 5: Content Script Bridge Extension

**Files:**
- Modify: `packages/extension/src/content/bridge.ts`
- Modify: `packages/extension/src/content/index.ts`
- Modify: `packages/extension/tests/bridge.spec.ts`

- [ ] **Step 1: Write failing test for CDP bridge relay**

Add to `packages/extension/tests/bridge.spec.ts`:

```typescript
it('relays cdp_request from page to background', () => {
  // Page runtime posts cdp_request via bridge
  // Verify chrome.runtime.sendMessage called with cdp_request
})

it('relays cdp_response from background to page', () => {
  // Simulate chrome.runtime.onMessage with cdp_response
  // Verify window.postMessage called with bridge-wrapped cdp_response
})

it('relays cdp_event from background to page', () => {
  // Simulate chrome.runtime.onMessage with cdp_event
  // Verify window.postMessage called with bridge-wrapped cdp_event
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/extension run test -- bridge
```

- [ ] **Step 3: Implement bridge CDP relay**

In `content/index.ts`, within `registerRuntimeMessageListener()`, add handlers for background → page direction:

```typescript
// Handle cdp_response and cdp_event from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'cdp_response' || msg.type === 'cdp_event') {
    sendToBridge(msg.type, msg)
  }
})
```

In `setupBridge()` callback, add handler for page → background direction:

```typescript
// Inside the bridge message listener
if (payload.type === 'cdp_request') {
  safeSendMessage(payload.data)
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/extension run test -- bridge
```

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/content/ packages/extension/tests/bridge.spec.ts
git commit -m "feat(extension): extend bridge for bidirectional CDP message relay"
```

---

### Task 6: Page Runtime Routing

**Files:**
- Modify: `packages/extension/src/runtime/page-runtime.ts`
- Modify: `packages/extension/tests/page-runtime.spec.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/extension/tests/page-runtime.spec.ts`:

```typescript
it('routes cdp_response messages to runtime cdp handler', () => {
  // Post cdp_response bridge message
  // Verify dispatched to registered handler
})

it('routes cdp_event messages to runtime cdp handler', () => {
  // Post cdp_event bridge message
  // Verify dispatched to registered handler
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/extension run test -- page-runtime
```

- [ ] **Step 3: Add cdp_response/cdp_event routing to page-runtime.ts**

In the message listener (line 81), add cases:

```typescript
case 'cdp_response':
case 'cdp_event':
  // Dispatch to cdp-client handlers (will be registered by runtime init)
  window.dispatchEvent(new CustomEvent('agrune:cdp', { detail: payload.data }))
  break
```

Using CustomEvent as a decoupling mechanism — `cdp-client.ts` will listen for this.

- [ ] **Step 4: Run tests**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/extension run test -- page-runtime
```

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/runtime/page-runtime.ts packages/extension/tests/page-runtime.spec.ts
git commit -m "feat(extension): route CDP response and event messages in page runtime"
```

---

### Task 7: CDP Client Module + postMessage Plumbing

**Files:**
- Modify: `packages/build-core/src/types.ts` (add `postMessage` to `AgagruneRuntimeOptions`)
- Create: `packages/build-core/src/runtime/cdp-client.ts`
- Create: `packages/build-core/tests/cdp-client.spec.ts`

- [ ] **Step 0: Add postMessage callback to AgagruneRuntimeOptions**

In `packages/build-core/src/types.ts`, add to `AgagruneRuntimeOptions`:

```typescript
postMessage?: (type: string, data: unknown) => void
```

This callback will be passed from `page-runtime.ts` → `installPageAgentRuntime()` → `createCdpClient()`. It posts bridge messages to the content script. Without this, the CDP client has no way to send messages out of the page runtime.

- [ ] **Step 1: Write failing tests**

```typescript
// packages/build-core/tests/cdp-client.spec.ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('CdpClient', () => {
  it('sends cdp_request via postMessage and resolves on response', async () => {
    // Create client, call sendCdpEvent
    // Simulate cdp_response CustomEvent
    // Verify promise resolves with result
  })

  it('rejects on error response', async () => {
    // Simulate cdp_response with error field
    // Verify promise rejects
  })

  it('rejects on timeout (5s)', async () => {
    // Call sendCdpEvent, advance timers 5s
    // Verify promise rejects with timeout error
  })

  it('handles cdp_event for dragIntercepted', () => {
    // Simulate cdp_event CustomEvent
    // Verify pendingDragData is captured
  })

  it('cleans up pending map on dispose', () => {
    // Create pending requests, call dispose
    // Verify all pending rejected
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/build-core run test -- cdp-client
```

- [ ] **Step 3: Implement cdp-client.ts**

```typescript
// packages/build-core/src/runtime/cdp-client.ts

const CDP_TIMEOUT_MS = 5_000

export interface CdpClient {
  sendCdpEvent(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
  getPendingDragData(): unknown | null
  clearPendingDragData(): void
  dispose(): void
}

export function createCdpClient(postMessage: (type: string, data: unknown) => void): CdpClient {
  const pending = new Map<string, {
    resolve: (v: Record<string, unknown>) => void
    reject: (e: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  let pendingDragData: unknown | null = null

  function handleCdpMessage(e: Event): void {
    const detail = (e as CustomEvent).detail
    if (!detail) return

    if (detail.type === 'cdp_response') {
      const entry = pending.get(detail.requestId)
      if (!entry) return
      clearTimeout(entry.timer)
      pending.delete(detail.requestId)
      if (detail.error) {
        entry.reject(new Error(detail.error))
      } else {
        entry.resolve(detail.result ?? {})
      }
    }

    if (detail.type === 'cdp_event') {
      if (detail.method === 'Input.dragIntercepted') {
        pendingDragData = detail.params?.data ?? null
      }
    }
  }

  window.addEventListener('agrune:cdp', handleCdpMessage)

  function sendCdpEvent(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`CDP request timed out: ${method}`))
      }, CDP_TIMEOUT_MS)
      pending.set(requestId, { resolve, reject, timer })
      postMessage('cdp_request', { requestId, method, params })
    })
  }

  function dispose(): void {
    window.removeEventListener('agrune:cdp', handleCdpMessage)
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('CDP client disposed'))
    }
    pending.clear()
  }

  return {
    sendCdpEvent,
    getPendingDragData: () => pendingDragData,
    clearPendingDragData: () => { pendingDragData = null },
    dispose,
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/build-core run test -- cdp-client
```

- [ ] **Step 5: Commit**

```bash
git add packages/build-core/src/runtime/cdp-client.ts packages/build-core/tests/cdp-client.spec.ts
git commit -m "feat(build-core): add CDP client module with timeout and event handling"
```

---

## Phase 3: Module Extraction

From here, we decompose `page-agent-runtime.ts` (2900+ lines) into focused modules. Each task extracts one module, re-exports from the entry point, and verifies existing tests still pass.

### Task 8: Extract dom-utils.ts

**Files:**
- Create: `packages/build-core/src/runtime/dom-utils.ts`
- Modify: `packages/build-core/src/runtime/page-agent-runtime.ts`

- [ ] **Step 1: Identify functions to extract**

Read `page-agent-runtime.ts` and extract these pure DOM utility functions:
- `getInteractablePoint()` / `findInteractablePoint()`
- `getEventTargetAtPoint()`
- `getElementCenter()`
- `isVisible()` / `isElementInViewport()` / `getElementViewportRect()`
- `isTopmostInteractable()`
- `isEnabled()`
- `isFillableElement()`
- `isOverlayElement()`
- `isSensitive()`
- `buildLiveSelector()` / `buildDomPathSelector()`
- `PointerCoords` type
- Any shared utility types these functions depend on

- [ ] **Step 2: Create dom-utils.ts with extracted functions**

Move the functions, keeping exact same signatures. Export all.

- [ ] **Step 3: Update page-agent-runtime.ts imports**

Replace local definitions with imports from `./dom-utils`.

- [ ] **Step 4: Run existing tests**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/build-core run test
```

- [ ] **Step 5: Typecheck**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/build-core run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/build-core/src/runtime/dom-utils.ts packages/build-core/src/runtime/page-agent-runtime.ts
git commit -m "refactor(build-core): extract DOM utility functions to dom-utils.ts"
```

---

### Task 9: Extract snapshot.ts

**Files:**
- Create: `packages/build-core/src/runtime/snapshot.ts`
- Modify: `packages/build-core/src/runtime/page-agent-runtime.ts`

- [ ] **Step 1: Identify functions to extract**

- `makeSnapshot()` and its internal helpers
- `captureSnapshot()` / `captureSettledSnapshot()`
- `buildErrorResult()` / `buildSuccessResult()` / `buildFlowBlockedResult()`
- DOM settle logic (`waitForDomSettle` or equivalent)
- `MutableSnapshotStore` interface
- Snapshot-related constants (`DOM_SETTLE_TIMEOUT_MS`, `DOM_SETTLE_QUIET_WINDOW_MS`, `DOM_SETTLE_STABLE_FRAMES`)

- [ ] **Step 2: Create snapshot.ts with extracted functions**

Functions will need `dom-utils` imports for visibility/rect calculations.

- [ ] **Step 3: Update page-agent-runtime.ts imports**

- [ ] **Step 4: Run existing tests**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/build-core run test
```

- [ ] **Step 5: Commit**

```bash
git add packages/build-core/src/runtime/snapshot.ts packages/build-core/src/runtime/page-agent-runtime.ts
git commit -m "refactor(build-core): extract snapshot logic to snapshot.ts"
```

---

### Task 10: Extract cursor-animator.ts

**Files:**
- Create: `packages/build-core/src/runtime/cursor-animator.ts`
- Modify: `packages/build-core/src/runtime/page-agent-runtime.ts`

- [ ] **Step 1: Identify functions to extract**

Exhaustive list from `page-agent-runtime.ts`:
- **Creation**: `getOrCreateCursorElement()`, `createPointerCursorElement()`, `createSvgCursorElement()`, `ensureCursorStyles()`
- **State**: `saveCursorPosition()`, `getCursorStartPosition()`, `getCursorTranslatePosition()`
- **Transform**: `setCursorTransform()`, `waitForCursorTransition()`
- **Press/Release**: `applyCursorPressStyle()`, `removeCursorPressStyle()`, `triggerCursorClick()`
- **Animation**: `animateCursorTo()`, `animateWithRAF()`, `easeOutCubic()`
- **Overlay**: `showIdlePointerOverlay()`, `hidePointerOverlay()`
- **Constants**: `CURSOR_STYLE_ID`, `CURSOR_CLICK_PRESS_MS`, `CURSOR_POST_ANIMATION_DELAY_MS`, `IDLE_TIMEOUT_MS` (if cursor-specific)

- [ ] **Step 2: Design CursorAnimator interface**

```typescript
export interface CursorAnimator {
  moveTo(coords: { x: number; y: number }): Promise<void>
  pressDown(): Promise<void>
  release(): Promise<void>
  setPosition(coords: { x: number; y: number }): void  // sync, no animation
  show(): void
  hide(): void
  dispose(): void
}

export function createCursorAnimator(options: {
  cursorName: string
  container?: HTMLElement
}): CursorAnimator
```

- [ ] **Step 3: Create cursor-animator.ts**

Extract all cursor DOM creation, animation, and state management. Keep `cursors/index.ts` as-is (it's already separate).

- [ ] **Step 4: Update page-agent-runtime.ts**

Replace inline cursor code with `CursorAnimator` usage.

- [ ] **Step 5: Run existing tests**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/build-core run test
```

- [ ] **Step 6: Commit**

```bash
git add packages/build-core/src/runtime/cursor-animator.ts packages/build-core/src/runtime/page-agent-runtime.ts
git commit -m "refactor(build-core): extract cursor animation to cursor-animator.ts"
```

---

### Task 11: Create event-sequences.ts (CDP-based)

**Files:**
- Create: `packages/build-core/src/runtime/event-sequences.ts`
- Create: `packages/build-core/tests/event-sequences.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/build-core/tests/event-sequences.spec.ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createEventSequences } from '../src/runtime/event-sequences'

function mockCdpClient() {
  return {
    sendCdpEvent: vi.fn().mockResolvedValue({}),
    getPendingDragData: vi.fn().mockReturnValue(null),
    clearPendingDragData: vi.fn(),
    dispose: vi.fn(),
  }
}

describe('EventSequences', () => {
  it('click: sends mouseMoved + mousePressed + mouseReleased', async () => {
    const cdp = mockCdpClient()
    const seq = createEventSequences(cdp)
    await seq.click({ x: 100, y: 200 })

    expect(cdp.sendCdpEvent).toHaveBeenCalledTimes(3)
    expect(cdp.sendCdpEvent).toHaveBeenNthCalledWith(1, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: 100, y: 200,
    })
    expect(cdp.sendCdpEvent).toHaveBeenNthCalledWith(2, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x: 100, y: 200, button: 'left', clickCount: 1,
    })
    expect(cdp.sendCdpEvent).toHaveBeenNthCalledWith(3, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: 100, y: 200, button: 'left', clickCount: 1,
    })
  })

  it('dblclick: sends 4 events with clickCount 1 then 2', async () => {
    const cdp = mockCdpClient()
    const seq = createEventSequences(cdp)
    await seq.dblclick({ x: 50, y: 50 })
    expect(cdp.sendCdpEvent).toHaveBeenCalledTimes(4)
  })

  it('contextmenu: uses right button', async () => {
    const cdp = mockCdpClient()
    const seq = createEventSequences(cdp)
    await seq.contextmenu({ x: 50, y: 50 })
    expect(cdp.sendCdpEvent).toHaveBeenNthCalledWith(1, 'Input.dispatchMouseEvent',
      expect.objectContaining({ button: 'right' }))
  })

  it('hover: sends only mouseMoved', async () => {
    const cdp = mockCdpClient()
    const seq = createEventSequences(cdp)
    await seq.hover({ x: 50, y: 50 })
    expect(cdp.sendCdpEvent).toHaveBeenCalledTimes(1)
    expect(cdp.sendCdpEvent).toHaveBeenCalledWith('Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mouseMoved' }))
  })

  it('longpress: has 500ms delay between press and release', async () => {
    vi.useFakeTimers()
    const cdp = mockCdpClient()
    const seq = createEventSequences(cdp)
    const promise = seq.longpress({ x: 50, y: 50 })
    // mousePressed should be called immediately
    expect(cdp.sendCdpEvent).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(500)
    await promise
    expect(cdp.sendCdpEvent).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('pointerDrag: sends mousePressed + N mouseMoved + mouseReleased', async () => {
    const cdp = mockCdpClient()
    const seq = createEventSequences(cdp)
    const steps = [{ x: 60, y: 60 }, { x: 70, y: 70 }]
    await seq.pointerDrag({ x: 50, y: 50 }, { x: 80, y: 80 }, steps)
    // 1 pressed + 2 moved + 1 released = 4
    expect(cdp.sendCdpEvent).toHaveBeenCalledTimes(4)
  })

  it('wheel: sends mouseMoved + mouseWheel with modifiers', async () => {
    const cdp = mockCdpClient()
    const seq = createEventSequences(cdp)
    await seq.wheel({ x: 50, y: 50 }, -120, true)
    expect(cdp.sendCdpEvent).toHaveBeenNthCalledWith(2, 'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mouseWheel', modifiers: 4 }))
  })

  it('htmlDrag: uses setInterceptDrags + dispatchDragEvent', async () => {
    const cdp = mockCdpClient()
    cdp.getPendingDragData.mockReturnValue({ items: [], dragOperationsMask: 1 })
    const seq = createEventSequences(cdp)
    await seq.htmlDrag({ x: 50, y: 50 }, { x: 200, y: 200 })
    expect(cdp.sendCdpEvent).toHaveBeenCalledWith('Input.setInterceptDrags', { enabled: true })
    expect(cdp.sendCdpEvent).toHaveBeenCalledWith('Input.dispatchDragEvent',
      expect.objectContaining({ type: 'drop' }))
    expect(cdp.sendCdpEvent).toHaveBeenCalledWith('Input.setInterceptDrags', { enabled: false })
  })

  it('htmlDrag: skips drop when no dragData captured', async () => {
    const cdp = mockCdpClient()
    cdp.getPendingDragData.mockReturnValue(null)
    const seq = createEventSequences(cdp)
    await seq.htmlDrag({ x: 50, y: 50 }, { x: 200, y: 200 })
    expect(cdp.sendCdpEvent).not.toHaveBeenCalledWith('Input.dispatchDragEvent',
      expect.anything())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/build-core run test -- event-sequences
```

- [ ] **Step 3: Implement event-sequences.ts**

```typescript
// packages/build-core/src/runtime/event-sequences.ts
import type { CdpClient } from './cdp-client'

export interface Coords {
  x: number
  y: number
}

export interface EventSequences {
  click(coords: Coords): Promise<void>
  dblclick(coords: Coords): Promise<void>
  contextmenu(coords: Coords): Promise<void>
  hover(coords: Coords): Promise<void>
  longpress(coords: Coords): Promise<void>
  mousePressed(coords: Coords, button?: 'left' | 'right'): Promise<void>
  mouseMoved(coords: Coords): Promise<void>
  mouseReleased(coords: Coords, button?: 'left' | 'right'): Promise<void>
  pointerDrag(src: Coords, dst: Coords, steps: Coords[]): Promise<void>
  wheel(coords: Coords, deltaY: number, ctrlKey?: boolean): Promise<void>
  htmlDrag(src: Coords, dst: Coords): Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export function createEventSequences(cdp: CdpClient): EventSequences {
  const send = cdp.sendCdpEvent.bind(cdp)
  const mouse = (type: string, x: number, y: number, extra?: Record<string, unknown>) =>
    send('Input.dispatchMouseEvent', { type, x, y, ...extra })

  return {
    async click(coords) {
      await mouse('mouseMoved', coords.x, coords.y)
      await mouse('mousePressed', coords.x, coords.y, { button: 'left', clickCount: 1 })
      await mouse('mouseReleased', coords.x, coords.y, { button: 'left', clickCount: 1 })
    },

    async dblclick(coords) {
      await mouse('mousePressed', coords.x, coords.y, { button: 'left', clickCount: 1 })
      await mouse('mouseReleased', coords.x, coords.y, { button: 'left', clickCount: 1 })
      await mouse('mousePressed', coords.x, coords.y, { button: 'left', clickCount: 2 })
      await mouse('mouseReleased', coords.x, coords.y, { button: 'left', clickCount: 2 })
    },

    async contextmenu(coords) {
      await mouse('mousePressed', coords.x, coords.y, { button: 'right', clickCount: 1 })
      await mouse('mouseReleased', coords.x, coords.y, { button: 'right', clickCount: 1 })
    },

    async hover(coords) {
      await mouse('mouseMoved', coords.x, coords.y)
    },

    async longpress(coords) {
      await mouse('mousePressed', coords.x, coords.y, { button: 'left', clickCount: 1 })
      await sleep(500)
      await mouse('mouseReleased', coords.x, coords.y, { button: 'left', clickCount: 1 })
    },

    async mousePressed(coords, button = 'left') {
      await mouse('mousePressed', coords.x, coords.y, { button, clickCount: 1 })
    },

    async mouseMoved(coords) {
      await mouse('mouseMoved', coords.x, coords.y)
    },

    async mouseReleased(coords, button = 'left') {
      await mouse('mouseReleased', coords.x, coords.y, { button, clickCount: 1 })
    },

    async pointerDrag(src, dst, steps) {
      await mouse('mousePressed', src.x, src.y, { button: 'left', clickCount: 1 })
      for (const step of steps) {
        await mouse('mouseMoved', step.x, step.y)
      }
      await mouse('mouseReleased', dst.x, dst.y, { button: 'left', clickCount: 1 })
    },

    async wheel(coords, deltaY, ctrlKey = false) {
      await mouse('mouseMoved', coords.x, coords.y)
      await mouse('mouseWheel', coords.x, coords.y, {
        deltaX: 0, deltaY,
        modifiers: ctrlKey ? 4 : 0,
      })
    },

    async htmlDrag(src, dst) {
      await send('Input.setInterceptDrags', { enabled: true })
      await mouse('mousePressed', src.x, src.y, { button: 'left', clickCount: 1 })
      await mouse('mouseMoved', dst.x, dst.y)
      // Wait for dragIntercepted event to populate pendingDragData
      await sleep(100)
      const dragData = cdp.getPendingDragData()
      if (dragData) {
        await send('Input.dispatchDragEvent', {
          type: 'drop',
          x: dst.x,
          y: dst.y,
          data: dragData,
        })
        cdp.clearPendingDragData()
      }
      await mouse('mouseReleased', dst.x, dst.y, { button: 'left', clickCount: 1 })
      await send('Input.setInterceptDrags', { enabled: false })
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/build-core run test -- event-sequences
```

- [ ] **Step 5: Commit**

```bash
git add packages/build-core/src/runtime/event-sequences.ts packages/build-core/tests/event-sequences.spec.ts
git commit -m "feat(build-core): add CDP-based event sequences module"
```

---

### Task 12a: Extract command framework + simple handlers

**Files:**
- Create: `packages/build-core/src/runtime/command-handlers.ts`
- Modify: `packages/build-core/src/runtime/page-agent-runtime.ts`

- [ ] **Step 1: Design CommandHandlers interface and deps**

```typescript
export interface CommandHandlerDeps {
  cdpClient: CdpClient
  eventSequences: EventSequences
  cursorAnimator: CursorAnimator
  snapshotManager: SnapshotManager
  actionQueue: ActionQueue
  config: () => AgagruneRuntimeConfig
  resolveTarget: (targetId: string) => TargetState | null
}

export interface CommandHandlers {
  act(input: ActInput): Promise<CommandResult>
  drag(input: DragInput): Promise<CommandResult>
  fill(input: FillInput): Promise<CommandResult>
  pointer(input: PointerInput): Promise<CommandResult>
  wait(input: WaitInput): Promise<CommandResult>
  guide(input: GuideInput): Promise<CommandResult>
  read(input: ReadInput): Promise<CommandResult>
}
```

- [ ] **Step 2: Extract shared command infrastructure**

Move from `page-agent-runtime.ts` to `command-handlers.ts`:
- `withDescriptor()` helper (target resolution + validation for all target-based commands)
- `resolveExecutionConfig()` (per-command config merging)
- `smoothScrollIntoView()` (used by act, drag, guide before event dispatch)
- `setElementValue()` (used by fill — keep as-is, not CDP)
- `domToMarkdown()`, `isVisibleForRead()`, and read-related helpers (~270 lines — used only by read handler)
- Aurora glow functions: `showAuroraGlow()`, `hideAuroraGlow()` (visual effects for queue lifecycle)
- `waitForNextFrame()` / `raf()` helper (used in drag animation loop)

- [ ] **Step 3: Extract simple handlers (wait, read, fill)**

These handlers have no synthetic event dispatch to replace:
- **wait()**: No changes, move as-is
- **read()**: No changes, move as-is with `domToMarkdown` helpers
- **fill()**: Keep `setElementValue()` logic unchanged (not CDP). The pre-fill click uses `eventSequences.click()` instead of `performPointerClickSequence()`

- [ ] **Step 4: Run existing tests**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/build-core run test
```

- [ ] **Step 5: Commit**

```bash
git add packages/build-core/src/runtime/command-handlers.ts packages/build-core/src/runtime/page-agent-runtime.ts
git commit -m "refactor(build-core): extract command framework and simple handlers"
```

---

### Task 12b: Extract and rewrite event-dispatching handlers

**Files:**
- Modify: `packages/build-core/src/runtime/command-handlers.ts`
- Modify: `packages/build-core/src/runtime/page-agent-runtime.ts`

- [ ] **Step 1: Extract and rewrite act() handler**

Replace synthetic dispatch with CDP:
- `performPointerClickSequence()` → `await eventSequences.click(coords)`
- `performPointerDblClickSequence()` → `await eventSequences.dblclick(coords)`
- `performContextMenuSequence()` → `await eventSequences.contextmenu(coords)`
- `performHoverSequence()` → `await eventSequences.hover(coords)`
- `performLongPressSequence()` → `await eventSequences.longpress(coords)`
- Cursor animation uses `cursorAnimator.moveTo()` / `pressDown()` / `release()`

- [ ] **Step 2: Extract and rewrite drag() handler**

Two branches:
- **Target-based drag**: `withDescriptor` resolves src/dst coords → drag loop with `cursorAnimator.setPosition()` + `eventSequences.mouseMoved()` + `raf()` per frame
- **Coordinate-based drag**: `destinationCoords` provided directly → same CDP drag loop
- **HTML5 drag** (`draggable="true"`): `eventSequences.htmlDrag(srcCoords, dstCoords)`

Drag-with-cursor animation pattern:
```typescript
await cursorAnimator.moveTo(srcCoords)
await cursorAnimator.pressDown()
await eventSequences.mousePressed(srcCoords)
for (const step of interpolatedSteps) {
  cursorAnimator.setPosition(step)
  await eventSequences.mouseMoved(step)
  await raf()
}
await eventSequences.mouseReleased(dstCoords)
await cursorAnimator.release()
```

- [ ] **Step 3: Extract and rewrite pointer() handler**

Replace per-action synthetic dispatch loop with CDP:
```typescript
for (const action of actions) {
  switch (action.type) {
    case 'pointerdown': await eventSequences.mousePressed({ x: action.x, y: action.y }); break
    case 'pointermove': await eventSequences.mouseMoved({ x: action.x, y: action.y }); break
    case 'pointerup': await eventSequences.mouseReleased({ x: action.x, y: action.y }); break
    case 'wheel': await eventSequences.wheel({ x: action.x, y: action.y }, action.deltaY, action.ctrlKey); break
  }
}
```

- [ ] **Step 4: Extract and rewrite guide() handler**

Same as act(click) but with forced cursor animation:
- `eventSequences.click(coords)` with `cursorAnimator` always active

- [ ] **Step 5: Run existing tests**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/build-core run test
```

- [ ] **Step 6: Typecheck**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/build-core run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add packages/build-core/src/runtime/command-handlers.ts packages/build-core/src/runtime/page-agent-runtime.ts
git commit -m "refactor(build-core): rewrite act/drag/pointer/guide handlers with CDP"
```

---

## Phase 4: Integration

### Task 13: Slim Down page-agent-runtime.ts

**Files:**
- Modify: `packages/build-core/src/runtime/page-agent-runtime.ts`

- [ ] **Step 1: Remove all synthetic event dispatch functions**

Delete:
- `dispatchPointerLikeEvent()`
- `dispatchMouseLikeEvent()`
- `dispatchWheelEvent()`
- `dispatchDragLikeEvent()`
- `dispatchHoverTransition()`
- `performPointerClickSequence()`
- `performPointerDblClickSequence()`
- `performContextMenuSequence()`
- `performHoverSequence()`
- `performLongPressSequence()`
- `performHtmlDragSequence()`
- `performPointerDragSequence()`
- `performPointerDragToCoords()`
- All `animate*WithCursor()` functions (now in cursor-animator.ts)

- [ ] **Step 2: Wire modules in createPageAgentRuntime()**

```typescript
import { createCdpClient } from './cdp-client'
import { createEventSequences } from './event-sequences'
import { createCursorAnimator } from './cursor-animator'
import { createCommandHandlers } from './command-handlers'
import { createSnapshotManager } from './snapshot'
import { /* dom utils */ } from './dom-utils'

export function createPageAgentRuntime(
  manifest: AgagruneManifest,
  options?: Partial<AgagruneRuntimeOptions>,
): PageAgentRuntime {
  const queue = new ActionQueue({ idleTimeoutMs: IDLE_TIMEOUT_MS })

  // Bridge postMessage function passed from page-runtime.ts
  const cdpClient = createCdpClient(options?.postMessage ?? sendToContentScript)
  const eventSequences = createEventSequences(cdpClient)
  const cursorAnimator = createCursorAnimator({ cursorName: config.pointerCursor })
  const snapshotManager = createSnapshotManager(/* ... */)

  const handlers = createCommandHandlers({
    cdpClient,
    eventSequences,
    cursorAnimator,
    snapshotManager,
    actionQueue: queue,
    config: () => config,
    resolveTarget: (id) => /* target resolution */,
  })

  return {
    act: handlers.act,
    drag: handlers.drag,
    fill: handlers.fill,
    pointer: handlers.pointer,
    wait: handlers.wait,
    guide: handlers.guide,
    read: handlers.read,
    getSnapshot: snapshotManager.getSnapshot,
    // ... other methods
  }
}
```

- [ ] **Step 3: Verify no synthetic event code remains**

```bash
cd /Users/chenjing/dev/agrune/agrune && grep -n 'dispatchEvent\|new PointerEvent\|new MouseEvent\|new WheelEvent\|new DragEvent' packages/build-core/src/runtime/page-agent-runtime.ts
```

Expected: No matches (or only in fill's input/change events).

- [ ] **Step 4: Run all tests**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm test
```

- [ ] **Step 5: Typecheck all packages**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/build-core/src/runtime/
git commit -m "refactor(build-core): slim page-agent-runtime to entry point, remove all synthetic events"
```

---

### Task 14: Full Build & Smoke Test

**Files:** None (validation only)

- [ ] **Step 1: Clean build all packages**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm build
```

- [ ] **Step 2: Run all tests**

```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm test
```

- [ ] **Step 3: Verify extension loads**

Build the extension and verify it loads in Chrome without errors:
```bash
cd /Users/chenjing/dev/agrune/agrune && pnpm --filter @agrune/extension run build
```

Check `packages/extension/dist/` contains `service-worker.js`, `content.js`, `page-runtime.js`, `manifest.json` with `"debugger"` permission.

- [ ] **Step 4: Verify file count / line reduction**

```bash
wc -l packages/build-core/src/runtime/page-agent-runtime.ts
wc -l packages/build-core/src/runtime/*.ts
```

`page-agent-runtime.ts` should be under ~500 lines (down from 2900+).

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "chore: verify CDP migration build and tests pass"
```
