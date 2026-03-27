# CDP 와이어링 + 합성 Fallback 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** CDP event sequences를 실제로 활성화하고, 합성 이벤트 fallback 코드를 제거한다.

**Architecture:** `page-agent-runtime.ts`에 CDP postMessage 콜백을 주입하여 `createCdpClient()` → `createEventSequences()` 체인을 연결. 검증 후 `synthetic-dispatch.ts` 및 관련 분기를 전부 제거하고 `eventSequences`를 non-null 필수 의존성으로 변경.

**Tech Stack:** TypeScript, Vitest, Chrome DevTools Protocol, pnpm monorepo

**Spec:** `docs/superpowers/specs/2026-03-27-cdp-wiring-and-fallback-removal-design.md`

---

## File Map

**Modify:**
- `packages/build-core/src/types.ts` — `AgagruneRuntimeOptions`에 `cdpPostMessage` 필드 추가
- `packages/build-core/src/runtime/page-agent-runtime.ts` — CDP client 생성 및 eventSequences 연결, dispose 정리, synthetic import 제거
- `packages/build-core/src/runtime/command-handlers.ts` — `SyntheticDispatchFallback` 인터페이스/분기 제거, `eventSequences` non-null화
- `packages/extension/src/runtime/page-runtime.ts` — `installRuntime()`에서 `cdpPostMessage: sendToContentScript` 전달

**Delete:**
- `packages/build-core/src/runtime/synthetic-dispatch.ts`

**Test (modify):**
- `packages/build-core/tests/runtime.spec.ts` — CDP postMessage mock 추가

**Test (keep as-is):**
- `packages/build-core/tests/event-sequences.spec.ts`
- `packages/build-core/tests/cdp-client.spec.ts`

---

### Task 1: AgagruneRuntimeOptions에 cdpPostMessage 필드 추가

**Files:**
- Modify: `packages/build-core/src/types.ts:3-8`

- [x] **Step 1: cdpPostMessage 옵션 필드 추가**

`packages/build-core/src/types.ts`에서 `AgagruneRuntimeOptions` 인터페이스에 optional 필드 추가:

```typescript
export interface AgagruneRuntimeOptions {
  clickAutoScroll: boolean
  clickRetryCount: number
  clickRetryDelayMs: number
  postMessage?: (type: string, data: unknown) => void
  /** Bridge callback for CDP request relay. When provided, CDP event sequences are activated. */
  cdpPostMessage?: (type: string, data: unknown) => void
}
```

- [x] **Step 2: 타입체크 확인**

Run: `cd packages/build-core && pnpm typecheck`
Expected: PASS (새 optional 필드라 기존 코드에 영향 없음)

- [x] **Step 3: Commit**

```bash
git add packages/build-core/src/types.ts
git commit -m "feat(build-core): add cdpPostMessage option to AgagruneRuntimeOptions"
```

---

### Task 2: page-agent-runtime에서 CDP 와이어링

**Files:**
- Modify: `packages/build-core/src/runtime/page-agent-runtime.ts:1-51, 267-278, 324-328`

- [x] **Step 1: CDP import 추가**

`page-agent-runtime.ts` 상단에 import 추가:

```typescript
import { createCdpClient, type CdpClient } from './cdp-client'
import { createEventSequences } from './event-sequences'
```

- [x] **Step 2: createPageAgentRuntime 내부에서 CDP client 생성**

`page-agent-runtime.ts`의 `createPageAgentRuntime()` 함수 내부, `const queue = ...` 이후 (175행 부근), deps 생성 이전에 CDP 초기화 코드 추가:

```typescript
  // CDP event sequences — activated when cdpPostMessage callback is provided
  let cdpClient: CdpClient | null = null
  let eventSequences: EventSequences | null = null

  if (runtimeOptions.cdpPostMessage) {
    cdpClient = createCdpClient(runtimeOptions.cdpPostMessage)
    eventSequences = createEventSequences(cdpClient)
  }
```

