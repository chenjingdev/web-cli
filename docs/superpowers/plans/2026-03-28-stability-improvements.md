# 안정성 고도화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 MCP 호출 시 CDP 디버거 즉시 연결 + wheel 액션 다단계 줌 지원

**Architecture:** cdp-handler에 `ensureAttached` export 추가 → message-router에서 command_request 수신 시 eager attach. wheel 액션에 `steps`/`durationMs` 옵션 추가하여 command-handlers에서 자동 분배.

**Tech Stack:** TypeScript, Vitest, Chrome Extensions API (Manifest V3), CDP Input.dispatchMouseEvent

---

## Task 1: CDP eager attach — cdp-handler에 ensureAttached export

**Files:**
- Modify: `packages/extension/src/background/cdp-handler.ts:8-15` (CdpHandler 인터페이스)
- Modify: `packages/extension/src/background/cdp-handler.ts:108` (return 객체)
- Test: `packages/extension/tests/background/cdp-handler.spec.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/extension/tests/background/cdp-handler.spec.ts` 하단에 추가:

```typescript
it('exposes ensureAttached that attaches debugger without sending a command', async () => {
  const { chromeMock } = createChromeMock()
  const handler = createCdpHandler({ api: chromeMock })
  handler.register()

  await handler.ensureAttached(42)

  expect(chromeMock.debugger.attach).toHaveBeenCalledWith({ tabId: 42 }, '1.3')
  expect(chromeMock.debugger.sendCommand).not.toHaveBeenCalled()
  expect(handler.isAttached(42)).toBe(true)
})

it('ensureAttached is idempotent — second call does not re-attach', async () => {
  const { chromeMock } = createChromeMock()
  const handler = createCdpHandler({ api: chromeMock })
  handler.register()

  await handler.ensureAttached(42)
  await handler.ensureAttached(42)

  expect(chromeMock.debugger.attach).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/extension && pnpm vitest run tests/background/cdp-handler.spec.ts`
Expected: FAIL — `handler.ensureAttached is not a function`

- [ ] **Step 3: CdpHandler 인터페이스에 ensureAttached 추가**

`packages/extension/src/background/cdp-handler.ts:8-15`를 다음으로 변경:

```typescript
export interface CdpHandler {
  handleRequest(tabId: number, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
  ensureAttached(tabId: number): Promise<void>
  detach(tabId: number): void
  detachAll(): void
  isAttached(tabId: number): boolean
  notifyActivity(tabId: number): void
  register(): void
}
```

`packages/extension/src/background/cdp-handler.ts:108`의 return 객체에 `ensureAttached` 추가:

```typescript
return { handleRequest, ensureAttached, detach, detachAll, isAttached: (id) => attachedTabs.has(id), notifyActivity, register }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd packages/extension && pnpm vitest run tests/background/cdp-handler.spec.ts`
Expected: ALL PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/extension/src/background/cdp-handler.ts packages/extension/tests/background/cdp-handler.spec.ts
git commit -m "feat(extension): export ensureAttached from cdp-handler"
```

---

## Task 2: CDP eager attach — message-router에서 command_request 시 attach

**Files:**
- Modify: `packages/extension/src/background/message-router.ts:19` (cdpHandler 타입)
- Modify: `packages/extension/src/background/message-router.ts:89-93` (command_request 핸들러)
- Test: `packages/extension/tests/background/message-router.spec.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/extension/tests/background/message-router.spec.ts` 하단에 추가:

```typescript
it('calls cdpHandler.ensureAttached on command_request from native host', () => {
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
  const cdpHandler = {
    handleRequest: vi.fn(() => Promise.resolve({})),
    notifyActivity: vi.fn(),
    ensureAttached: vi.fn(() => Promise.resolve()),
  }

  const router = createBackgroundMessageRouter({
    api: chrome.chromeMock,
    controller,
    broadcaster,
    cdpHandler,
  })
  router.register()

  router.handleNativeHostMessage({
    type: 'command_request',
    tabId: 42,
    commandId: 'cmd-1',
    command: { kind: 'snapshot' },
  } as never)

  expect(cdpHandler.ensureAttached).toHaveBeenCalledWith(42)
  expect(broadcaster.sendToTab).toHaveBeenCalledWith(
    42,
    expect.objectContaining({ type: 'command_request', tabId: 42 }),
  )
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/extension && pnpm vitest run tests/background/message-router.spec.ts`
Expected: FAIL — `cdpHandler.ensureAttached` not called

- [ ] **Step 3: message-router 수정**

`packages/extension/src/background/message-router.ts:19`의 cdpHandler 타입 변경:

```typescript
cdpHandler?: Pick<CdpHandler, 'handleRequest' | 'notifyActivity' | 'ensureAttached'>
```

`packages/extension/src/background/message-router.ts:89-93`의 command_request 핸들러 변경:

```typescript
case 'command_request':
  if (typeof msg.tabId === 'number') {
    cdpHandler?.ensureAttached(msg.tabId).catch(() => {})
    cdpHandler?.notifyActivity(msg.tabId)
    broadcaster.sendToTab(msg.tabId, msg as unknown as Record<string, unknown>)
  }
  break
```

`ensureAttached`는 fire-and-forget — attach 완료를 기다리지 않고 명령을 즉시 전달. 읽기 전용 명령은 CDP 없이 실행되므로 지연 없음. `.catch(() => {})` 로 unhandled rejection 방지.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd packages/extension && pnpm vitest run tests/background/message-router.spec.ts`
Expected: ALL PASS

- [ ] **Step 5: 기존 테스트의 cdpHandler mock에 ensureAttached 추가**

`Pick<CdpHandler, ... | 'ensureAttached'>` 타입 변경으로, 기존 테스트에서 cdpHandler를 생성하는 곳에 `ensureAttached: vi.fn(() => Promise.resolve())` 추가 필요. 해당 위치:

- `message-router.spec.ts` line 358-365 (`routes cdp_request...` 테스트)
- `message-router.spec.ts` line 403-410 (`routes cdp_response...` 테스트)
- `message-router.spec.ts` line 454-461 (`routes cdp_request error...` 테스트)

각 cdpHandler 객체에 한 줄 추가:
```typescript
ensureAttached: vi.fn(() => Promise.resolve()),
```

cdpHandler가 없는 테스트들은 `cdpHandler?.ensureAttached(...)` optional chaining으로 skip되므로 변경 불필요.

Run: `cd packages/extension && pnpm vitest run tests/background/message-router.spec.ts`
Expected: ALL PASS

- [ ] **Step 6: 커밋**

```bash
git add packages/extension/src/background/message-router.ts packages/extension/tests/background/message-router.spec.ts
git commit -m "feat(extension): eager CDP attach on command_request"
```

---

## Task 3: wheel steps — core 타입 확장

**Files:**
- Modify: `packages/core/src/index.ts:163`
- Test: 타입 변경이라 별도 테스트 불필요 (다음 Task에서 검증)

- [ ] **Step 1: PointerAction wheel 타입에 steps, durationMs 추가**

`packages/core/src/index.ts:163`의 wheel 유니온 멤버를 변경:

```typescript
| { type: 'wheel'; x: number; y: number; deltaY: number; ctrlKey?: boolean; delayMs?: number; steps?: number; durationMs?: number }
```

- [ ] **Step 2: 타입 체크**

Run: `cd packages/core && pnpm tsc --noEmit`
Expected: 성공 (기존 코드는 새 optional 필드를 무시하므로 깨지지 않음)

- [ ] **Step 3: 커밋**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): add steps and durationMs to wheel action type"
```

---

## Task 4: wheel steps — command-handlers 구현

**Files:**
- Modify: `packages/build-core/src/runtime/command-handlers.ts:1066-1071` (handlePointer input 타입)
- Modify: `packages/build-core/src/runtime/command-handlers.ts:1118-1120` (wheel case)
- Test: `packages/build-core/tests/runtime.spec.ts` (handlePointer 테스트 추가)

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/build-core/tests/runtime.spec.ts`에서 handlePointer 관련 테스트 블록을 찾아 하단에 추가 (이 파일이 handlePointer 테스트를 포함하는지 먼저 확인. 없으면 `packages/build-core/tests/event-sequences.spec.ts`에 추가):

```typescript
it('wheel with steps splits deltaY evenly and adds delays', async () => {
  vi.useFakeTimers()
  const cdp = mockCdpClient()
  const seq = createEventSequences(cdp)

  const wheelCalls: Array<{ deltaY: number }> = []
  cdp.sendCdpEvent.mockImplementation((_method: string, params: Record<string, unknown>) => {
    if (params.type === 'mouseWheel') {
      wheelCalls.push({ deltaY: params.deltaY as number })
    }
    return Promise.resolve({})
  })

  // steps=3, durationMs=300 → 3 wheel events, deltaY=-120 each, 100ms between
  const actions = [
    { type: 'wheel' as const, x: 500, y: 300, deltaY: -360, ctrlKey: true, steps: 3, durationMs: 300 },
  ]

  // handlePointer를 직접 테스트하기 어려우므로 event-sequences 레벨에서 검증 불가.
  // 대신 command-handlers의 wheel 분배 로직만 유닛으로 분리하여 테스트.
  // → 아래 Step 3에서 expandWheelSteps 헬퍼를 추출하여 테스트.
})
```

실제로는 `expandWheelSteps` 헬퍼를 추출해서 테스트하는 게 깔끔함. 테스트를 다시 작성:

`packages/build-core/tests/event-sequences.spec.ts` 하단에 추가:

```typescript
import { expandWheelSteps } from '../src/runtime/command-handlers'

describe('expandWheelSteps', () => {
  it('returns single action unchanged when steps is undefined', () => {
    const action = { type: 'wheel' as const, x: 500, y: 300, deltaY: -120, ctrlKey: true }
    const result = expandWheelSteps(action)
    expect(result).toEqual([{ type: 'wheel', x: 500, y: 300, deltaY: -120, ctrlKey: true }])
  })

  it('splits deltaY evenly across steps with delay', () => {
    const action = { type: 'wheel' as const, x: 500, y: 300, deltaY: -360, ctrlKey: true, steps: 3, durationMs: 300 }
    const result = expandWheelSteps(action)
    expect(result).toEqual([
      { type: 'wheel', x: 500, y: 300, deltaY: -120, ctrlKey: true, delayMs: 100 },
      { type: 'wheel', x: 500, y: 300, deltaY: -120, ctrlKey: true, delayMs: 100 },
      { type: 'wheel', x: 500, y: 300, deltaY: -120, ctrlKey: true },
    ])
  })

  it('last step has no delayMs (clean termination)', () => {
    const action = { type: 'wheel' as const, x: 500, y: 300, deltaY: -200, steps: 2, durationMs: 200 }
    const result = expandWheelSteps(action)
    expect(result).toHaveLength(2)
    expect(result[0].delayMs).toBe(100)
    expect(result[1].delayMs).toBeUndefined()
  })

  it('preserves existing delayMs on the last step', () => {
    const action = { type: 'wheel' as const, x: 500, y: 300, deltaY: -360, steps: 3, durationMs: 300, delayMs: 50 }
    const result = expandWheelSteps(action)
    expect(result).toHaveLength(3)
    expect(result[2].delayMs).toBe(50)
  })

  it('steps=1 returns single action without splitting', () => {
    const action = { type: 'wheel' as const, x: 500, y: 300, deltaY: -120, steps: 1, durationMs: 100 }
    const result = expandWheelSteps(action)
    expect(result).toEqual([{ type: 'wheel', x: 500, y: 300, deltaY: -120 }])
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/build-core && pnpm vitest run tests/event-sequences.spec.ts`
Expected: FAIL — `expandWheelSteps` not exported

- [ ] **Step 3: expandWheelSteps 구현**

`packages/build-core/src/runtime/command-handlers.ts`에서 `handlePointer` 함수 바로 위에 추가:

```typescript
type WheelAction = { type: 'wheel'; x: number; y: number; deltaY: number; ctrlKey?: boolean; delayMs?: number; steps?: number; durationMs?: number }

export function expandWheelSteps(action: WheelAction): Array<{ type: 'wheel'; x: number; y: number; deltaY: number; ctrlKey?: boolean; delayMs?: number }> {
  const steps = action.steps
  if (steps == null || steps <= 1) {
    const { steps: _, durationMs: __, ...rest } = action
    return [rest]
  }
  const perStep = action.deltaY / steps
  const intervalMs = action.durationMs != null ? action.durationMs / steps : 0
  const result: Array<{ type: 'wheel'; x: number; y: number; deltaY: number; ctrlKey?: boolean; delayMs?: number }> = []
  for (let i = 0; i < steps; i++) {
    const isLast = i === steps - 1
    const entry: { type: 'wheel'; x: number; y: number; deltaY: number; ctrlKey?: boolean; delayMs?: number } = {
      type: 'wheel',
      x: action.x,
      y: action.y,
      deltaY: perStep,
    }
    if (action.ctrlKey) entry.ctrlKey = action.ctrlKey
    if (!isLast && intervalMs > 0) {
      entry.delayMs = intervalMs
    } else if (isLast && action.delayMs != null) {
      entry.delayMs = action.delayMs
    }
    result.push(entry)
  }
  return result
}
```

- [ ] **Step 4: handlePointer에서 expandWheelSteps 적용**

`packages/build-core/src/runtime/command-handlers.ts`의 `handlePointer` 내 wheel 액션 타입에 `steps`, `durationMs` 추가 (line 1070):

```typescript
| { type: 'wheel'; x: number; y: number; deltaY: number; ctrlKey?: boolean; delayMs?: number; steps?: number; durationMs?: number }
```

for 루프(line 1107-1125)를 변경:

```typescript
for (const action of input.actions) {
  if (action.type === 'wheel' && (action as WheelAction).steps != null) {
    const expanded = expandWheelSteps(action as WheelAction)
    for (const step of expanded) {
      await deps.eventSequences.wheel({ x: step.x, y: step.y }, step.deltaY, step.ctrlKey)
      if (step.delayMs != null && step.delayMs > 0) {
        await new Promise(r => setTimeout(r, step.delayMs))
      }
    }
    continue
  }
  switch (action.type) {
    case 'pointerdown':
      await deps.eventSequences.mousePressed({ x: action.x, y: action.y })
      break
    case 'pointermove':
      await deps.eventSequences.mouseMoved({ x: action.x, y: action.y })
      break
    case 'pointerup':
      await deps.eventSequences.mouseReleased({ x: action.x, y: action.y })
      break
    case 'wheel':
      await deps.eventSequences.wheel({ x: action.x, y: action.y }, action.deltaY, action.ctrlKey)
      break
  }
  if (action.delayMs != null && action.delayMs > 0) {
    await new Promise(r => setTimeout(r, action.delayMs))
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd packages/build-core && pnpm vitest run tests/event-sequences.spec.ts`
Expected: ALL PASS

- [ ] **Step 6: 커밋**

```bash
git add packages/build-core/src/runtime/command-handlers.ts packages/build-core/tests/event-sequences.spec.ts
git commit -m "feat(build-core): add expandWheelSteps for smooth multi-step zoom"
```

---

## Task 5: wheel steps — MCP 도구 스키마 업데이트

**Files:**
- Modify: `packages/mcp-server/src/mcp-tools.ts:113-120`

- [ ] **Step 1: wheel 스키마에 steps, durationMs 추가**

`packages/mcp-server/src/mcp-tools.ts:113-120`의 wheel 객체를 변경:

```typescript
z.object({
  type: z.literal('wheel'),
  x: z.number().describe('Viewport X'),
  y: z.number().describe('Viewport Y'),
  deltaY: z.number().describe('Scroll delta (negative = zoom in)'),
  ctrlKey: z.boolean().optional().describe('Hold Ctrl (for pinch-zoom)'),
  delayMs: z.number().optional().describe('Delay in ms after this action'),
  steps: z.number().int().min(1).optional().describe('Split deltaY into N equal steps for smooth zoom'),
  durationMs: z.number().optional().describe('Total duration across all steps in ms'),
}),
```

- [ ] **Step 2: 빌드 확인**

Run: `pnpm build`
Expected: 성공

- [ ] **Step 3: 커밋**

```bash
git add packages/mcp-server/src/mcp-tools.ts
git commit -m "feat(mcp-server): add steps and durationMs to wheel action schema"
```

---

## Task 6: 전체 테스트 + 타입체크

- [ ] **Step 1: 전체 타입체크**

Run: `pnpm typecheck`
Expected: 성공

- [ ] **Step 2: 전체 테스트**

Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 3: 빌드**

Run: `pnpm build`
Expected: 성공

- [ ] **Step 4: 문제 있으면 수정 후 커밋**

문제 발생 시 수정하고:
```bash
git add -A
git commit -m "fix: resolve typecheck/test issues from stability improvements"
```
