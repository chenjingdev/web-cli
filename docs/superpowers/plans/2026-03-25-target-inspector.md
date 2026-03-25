# Target Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DevTools "Agrune" panel that displays real-time target/group state from page snapshots with filtering, search, and page element highlighting.

**Architecture:** DevTools panel connects to background via `chrome.runtime.connect()` port. Background intercepts snapshots in `handleRuntimeMessage` and forwards to subscribed panels. Highlight requests relay from panel through background to content script, which draws DOM overlays.

**Tech Stack:** TypeScript, Chrome Extensions Manifest V3, Vite (IIFE builds), Vitest + jsdom

**Spec:** `docs/superpowers/specs/2026-03-25-target-inspector-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/shared/messages.ts` | Modify | Add 4 devtools message types |
| `tests/background/chrome-mock.ts` | Modify | Add `onConnect` support for port-based testing |
| `src/background/message-router.ts` | Modify | Port subscription, snapshot forwarding, highlight relay |
| `tests/background/message-router.spec.ts` | Modify | Tests for subscription + forwarding + relay + cleanup |
| `src/content/index.ts` | Modify | `highlight_target` / `clear_highlight` handlers |
| `src/content/highlight-overlay.ts` | Create | Highlight overlay DOM logic (create/remove/fade) |
| `tests/content-highlight.spec.ts` | Create | Tests for highlight overlay |
| `src/devtools/devtools.html` | Create | DevTools entry HTML |
| `src/devtools/devtools.ts` | Create | `panels.create()` call |
| `src/devtools/panel.html` | Create | Panel UI HTML shell |
| `src/devtools/panel.ts` | Create | Panel logic: port, rendering, filters, detail |
| `src/devtools/panel.css` | Create | Panel styles (Catppuccin dark) |
| `manifest.json` | Modify | Add `devtools_page` |
| `vite.config.ts` | Modify | Add devtools.ts + panel.ts build entries |

---

### Task 1: Add devtools message types

**Files:**
- Modify: `src/shared/messages.ts`

- [ ] **Step 1: Add devtools message interfaces**

```typescript
// After the existing NativeHostStatusChangedMessage interface, add:

export interface SubscribeSnapshotMessage {
  type: 'subscribe_snapshot'
  tabId: number
}

export interface DevtoolsSnapshotMessage {
  type: 'devtools_snapshot'
  tabId: number
  snapshot: PageSnapshot
}

export interface HighlightTargetMessage {
  type: 'highlight_target'
  tabId: number
  targetId: string
  selector: string
}

export interface ClearHighlightMessage {
  type: 'clear_highlight'
  tabId: number
}

export type DevtoolsPortMessage =
  | SubscribeSnapshotMessage
  | HighlightTargetMessage
  | ClearHighlightMessage
```

Do NOT add these to `ExtensionMessage` — they travel via port, not `runtime.sendMessage`.

- [ ] **Step 2: Verify build**

Run: `cd packages/extension && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/shared/messages.ts
git commit -m "feat(inspector): add devtools port message types"
```

---

### Task 2: Extend chrome mock for port-based testing

**Files:**
- Modify: `tests/background/chrome-mock.ts`

- [ ] **Step 1: Add onConnect listener support to chrome mock**

Three changes to `createChromeMock`:

**A. New state variable** (add at line 38, alongside existing listener variables):

```typescript
let connectListener: ((port: chrome.runtime.Port) => void) | null = null
```

**B. Add `onConnect` to `chromeMock.runtime` object** (add inside the `runtime` property at line 58, after `onMessage`):

```typescript
onConnect: {
  addListener(listener: typeof connectListener) {
    connectListener = listener ?? null
  },
},
```

**C. Update `ChromeMockBundle` interface** (add after `emitTabUpdated` at line 31):

```typescript
emitConnect(portName: string): {
  port: chrome.runtime.Port
  emitMessage(msg: unknown): void
  emitDisconnect(): void
}
```

**D. Add `emitConnect` implementation to the returned object** (add after `emitTabUpdated` at line 111):

```typescript
emitConnect(portName: string) {
  const portMsgListeners: Listener<unknown>[] = []
  let portDisconnectCb: Listener<void> | null = null
  const devtoolsPort = {
    name: portName,
    postMessage: vi.fn(),
    disconnect: vi.fn(() => { portDisconnectCb?.() }),
    onMessage: {
      addListener(listener: Listener<unknown>) {
        portMsgListeners.push(listener)
      },
    },
    onDisconnect: {
      addListener(listener: Listener<void>) {
        portDisconnectCb = listener
      },
    },
  } as unknown as chrome.runtime.Port
  connectListener?.(devtoolsPort)
  return {
    port: devtoolsPort,
    emitMessage(msg: unknown) {
      portMsgListeners.forEach(l => l(msg))
    },
    emitDisconnect() {
      portDisconnectCb?.()
    },
  }
},
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `cd packages/extension && npx vitest run`
Expected: all existing tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/extension/tests/background/chrome-mock.ts
git commit -m "test(inspector): extend chrome mock with onConnect support"
```