`EventSequences` 타입도 import에 추가:

```typescript
import type { EventSequences } from './event-sequences'
```

- [x] **Step 3: deps 객체에서 eventSequences 연결, syntheticFallback을 조건부로**

기존 deps 생성 (267-278행):

```typescript
  const deps: CommandHandlerDeps = {
    captureSnapshot,
    captureSettledSnapshot,
    getDescriptors,
    resolveExecutionConfig,
    queue,
    // CDP event sequences are not yet wired — the synthetic fallback
    // handles all pointer/mouse/drag dispatch (sufficient for jsdom tests).
    // When a CDP bridge is integrated, set eventSequences here.
    eventSequences: null,
    syntheticFallback: createSyntheticDispatchFallback(),
  }
```

변경:

```typescript
  const deps: CommandHandlerDeps = {
    captureSnapshot,
    captureSettledSnapshot,
    getDescriptors,
    resolveExecutionConfig,
    queue,
    eventSequences,
    syntheticFallback: eventSequences ? null : createSyntheticDispatchFallback(),
  }
```

- [x] **Step 4: dispose에 cdpClient 정리 추가**

기존 dispose (324-328행):

```typescript
  runtimeDisposers.set(runtime, () => {
    clearActivityIdleTimer()
    mutationObserver?.disconnect()
    queue.dispose()
  })
```

변경:

```typescript
  runtimeDisposers.set(runtime, () => {
    clearActivityIdleTimer()
    mutationObserver?.disconnect()
    queue.dispose()
    cdpClient?.dispose()
  })
```

- [x] **Step 5: 타입체크 및 테스트**

Run: `cd packages/build-core && pnpm typecheck && pnpm test`
Expected: PASS (기존 테스트는 cdpPostMessage 없이 호출하므로 syntheticFallback 경로 유지)

- [x] **Step 6: Commit**

```bash
git add packages/build-core/src/runtime/page-agent-runtime.ts
git commit -m "feat(build-core): wire CDP client and event sequences in page-agent-runtime"
```

---

### Task 3: page-runtime에서 cdpPostMessage 콜백 전달

**Files:**
- Modify: `packages/extension/src/runtime/page-runtime.ts:54-57`

- [x] **Step 1: installRuntime에서 cdpPostMessage 옵션 전달**

기존 `installRuntime` (54-57행):

```typescript
function installRuntime(payload: InitRuntimePayload): void {
  installPageAgentRuntime(payload.manifest as any, (payload.options ?? {}) as any)
  sendToContentScript('runtime_ready', {})
}
```

변경:

```typescript
function installRuntime(payload: InitRuntimePayload): void {
  installPageAgentRuntime(payload.manifest as any, {
    ...(payload.options ?? {}),
    cdpPostMessage: sendToContentScript,
  } as any)
  sendToContentScript('runtime_ready', {})
}
```

- [x] **Step 2: 타입체크**

Run: `cd packages/extension && pnpm typecheck`
Expected: PASS

- [x] **Step 3: Commit**

```bash
git add packages/extension/src/runtime/page-runtime.ts
git commit -m "feat(extension): pass cdpPostMessage callback to page agent runtime"
```

---

### Task 4: 빌드 및 검증 체크포인트

- [x] **Step 1: 전체 빌드**

Run: `pnpm build`
Expected: 모든 패키지 빌드 성공

- [x] **Step 2: 수동 검증**

확장 프로그램을 Chrome에 로드하고 다음 항목을 확인:

1. Chrome 디버거 info bar 표시 확인 (첫 이벤트 커맨드 시)
2. 기본 클릭 동작 (`agrune_act`)
3. 칸반 카드 드래그 — 커서 따라 이동하는지 (#1)
4. 칸반 카드 다른 컬럼 이동 (#2)
5. 워크플로우 노드 드래그 (#7)
6. 캔버스 줌 (#4)

- [x] **Step 3: 결과 기록**

검증 결과에 따라 이슈 문서(`docs/notes/11-cdp-migration-issues.md`) 업데이트.

---

### Task 5: synthetic-dispatch.ts 삭제

**전제: Task 4 검증 통과 후 진행.**

**Files:**
- Delete: `packages/build-core/src/runtime/synthetic-dispatch.ts`

- [x] **Step 1: synthetic-dispatch.ts 삭제**

```bash
rm packages/build-core/src/runtime/synthetic-dispatch.ts
```

- [x] **Step 2: 타입체크로 남은 참조 확인**

Run: `cd packages/build-core && pnpm typecheck`
Expected: FAIL — `page-agent-runtime.ts`에서 import 에러. 이것은 Task 6에서 수정.

- [x] **Step 3: Commit (삭제만 먼저)**

```bash
git add packages/build-core/src/runtime/synthetic-dispatch.ts
git commit -m "refactor(build-core): delete synthetic-dispatch.ts (556 lines)"
```

---

### Task 6: page-agent-runtime에서 synthetic import 제거

**Files:**
- Modify: `packages/build-core/src/runtime/page-agent-runtime.ts:51, 277`

- [x] **Step 1: createSyntheticDispatchFallback import 제거**

기존 (51행):

```typescript
import { createSyntheticDispatchFallback } from './synthetic-dispatch'
```

이 줄을 삭제.

- [x] **Step 2: deps에서 syntheticFallback 제거**

기존:

```typescript
    syntheticFallback: eventSequences ? null : createSyntheticDispatchFallback(),
```

변경 — `syntheticFallback` 라인 삭제.

- [x] **Step 3: 타입체크**

Run: `cd packages/build-core && pnpm typecheck`
Expected: FAIL — `CommandHandlerDeps`에 `syntheticFallback` 필드가 아직 있으므로 누락 에러. Task 7에서 수정.

- [x] **Step 4: Commit**

```bash
git add packages/build-core/src/runtime/page-agent-runtime.ts
git commit -m "refactor(build-core): remove synthetic fallback from page-agent-runtime"
```

---

### Task 7: command-handlers에서 SyntheticDispatchFallback 및 분기 제거

**Files:**
- Modify: `packages/build-core/src/runtime/command-handlers.ts`

- [x] **Step 1: SyntheticDispatchFallback 인터페이스 삭제**

`command-handlers.ts`에서 313-333행의 주석 + `SyntheticDispatchFallback` 인터페이스 전체 삭제:

```typescript
// 삭제 대상 (313-333행):
/**
 * When CDP event sequences are not available (e.g. in jsdom tests or before
 * the extension bridge is connected) the handlers call these functions
 * instead.  They will become dead-code in Task 13 once CDP is the only path.
 */
export interface SyntheticDispatchFallback {
  performClick: (element: HTMLElement) => void
  // ... 전체 인터페이스
}
```

- [x] **Step 2: CommandHandlerDeps에서 syntheticFallback 필드 삭제, eventSequences를 non-null로**

기존 (335-344행):

```typescript
export interface CommandHandlerDeps {
  captureSnapshot: () => PageSnapshot
  captureSettledSnapshot: (minimumFrames: number) => Promise<PageSnapshot>
  getDescriptors: () => TargetDescriptor[]
  resolveExecutionConfig: (patch?: Partial<AgagruneRuntimeConfig>) => AgagruneRuntimeConfig
  queue: ActionQueue
  eventSequences: EventSequences | null
  /** Synthetic dispatch fallback — used when eventSequences is null */
  syntheticFallback: SyntheticDispatchFallback | null
}
```

변경:

```typescript
export interface CommandHandlerDeps {
  captureSnapshot: () => PageSnapshot
  captureSettledSnapshot: (minimumFrames: number) => Promise<PageSnapshot>
  getDescriptors: () => TargetDescriptor[]
  resolveExecutionConfig: (patch?: Partial<AgagruneRuntimeConfig>) => AgagruneRuntimeConfig
  queue: ActionQueue
  eventSequences: EventSequences
}
```

- [x] **Step 3: handleAct — synthetic fallback 분기 제거**

기존 (796-840행 부근):

```typescript
    const eventSeq = deps.eventSequences
    if (eventSeq) {
      // CDP path: use event sequences
      const coords = toCoords(getInteractablePoint(element))
      const cdpActionForType = (c: Coords): Promise<void> => {
        switch (action) {
          case 'click': return eventSeq.click(c)
          case 'dblclick': return eventSeq.dblclick(c)
          case 'contextmenu': return eventSeq.contextmenu(c)
          case 'hover': return eventSeq.hover(c)
          case 'longpress': return eventSeq.longpress(c)
        }
      }
      if (config.pointerAnimation) {
        await deps.queue.push({
          type: 'animation',
          execute: () =>
            animateCursorThenCdpAction(
              element,
              config.cursorName ?? DEFAULT_CURSOR_NAME,
              config.pointerDurationMs,
              cdpActionForType,
            ),
        })
      } else {
        await cdpActionForType(coords)
      }
    } else if (deps.syntheticFallback) {
      // ... 합성 fallback 전체 분기
    }
```

변경 — `if (eventSeq)` 래핑 제거, `else if (deps.syntheticFallback)` 분기 전체 삭제, `eventSeq` 변수 대신 `deps.eventSequences` 직접 사용:

```typescript
    const coords = toCoords(getInteractablePoint(element))
    const cdpActionForType = (c: Coords): Promise<void> => {
      switch (action) {
        case 'click': return deps.eventSequences.click(c)
        case 'dblclick': return deps.eventSequences.dblclick(c)
        case 'contextmenu': return deps.eventSequences.contextmenu(c)
        case 'hover': return deps.eventSequences.hover(c)
        case 'longpress': return deps.eventSequences.longpress(c)
      }
    }
    if (config.pointerAnimation) {
      await deps.queue.push({
        type: 'animation',
        execute: () =>
          animateCursorThenCdpAction(
            element,
            config.cursorName ?? DEFAULT_CURSOR_NAME,
            config.pointerDurationMs,
            cdpActionForType,
          ),
      })
    } else {
      await cdpActionForType(coords)
    }
```

- [x] **Step 4: handleDrag — coordinate-based drag의 synthetic 분기 제거 (1003-1015행 부근)**

기존:

```typescript
        if (eventSeq) {
          if (config.pointerAnimation) {
            // ... CDP animation path
          } else {
            const steps = interpolateDragSteps(srcCoords, destCoords, DRAG_MOVE_STEPS)
            await eventSeq.pointerDrag(toCoords(srcCoords), toCoords(destCoords), steps)
          }
        } else if (deps.syntheticFallback) {
          // ... synthetic fallback
        }
```

변경 — `if (eventSeq)` 래핑 제거, `else if` 분기 삭제, `eventSeq` → `deps.eventSequences`:

```typescript
        if (config.pointerAnimation) {
          await deps.queue.push({
            type: 'animation',
            execute: () =>
              animateCursorDragWithCdp(
                sourceElement,
                srcCoords,
                destCoords,
                config.cursorName ?? DEFAULT_CURSOR_NAME,
                config.pointerDurationMs,
                deps.eventSequences,
              ),
          })
        } else {
          const steps = interpolateDragSteps(srcCoords, destCoords, DRAG_MOVE_STEPS)
          await deps.eventSequences.pointerDrag(toCoords(srcCoords), toCoords(destCoords), steps)
        }
```

- [x] **Step 5: handleDrag — element-based drag의 synthetic 분기 제거 (1115-1139행 부근)**

동일 패턴 적용. 기존:

```typescript
      } else if (deps.syntheticFallback) {
        const fb = deps.syntheticFallback
        if (config.pointerAnimation) {
          // ... synthetic animation
        } else if (sourceElement.draggable) {
          await fb.performHtmlDrag(sourceElement, destinationElement, placement)
        } else {
          await fb.performPointerDrag(sourceElement, destinationElement, placement)
        }
      }
```

`else if (deps.syntheticFallback)` 블록 전체 삭제. `if (eventSeq)` 래핑도 제거하고 `eventSeq` → `deps.eventSequences`.

- [x] **Step 6: handlePointer — synthetic 분기 제거 (1222-1244행 부근)**

기존:

```typescript
  const eventSeq = deps.eventSequences
  if (eventSeq) {
    for (const action of input.actions) {
      switch (action.type) {
        case 'pointerdown':
          await eventSeq.mousePressed({ x: action.x, y: action.y })
          break
        // ...
      }
    }
  } else if (deps.syntheticFallback) {
    // ... 합성 이벤트 디스패치
  }
```

변경:

```typescript
  for (const action of input.actions) {
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
  }
```

- [x] **Step 7: handleGuide — synthetic 분기 제거 (1312-1325행 부근)**

기존:

```typescript
    if (eventSeq) {
      // CDP path
      await deps.queue.push({
        type: 'animation',
        execute: () =>
          animateCursorThenCdpAction(
            element,
            guideConfig.cursorName ?? DEFAULT_CURSOR_NAME,
            guideConfig.pointerDurationMs,
            coords => eventSeq.click(coords),
          ),
      })
    } else {
      // Fallback: use old animateCursorTo with synthetic click
      const fb = deps.syntheticFallback
      await deps.queue.push({
        type: 'animation',
        execute: () =>
          animateCursorTo(
            element,
            guideConfig.cursorName ?? DEFAULT_CURSOR_NAME,
            guideConfig.pointerDurationMs,
            fb ? () => fb.performClick(element) : undefined,
          ),
      })
    }
```

변경:

```typescript
    await deps.queue.push({
      type: 'animation',
      execute: () =>
        animateCursorThenCdpAction(
          element,
          guideConfig.cursorName ?? DEFAULT_CURSOR_NAME,
          guideConfig.pointerDurationMs,
          coords => deps.eventSequences.click(coords),
        ),
    })
```

- [x] **Step 8: 사용하지 않는 import 정리**

`SyntheticDispatchFallback` 제거 후 더 이상 사용하지 않는 import가 있는지 확인. 특히:
- `animateCursorTo` — handleGuide에서만 사용되었고 제거됨. 다른 곳에서 사용 여부 확인 후 미사용이면 import 제거.
- `flashPointerOverlay` — handleAct synthetic 분기에서만 사용되었으면 import 제거.

Run: `cd packages/build-core && pnpm typecheck`
Expected: PASS (모든 참조 정리 완료)

- [x] **Step 9: 테스트 실행**

Run: `cd packages/build-core && pnpm test`
Expected: PASS

- [x] **Step 10: Commit**

```bash
git add packages/build-core/src/runtime/command-handlers.ts
git commit -m "refactor(build-core): remove SyntheticDispatchFallback and all synthetic branches"
```

---

### Task 8: 최종 빌드 및 정리

- [x] **Step 1: 전체 타입체크**

Run: `pnpm -r --filter "@agrune/*" run typecheck`
Expected: PASS

- [x] **Step 2: 전체 테스트**

Run: `pnpm test`
Expected: PASS

- [x] **Step 3: 합성 이벤트 코드 잔재 확인**

Run: `grep -r "syntheticFallback\|SyntheticDispatch\|synthetic.dispatch" packages/build-core/src/`
Expected: 결과 없음

- [x] **Step 4: 전체 빌드**

Run: `pnpm build`
Expected: PASS

- [x] **Step 5: Commit (필요 시)**

빌드 과정에서 추가 수정이 발생한 경우에만.