---

### Task 3: Background port subscription + snapshot forwarding

**Files:**
- Modify: `src/background/message-router.ts`
- Modify: `tests/background/message-router.spec.ts`

- [ ] **Step 1: Write failing test — panel subscribes and receives snapshots**

Add to `tests/background/message-router.spec.ts`:

```typescript
it('forwards snapshots to subscribed devtools panels', () => {
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

  // DevTools panel connects and subscribes
  const conn = chrome.emitConnect('devtools-inspector')
  conn.emitMessage({ type: 'subscribe_snapshot', tabId: 42 })

  // Content script sends snapshot
  chrome.emitRuntimeMessage(
    { type: 'snapshot', snapshot: { version: 1, targets: [] } },
    { tab: { id: 42 } } as chrome.runtime.MessageSender,
  )

  // Panel should receive devtools_snapshot
  expect(conn.port.postMessage).toHaveBeenCalledWith({
    type: 'devtools_snapshot',
    tabId: 42,
    snapshot: { version: 1, targets: [] },
  })
  // Native host should also still receive it
  expect(controller.postMessage).toHaveBeenCalledWith({
    type: 'snapshot_update',
    tabId: 42,
    snapshot: { version: 1, targets: [] },
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run tests/background/message-router.spec.ts`
Expected: FAIL — `emitConnect` not found or port.postMessage not called

- [ ] **Step 3: Implement port subscription in message-router.ts**

Add to `createBackgroundMessageRouter`. **IMPORTANT:** `devtoolsSubscribers` must be declared **before** `handleRuntimeMessage` (line 67) because `handleRuntimeMessage` references it in the `case 'snapshot'` branch. Place both `devtoolsSubscribers` and `handleDevtoolsConnect` right after `notifyExtensionContexts` (line 37), before `handleNativeHostMessage`:

```typescript
const devtoolsSubscribers = new Map<number, Set<chrome.runtime.Port>>()

const handleDevtoolsConnect = (port: chrome.runtime.Port): void => {
  if (port.name !== 'devtools-inspector') return

  port.onMessage.addListener((msg: unknown) => {
    const m = msg as { type: string; tabId?: number }
    if (m.type === 'subscribe_snapshot' && typeof m.tabId === 'number') {
      let subs = devtoolsSubscribers.get(m.tabId)
      if (!subs) {
        subs = new Set()
        devtoolsSubscribers.set(m.tabId, subs)
      }
      subs.add(port)
    }
  })

  port.onDisconnect.addListener(() => {
    for (const [tabId, subs] of devtoolsSubscribers) {
      subs.delete(port)
      if (subs.size === 0) devtoolsSubscribers.delete(tabId)
    }
  })
}
```

**Replace the entire** `case 'snapshot':` block (lines 112-118 of message-router.ts) with a block-scoped version that adds devtools forwarding:

```typescript
case 'snapshot': {
  controller.postMessage({
    type: 'snapshot_update',
    tabId,
    snapshot: msg.snapshot,
  } as NativeMessage)
  const subs = devtoolsSubscribers.get(tabId)
  if (subs) {
    const devMsg = { type: 'devtools_snapshot' as const, tabId, snapshot: msg.snapshot }
    for (const p of subs) {
      try { p.postMessage(devMsg) } catch { /* port may be dead */ }
    }
  }
  break
}
```

Update `register()` to add the onConnect listener:

```typescript
const register = (): void => {
  api.runtime.onMessage.addListener(handleRuntimeMessage)
  api.runtime.onConnect.addListener(handleDevtoolsConnect)
  // ... existing tabs listeners
}
```

Update `BackgroundMessageRouterOptions.api` to include `onConnect`:

```typescript
api?: Pick<typeof chrome, 'runtime' | 'tabs'>
```
(This already covers `runtime.onConnect` — no change needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run tests/background/message-router.spec.ts`
Expected: PASS

- [ ] **Step 5: Write test — port disconnect cleans up subscription**

```typescript
it('cleans up devtools subscription on port disconnect', () => {
  const chrome = createChromeMock()
  const controller = { postMessage: vi.fn(), requestStatus: vi.fn(), reconnect: vi.fn(), getStatus: vi.fn(() => ({ hostName: 'com.agrune.agrune', phase: 'connected' as NativeHostPhase, connected: true, lastError: null })) }
  const broadcaster = { broadcastToAllTabs: vi.fn(), sendToTab: vi.fn(), broadcastConfig: vi.fn(), broadcastAgentActivity: vi.fn(), broadcastNativeHostStatus: vi.fn() }

  const router = createBackgroundMessageRouter({ api: chrome.chromeMock, controller, broadcaster })
  router.register()

  const conn = chrome.emitConnect('devtools-inspector')
  conn.emitMessage({ type: 'subscribe_snapshot', tabId: 42 })
  conn.emitDisconnect()

  // After disconnect, snapshot should NOT be forwarded to panel
  chrome.emitRuntimeMessage(
    { type: 'snapshot', snapshot: { version: 2 } },
    { tab: { id: 42 } } as chrome.runtime.MessageSender,
  )

  expect(conn.port.postMessage).not.toHaveBeenCalled()
})
```

- [ ] **Step 6: Run test — should pass (cleanup already implemented)**

Run: `cd packages/extension && npx vitest run tests/background/message-router.spec.ts`
Expected: PASS

- [ ] **Step 7: Write test — tab removal cleans up subscription**

```typescript
it('cleans up devtools subscription on tab removal', () => {
  const chrome = createChromeMock()
  const controller = { postMessage: vi.fn(), requestStatus: vi.fn(), reconnect: vi.fn(), getStatus: vi.fn(() => ({ hostName: 'com.agrune.agrune', phase: 'connected' as NativeHostPhase, connected: true, lastError: null })) }
  const broadcaster = { broadcastToAllTabs: vi.fn(), sendToTab: vi.fn(), broadcastConfig: vi.fn(), broadcastAgentActivity: vi.fn(), broadcastNativeHostStatus: vi.fn() }

  const router = createBackgroundMessageRouter({ api: chrome.chromeMock, controller, broadcaster })
  router.register()

  const conn = chrome.emitConnect('devtools-inspector')
  conn.emitMessage({ type: 'subscribe_snapshot', tabId: 42 })

  chrome.emitTabRemoved(42)

  chrome.emitRuntimeMessage(
    { type: 'snapshot', snapshot: { version: 3 } },
    { tab: { id: 42 } } as chrome.runtime.MessageSender,
  )

  expect(conn.port.postMessage).not.toHaveBeenCalled()
})
```

- [ ] **Step 8: Implement tab removal cleanup**

In `register()`, update the existing `tabs.onRemoved` listener:

```typescript
api.tabs.onRemoved.addListener((tabId) => {
  controller.postMessage({ type: 'session_close', tabId } as NativeMessage)
  devtoolsSubscribers.delete(tabId)
})
```

- [ ] **Step 9: Write test — multiple subscribers on same tabId**

```typescript
it('forwards snapshots to all subscribers for the same tabId', () => {
  const chrome = createChromeMock()
  const controller = { postMessage: vi.fn(), requestStatus: vi.fn(), reconnect: vi.fn(), getStatus: vi.fn(() => ({ hostName: 'com.agrune.agrune', phase: 'connected' as NativeHostPhase, connected: true, lastError: null })) }
  const broadcaster = { broadcastToAllTabs: vi.fn(), sendToTab: vi.fn(), broadcastConfig: vi.fn(), broadcastAgentActivity: vi.fn(), broadcastNativeHostStatus: vi.fn() }

  const router = createBackgroundMessageRouter({ api: chrome.chromeMock, controller, broadcaster })
  router.register()

  const conn1 = chrome.emitConnect('devtools-inspector')
  conn1.emitMessage({ type: 'subscribe_snapshot', tabId: 42 })
  const conn2 = chrome.emitConnect('devtools-inspector')
  conn2.emitMessage({ type: 'subscribe_snapshot', tabId: 42 })

  chrome.emitRuntimeMessage(
    { type: 'snapshot', snapshot: { version: 1 } },
    { tab: { id: 42 } } as chrome.runtime.MessageSender,
  )

  expect(conn1.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'devtools_snapshot', tabId: 42 }))
  expect(conn2.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'devtools_snapshot', tabId: 42 }))
})
```

- [ ] **Step 10: Run test — should pass (Set already supports multiple ports)**

Run: `cd packages/extension && npx vitest run tests/background/message-router.spec.ts`
Expected: PASS

- [ ] **Step 11: Run all tests**

Run: `cd packages/extension && npx vitest run`
Expected: all tests pass

- [ ] **Step 12: Commit**

```bash
git add packages/extension/src/background/message-router.ts packages/extension/tests/background/message-router.spec.ts
git commit -m "feat(inspector): add port-based snapshot subscription in background router"
```

---

### Task 4: Background highlight relay

**Files:**
- Modify: `src/background/message-router.ts`
- Modify: `tests/background/message-router.spec.ts`

- [ ] **Step 1: Write failing test — highlight relay**

```typescript
it('relays highlight_target from devtools port to content script via tabs.sendMessage', () => {
  const chrome = createChromeMock()
  const controller = { postMessage: vi.fn(), requestStatus: vi.fn(), reconnect: vi.fn(), getStatus: vi.fn(() => ({ hostName: 'com.agrune.agrune', phase: 'connected' as NativeHostPhase, connected: true, lastError: null })) }
  const broadcaster = { broadcastToAllTabs: vi.fn(), sendToTab: vi.fn(), broadcastConfig: vi.fn(), broadcastAgentActivity: vi.fn(), broadcastNativeHostStatus: vi.fn() }

  const router = createBackgroundMessageRouter({ api: chrome.chromeMock, controller, broadcaster })
  router.register()

  const conn = chrome.emitConnect('devtools-inspector')
  conn.emitMessage({ type: 'highlight_target', tabId: 42, targetId: 't-1', selector: '[data-agrune-key="login"]' })

  expect(chrome.chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
    42,
    { type: 'highlight_target', tabId: 42, targetId: 't-1', selector: '[data-agrune-key="login"]' },
  )
})
```

- [ ] **Step 2: Write failing test — clear_highlight relay**

```typescript
it('relays clear_highlight from devtools port to content script via tabs.sendMessage', () => {
  const chrome = createChromeMock()
  const controller = { postMessage: vi.fn(), requestStatus: vi.fn(), reconnect: vi.fn(), getStatus: vi.fn(() => ({ hostName: 'com.agrune.agrune', phase: 'connected' as NativeHostPhase, connected: true, lastError: null })) }
  const broadcaster = { broadcastToAllTabs: vi.fn(), sendToTab: vi.fn(), broadcastConfig: vi.fn(), broadcastAgentActivity: vi.fn(), broadcastNativeHostStatus: vi.fn() }

  const router = createBackgroundMessageRouter({ api: chrome.chromeMock, controller, broadcaster })
  router.register()

  const conn = chrome.emitConnect('devtools-inspector')
  conn.emitMessage({ type: 'clear_highlight', tabId: 42 })

  expect(chrome.chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
    42,
    { type: 'clear_highlight', tabId: 42 },
  )
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/extension && npx vitest run tests/background/message-router.spec.ts`
Expected: FAIL

- [ ] **Step 4: Implement highlight relay in port.onMessage handler**

In `handleDevtoolsConnect`, extend the `port.onMessage` listener:

```typescript
if (m.type === 'highlight_target' && typeof m.tabId === 'number') {
  api.tabs.sendMessage(m.tabId, msg)
}
if (m.type === 'clear_highlight' && typeof m.tabId === 'number') {
  api.tabs.sendMessage(m.tabId, msg)
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/extension && npx vitest run`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/background/message-router.ts packages/extension/tests/background/message-router.spec.ts
git commit -m "feat(inspector): relay highlight messages from devtools port to content script"
```

---

### Task 5: Content script highlight overlay

**Files:**
- Create: `src/content/highlight-overlay.ts`
- Create: `tests/content-highlight.spec.ts`
- Modify: `src/content/index.ts`

- [ ] **Step 1: Write failing test for highlight overlay module**

Create `tests/content-highlight.spec.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest'
import { showHighlight, clearHighlight } from '../src/content/highlight-overlay'

describe('highlight-overlay', () => {
  afterEach(() => {
    clearHighlight()
    document.body.innerHTML = ''
  })

  it('creates an overlay on the target element', () => {
    document.body.innerHTML = '<button data-agrune-key="login">Login</button>'
    showHighlight({ selector: '[data-agrune-key="login"]', targetId: 't-1' })

    const overlay = document.querySelector('[data-agrune-highlight]')
    expect(overlay).not.toBeNull()
  })

  it('removes overlay on clearHighlight', () => {
    document.body.innerHTML = '<button data-agrune-key="login">Login</button>'
    showHighlight({ selector: '[data-agrune-key="login"]', targetId: 't-1' })
    clearHighlight()

    const overlay = document.querySelector('[data-agrune-highlight]')
    expect(overlay).toBeNull()
  })

  it('replaces existing overlay when highlighting a new target', () => {
    document.body.innerHTML = `
      <button data-agrune-key="a">A</button>
      <button data-agrune-key="b">B</button>
    `
    showHighlight({ selector: '[data-agrune-key="a"]', targetId: 't-a' })
    showHighlight({ selector: '[data-agrune-key="b"]', targetId: 't-b' })

    const overlays = document.querySelectorAll('[data-agrune-highlight]')
    expect(overlays.length).toBe(1)
  })

  it('does nothing when selector matches no element', () => {
    showHighlight({ selector: '[data-agrune-key="nonexistent"]', targetId: 't-x' })
    const overlay = document.querySelector('[data-agrune-highlight]')
    expect(overlay).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run tests/content-highlight.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement highlight-overlay.ts**

Create `src/content/highlight-overlay.ts`:

```typescript
let currentOverlay: HTMLDivElement | null = null
let fadeTimer: ReturnType<typeof setTimeout> | null = null

const FADE_MS = 3000
const Z_INDEX = 2147483647

export function showHighlight(opts: { selector: string; targetId: string; name?: string; reason?: string }): void {
  clearHighlight()

  const el = document.querySelector(opts.selector)
  if (!el) return

  const rect = el.getBoundingClientRect()
  const overlay = document.createElement('div')
  overlay.setAttribute('data-agrune-highlight', opts.targetId)
  Object.assign(overlay.style, {
    position: 'fixed',
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    border: '2px solid #cba6f7',
    backgroundColor: 'rgba(203, 166, 247, 0.15)',
    borderRadius: '4px',
    zIndex: String(Z_INDEX),
    pointerEvents: 'none',
    transition: 'opacity 0.3s ease-out',
  })

  // Label above the element
  if (opts.name) {
    const label = document.createElement('div')
    label.textContent = opts.reason ? `${opts.name} · ${opts.reason}` : opts.name
    Object.assign(label.style, {
      position: 'fixed',
      top: `${Math.max(0, rect.top - 20)}px`,
      left: `${rect.left}px`,
      background: '#cba6f7',
      color: '#1e1e2e',
      fontSize: '10px',
      fontFamily: 'system-ui, sans-serif',
      padding: '1px 6px',
      borderRadius: '2px',
      zIndex: String(Z_INDEX),
      pointerEvents: 'none',
      transition: 'opacity 0.3s ease-out',
    })
    overlay.appendChild(label)
  }

  document.body.appendChild(overlay)
  currentOverlay = overlay

  fadeTimer = setTimeout(() => {
    if (currentOverlay === overlay) {
      overlay.style.opacity = '0'
      setTimeout(() => clearHighlight(), 300)
    }
  }, FADE_MS)
}

export function clearHighlight(): void {
  if (fadeTimer) {
    clearTimeout(fadeTimer)
    fadeTimer = null
  }
  if (currentOverlay) {
    currentOverlay.remove()
    currentOverlay = null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run tests/content-highlight.spec.ts`
Expected: PASS

- [ ] **Step 5: Wire handlers into content/index.ts**

In `src/content/index.ts`, add import at top:

```typescript
import { showHighlight, clearHighlight } from './highlight-overlay'
```

In the `chrome.runtime.onMessage.addListener` callback (around line 72), add two handlers:

```typescript
if (msg.type === 'highlight_target') {
  showHighlight({ selector: msg.selector, targetId: msg.targetId })
}
if (msg.type === 'clear_highlight') {
  clearHighlight()
}
```

- [ ] **Step 6: Run all tests**

Run: `cd packages/extension && npx vitest run`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add packages/extension/src/content/highlight-overlay.ts packages/extension/tests/content-highlight.spec.ts packages/extension/src/content/index.ts
git commit -m "feat(inspector): add highlight overlay for content script"
```

---

### Task 6: Build pipeline + manifest

**Files:**
- Modify: `vite.config.ts`
- Modify: `manifest.json`

- [ ] **Step 1: Add devtools + panel build entries to vite.config.ts**

In the `closeBundle` plugin, after the `page-runtime.ts` entry, add:

```typescript
await buildEntry({
  entry: 'src/devtools/devtools.ts',
  fileName: 'devtools.js',
  name: 'agruneDevtools',
})
await buildEntry({
  entry: 'src/devtools/panel.ts',
  fileName: 'panel.js',
  name: 'agruneDevtoolsPanel',
})
```

- [ ] **Step 2: Add panel.css copy**

After the build entries in `closeBundle`, add (reuse the top-level `resolve` import):

```typescript
const { copyFileSync } = await import('fs')
copyFileSync(
  resolve(__dirname, 'src/devtools/panel.css'),
  resolve(__dirname, 'dist/panel.css'),
)
```

- [ ] **Step 3: Add devtools_page to manifest.json**

Add at root level:

```json
"devtools_page": "src/devtools/devtools.html"
```

- [ ] **Step 4: Commit**

```bash
git add packages/extension/vite.config.ts packages/extension/manifest.json
git commit -m "chore(inspector): add devtools build entries and manifest devtools_page"
```

---

### Task 7: DevTools entry point

**Files:**
- Create: `src/devtools/devtools.html`
- Create: `src/devtools/devtools.ts`

- [ ] **Step 1: Create devtools.html**

```html
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body>
  <script src="../../dist/devtools.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create devtools.ts**

```typescript
chrome.devtools.panels.create(
  'Agrune',
  '',
  'src/devtools/panel.html',
)
```

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/devtools/devtools.html packages/extension/src/devtools/devtools.ts
git commit -m "feat(inspector): add DevTools entry point with panel creation"
```

---

### Task 8: Panel HTML + CSS skeleton

**Files:**
- Create: `src/devtools/panel.html`
- Create: `src/devtools/panel.css`

- [ ] **Step 1: Create panel.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="../../dist/panel.css" />
</head>
<body>
  <div id="toolbar">
    <button id="pauseBtn" type="button" title="Pause/Resume">⏸ Pause</button>
    <span id="snapshotInfo">No snapshot</span>
    <div class="toolbar-spacer"></div>
    <select id="reasonFilter"><option value="">All reasons</option></select>
    <select id="actionFilter"><option value="">All actions</option></select>
    <input id="searchInput" type="text" placeholder="Search targets..." />
  </div>
  <div id="main">
    <div id="targetList"></div>
    <div id="detailPane">
      <p class="empty-detail">Select a target</p>
    </div>
  </div>
  <script src="../../dist/panel.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create panel.css**

Catppuccin Mocha color scheme consistent with popup:

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 11px;
  color: #cdd6f4;
  background: #1e1e2e;
  overflow: hidden;
  height: 100vh;
  display: flex;
  flex-direction: column;
}

/* --- Toolbar --- */
#toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #181825;
  border-bottom: 1px solid #313244;
  flex-shrink: 0;
}

#toolbar button {
  background: #313244;
  border: 1px solid #45475a;
  color: #cdd6f4;
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 10px;
  cursor: pointer;
}
#toolbar button:hover { background: #45475a; }
#toolbar button.paused { color: #a6e3a1; }

#snapshotInfo { color: #6c7086; font-size: 10px; }

.toolbar-spacer { flex: 1; }

#toolbar select,
#toolbar input {
  background: #313244;
  border: 1px solid #45475a;
  color: #cdd6f4;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 10px;
}
#toolbar input { width: 140px; }

/* --- Main layout --- */
#main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* --- Target list (left) --- */
#targetList {
  flex: 1;
  overflow-y: auto;
  border-right: 1px solid #313244;
}

.group-header {
  padding: 4px 10px;
  background: #11111b;
  color: #a6adc8;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  user-select: none;
}
.group-header:hover { background: #181825; }
.group-desc { color: #585b70; font-weight: 400; }
.group-count { color: #585b70; }

.target-row {
  padding: 4px 10px 4px 20px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.target-row:hover { background: #262637; }
.target-row.selected {
  background: #262637;
  border-left: 2px solid #cba6f7;
  padding-left: 18px;
}
.target-row.hidden { display: none; }

.reason-dot { font-size: 10px; }
.reason-dot.ready { color: #a6e3a1; }
.reason-dot.covered { color: #f38ba8; }
.reason-dot.hidden-reason { color: #fab387; }
.reason-dot.offscreen { color: #fab387; }
.reason-dot.disabled { color: #6c7086; }
.reason-dot.sensitive { color: #f9e2af; }

.target-name { color: #cdd6f4; }
.target-name.not-ready { color: #7f849c; }

.target-action { color: #585b70; font-size: 9px; margin-left: auto; }

.reason-badge {
  padding: 0 4px;
  border-radius: 2px;
  font-size: 8px;
  font-weight: 600;
  color: #1e1e2e;
}
.reason-badge.ready { background: #a6e3a1; }
.reason-badge.covered { background: #f38ba8; }
.reason-badge.hidden-reason { background: #fab387; }
.reason-badge.offscreen { background: #fab387; }
.reason-badge.disabled { background: #6c7086; color: #cdd6f4; }
.reason-badge.sensitive { background: #f9e2af; }

/* --- Detail pane (right) --- */
#detailPane {
  width: 280px;
  padding: 10px;
  overflow-y: auto;
  background: #181825;
  flex-shrink: 0;
}

.empty-detail { color: #585b70; text-align: center; margin-top: 40px; }

.detail-name { color: #cba6f7; font-weight: 700; font-size: 12px; margin-bottom: 4px; }
.detail-group { color: #585b70; font-size: 9px; margin-bottom: 10px; }

.detail-table { width: 100%; border-collapse: collapse; }
.detail-table td { padding: 3px 0; font-size: 10px; }
.detail-table td:first-child { color: #6c7086; width: 110px; }
.detail-table td:last-child { color: #cdd6f4; }

.detail-bool-true { color: #a6e3a1; }
.detail-bool-false { color: #f38ba8; }

.action-badge {
  background: #89b4fa;
  color: #1e1e2e;
  padding: 0 4px;
  border-radius: 2px;
  font-size: 9px;
}

.detail-source {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid #313244;
}
.detail-source-label { color: #6c7086; font-size: 9px; margin-bottom: 4px; }
.detail-source-link { color: #89dceb; font-size: 10px; cursor: pointer; }
.detail-source-link:hover { text-decoration: underline; }

.highlight-btn {
  margin-top: 10px;
  width: 100%;
  background: #313244;
  border: 1px solid #45475a;
  color: #cdd6f4;
  border-radius: 4px;
  padding: 5px;
  font-size: 10px;
  cursor: pointer;
}
.highlight-btn:hover { background: #45475a; }
```

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/devtools/panel.html packages/extension/src/devtools/panel.css
git commit -m "feat(inspector): add panel HTML skeleton and CSS"
```

---

### Task 9: Panel logic — port connection + snapshot rendering

**Files:**
- Create: `src/devtools/panel.ts`

- [ ] **Step 1: Implement panel.ts core**

```typescript
import type { PageSnapshot, PageSnapshotGroup, PageTarget } from '@agrune/core'

// --- State ---
let snapshot: PageSnapshot | null = null
let selectedTargetId: string | null = null
let paused = false
const collapsedGroups = new Set<string>()

// --- DOM refs ---
const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement
const snapshotInfo = document.getElementById('snapshotInfo') as HTMLSpanElement
const reasonFilter = document.getElementById('reasonFilter') as HTMLSelectElement
const actionFilter = document.getElementById('actionFilter') as HTMLSelectElement
const searchInput = document.getElementById('searchInput') as HTMLInputElement
const targetList = document.getElementById('targetList') as HTMLDivElement
const detailPane = document.getElementById('detailPane') as HTMLDivElement

// --- Port connection ---
const tabId = chrome.devtools.inspectedWindow.tabId
const port = chrome.runtime.connect({ name: 'devtools-inspector' })
port.postMessage({ type: 'subscribe_snapshot', tabId })

port.onMessage.addListener((msg: unknown) => {
  const m = msg as { type: string }
  if (m.type === 'devtools_snapshot') {
    const snap = (msg as { snapshot: PageSnapshot }).snapshot
    if (!paused) {
      snapshot = snap
      render()
    }
  }
})

// --- Pause/Resume ---
pauseBtn.addEventListener('click', () => {
  paused = !paused
  pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause'
  pauseBtn.classList.toggle('paused', paused)
})

// --- Filters ---
reasonFilter.addEventListener('change', render)
actionFilter.addEventListener('change', render)
searchInput.addEventListener('input', render)

// --- Render ---
function reasonClass(reason: string): string {
  if (reason === 'hidden') return 'hidden-reason'
  return reason
}

function render() {
  if (!snapshot) {
    snapshotInfo.textContent = 'Waiting for snapshot...'
    targetList.innerHTML = ''
    detailPane.innerHTML = '<p class="empty-detail">No snapshot yet</p>'
    return
  }

  const elapsed = ((Date.now() - snapshot.capturedAt) / 1000).toFixed(1)
  snapshotInfo.textContent = `v${snapshot.version} · ${elapsed}s ago · ${snapshot.targets.length} targets`

  // Populate reason filter dynamically
  const reasons = [...new Set(snapshot.targets.map(t => t.reason))]
  const currentReason = reasonFilter.value
  reasonFilter.innerHTML = '<option value="">All reasons</option>' +
    reasons.map(r => `<option value="${r}"${r === currentReason ? ' selected' : ''}>${r}</option>`).join('')

  // Populate action filter dynamically
  const actionKinds = [...new Set(snapshot.targets.map(t => t.actionKind))]
  const currentAction = actionFilter.value
  actionFilter.innerHTML = '<option value="">All actions</option>' +
    actionKinds.map(k => `<option value="${k}"${k === currentAction ? ' selected' : ''}>${k}</option>`).join('')

  const rFilter = reasonFilter.value
  const aFilter = actionFilter.value
  const search = searchInput.value.toLowerCase()

  // Build target list by group
  targetList.innerHTML = ''
  for (const group of snapshot.groups) {
    const groupTargets = group.targetIds
      .map(id => snapshot!.targets.find(t => t.targetId === id))
      .filter((t): t is PageTarget => !!t)
      .filter(t => !rFilter || t.reason === rFilter)
      .filter(t => !aFilter || t.actionKind === aFilter)
      .filter(t => !search || t.name.toLowerCase().includes(search) || (t.groupName ?? '').toLowerCase().includes(search) || (t.textContent ?? '').toLowerCase().includes(search))

    if (groupTargets.length === 0) continue

    const collapsed = collapsedGroups.has(group.groupId)

    // Group header
    const header = document.createElement('div')
    header.className = 'group-header'
    header.innerHTML = `<span>${collapsed ? '▸' : '▾'} ${group.groupName ?? group.groupId} <span class="group-desc">${group.groupDesc ? '— ' + group.groupDesc : ''}</span></span><span class="group-count">${groupTargets.length}</span>`
    header.addEventListener('click', () => {
      if (collapsedGroups.has(group.groupId)) collapsedGroups.delete(group.groupId)
      else collapsedGroups.add(group.groupId)
      render()
    })
    targetList.appendChild(header)

    if (collapsed) continue

    // Target rows
    for (const target of groupTargets) {
      const row = document.createElement('div')
      row.className = 'target-row' + (target.targetId === selectedTargetId ? ' selected' : '')
      row.innerHTML = `<span class="reason-dot ${reasonClass(target.reason)}">●</span><span class="target-name${target.reason !== 'ready' ? ' not-ready' : ''}">${target.name}</span><span class="target-action">${target.actionKind}</span><span class="reason-badge ${reasonClass(target.reason)}">${target.reason}</span>`
      row.addEventListener('click', () => {
        selectedTargetId = target.targetId
        render()
        highlightInPage(target)
      })
      targetList.appendChild(row)
    }
  }

  renderDetail()
}

function renderDetail() {
  if (!snapshot || !selectedTargetId) {
    detailPane.innerHTML = '<p class="empty-detail">Select a target</p>'
    return
  }

  const target = snapshot.targets.find(t => t.targetId === selectedTargetId)
  if (!target) {
    detailPane.innerHTML = '<p class="empty-detail">Target not found in current snapshot</p>'
    return
  }

  const boolCell = (v: boolean) => `<span class="${v ? 'detail-bool-true' : 'detail-bool-false'}">${v}</span>`

  detailPane.innerHTML = `
    <div class="detail-name">${target.name}</div>
    <div class="detail-group">${target.groupName ?? target.groupId} group</div>
    <table class="detail-table">
      <tr><td>targetId</td><td>${target.targetId}</td></tr>
      <tr><td>actionKind</td><td><span class="action-badge">${target.actionKind}</span></td></tr>
      <tr><td>visible</td><td>${boolCell(target.visible)}</td></tr>
      <tr><td>enabled</td><td>${boolCell(target.enabled)}</td></tr>
      <tr><td>inViewport</td><td>${boolCell(target.inViewport)}</td></tr>
      <tr><td>covered</td><td>${boolCell(target.covered)}</td></tr>
      <tr><td>actionableNow</td><td>${boolCell(target.actionableNow)}</td></tr>
      <tr><td>reason</td><td><span class="reason-badge ${reasonClass(target.reason)}">${target.reason}</span></td></tr>
      <tr><td>sensitive</td><td>${target.sensitive ? '<span class="detail-bool-false">true 🔒</span>' : boolCell(false)}</td></tr>
      <tr><td>selector</td><td style="color:#89dceb;font-size:9px;">${target.selector}</td></tr>
      <tr><td>textContent</td><td>${target.textContent ? target.textContent : '<span style="color:#585b70;font-style:italic;">—</span>'}</td></tr>
      <tr><td>valuePreview</td><td>${target.valuePreview ?? '<span style="color:#585b70;font-style:italic;">—</span>'}</td></tr>
    </table>
    <div class="detail-source">
      <div class="detail-source-label">Source</div>
      <div class="detail-source-link" id="sourceLink">${target.sourceFile}:${target.sourceLine}:${target.sourceColumn}</div>
    </div>
    <button class="highlight-btn" id="highlightBtn">🔍 Highlight in Page</button>
  `

  document.getElementById('sourceLink')?.addEventListener('click', () => {
    chrome.devtools.panels.openResource(target.sourceFile, target.sourceLine - 1, () => {})
  })

  document.getElementById('highlightBtn')?.addEventListener('click', () => {
    highlightInPage(target)
  })
}

function highlightInPage(target: PageTarget) {
  port.postMessage({
    type: 'highlight_target',
    tabId,
    targetId: target.targetId,
    selector: target.selector,
  })
}

// --- Initial render ---
render()
```

- [ ] **Step 2: Verify typecheck**

Run: `cd packages/extension && npx tsc --noEmit`
Expected: no errors (devtools types come from `@types/chrome`)

- [ ] **Step 3: Verify build**

Run: `cd packages/extension && npm run build`
Expected: builds without errors, `dist/devtools.js`, `dist/panel.js`, `dist/panel.css` created

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/devtools/panel.ts
git commit -m "feat(inspector): implement panel logic — port connection, rendering, filters, detail pane"
```

---

### Task 10: Manual integration test

- [ ] **Step 1: Run full test suite**

Run: `cd packages/extension && npx vitest run`
Expected: all tests pass

- [ ] **Step 2: Build extension**

Run: `cd packages/extension && npm run build`
Expected: clean build

- [ ] **Step 3: Verify dist output**

Check that all new files exist:
- `dist/devtools.js`
- `dist/panel.js`
- `dist/panel.css`

- [ ] **Step 4: Load extension in Chrome and verify**

1. Open `chrome://extensions`, load unpacked `packages/extension`
2. Navigate to a page with `data-agrune-*` annotations
3. Open DevTools → find "Agrune" tab
4. Verify: targets appear, grouping works, filters work
5. Click a target → detail pane shows, page element highlights
6. Test pause/resume

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(inspector): complete DevTools target inspector panel"
```
