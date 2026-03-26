# CDP Migration Design Spec

## Summary

agrune의 모든 이벤트 디스패치를 합성 이벤트(`new PointerEvent()` + `dispatchEvent()`)에서 CDP(`chrome.debugger` + `Input.dispatchMouseEvent`)로 전면 전환한다. 동시에 2900+ 줄의 `page-agent-runtime.ts`를 역할별 모듈로 분리한다.

## Motivation

캔버스 기반 UI(React Flow 등)에서 합성 이벤트가 동작하지 않는 근본 원인은 `isTrusted: false`. CDP `Input.dispatchMouseEvent`는 브라우저 입력 파이프라인을 타므로 `isTrusted: true` 이벤트를 생성하며, 어떤 프레임워크/라이브러리에서도 동작이 보장된다.

고객이 없는 현 시점에서 전면 전환하여 합성 이벤트/CDP 이중 경로 유지 비용을 제거한다.

## Design Decisions

| 결정 | 선택 | 근거 |
|------|------|------|
| 전환 범위 | 전면 전환 | 이중 경로 제거, isTrusted 통일 |
| 모듈 분리 | 적극 분리 (7개 모듈) | 지금이 기회 |
| 오케스트레이션 | page runtime | DOM 컨텍스트 보유, 커서 애니메이션 동기화 |
| HTML5 drag | CDP `Input.dispatchDragEvent` | Chromium only, 완전 CDP 통일 |
| debugger 생명주기 | lazy attach (첫 이벤트 명령 시) | 읽기 전용 명령 시 인포바 불필요 |
| CDP 통신 패턴 | thin proxy (개별 호출) | KISS, < 4ms 왕복, 동적 대응 가능 |

## Architecture

### Message Flow (변경 후)

```
MCP → Backend → Native Host → Background → Content Script → Page Runtime
                                    ↑                              │
                                    │  cdp_request / cdp_response  │
                                    └──────────────────────────────┘
                                    │
                                    ↓
                              chrome.debugger
                            Input.dispatchMouseEvent
                            Input.dispatchDragEvent
```

Page Runtime이 커맨드를 받으면:
1. 타겟 요소 해석 & 좌표 계산 (DOM 컨텍스트 활용)
2. 커서 애니메이션 시작
3. 적절한 시점에 CDP 요청을 bridge → content script → background로 전송
4. Background가 `chrome.debugger.sendCommand()` 실행 후 응답 반환
5. 응답 받으면 다음 이벤트 또는 애니메이션 스텝 진행

### New Message Types

```typescript
// Page Runtime → Background
{ type: 'cdp_request', requestId: string, method: string, params: object }

// Background → Page Runtime
{ type: 'cdp_response', requestId: string, result?: object, error?: string }
```

## Module Structure

### build-core (page runtime 측)

```
packages/build-core/src/runtime/
├── page-agent-runtime.ts      # 엔트리포인트. 모듈 조립 + installPageAgentRuntime()
├── cdp-client.ts              # CDP 요청/응답 래퍼. sendCdpEvent(), sendCdpDrag()
├── event-sequences.ts         # 이벤트 시퀀스 로직 (click, dblclick, contextmenu, hover, longpress, drag, pointer)
├── cursor-animator.ts         # 커서 오버레이 생성, 애니메이션, 리플 이펙트
├── command-handlers.ts        # act(), drag(), fill(), pointer(), wait(), guide() 핸들러
├── snapshot.ts                # 스냅샷 캡처, DOM 스캔, rect 수집 (읽기 전용)
├── dom-utils.ts               # getInteractablePoint, getEventTargetAtPoint, 스크롤, 가시성 체크
└── action-queue.ts            # 기존 유지
```

**모듈 의존 방향:**
- `cdp-client.ts`만 메시지 브릿지를 알고 있음
- `event-sequences.ts`는 `cdp-client`만 의존. DOM 직접 접근 안 함
- `command-handlers.ts`가 `dom-utils` + `event-sequences` + `cursor-animator`를 조합하는 오케스트레이터
- `cursor-animator.ts`는 DOM 오버레이만 관리. 이벤트 디스패치와 무관

### extension (background 측)

```
packages/extension/src/background/
├── service-worker.ts          # 기존. cdp-handler 등록 추가
├── message-router.ts          # 기존. cdp_request 라우팅 추가
├── cdp-handler.ts             # 신규. CDP 생명주기 + 실행
└── native-host-controller.ts  # 기존 유지
```

### cdp-handler.ts 설계

```typescript
const attachedTabs = new Set<number>()

async function ensureAttached(tabId: number): Promise<void> {
  if (attachedTabs.has(tabId)) return
  await chrome.debugger.attach({ tabId }, '1.3')
  attachedTabs.add(tabId)
}

function detach(tabId: number): void { ... }

async function handleCdpRequest(
  tabId: number,
  method: string,
  params: object
): Promise<object> {
  await ensureAttached(tabId)
  return chrome.debugger.sendCommand({ tabId }, method, params)
}
```

**detach 트리거:**
- `chrome.debugger.onDetach` (유저가 인포바 닫기)
- agrune 세션 종료 메시지 수신
- `chrome.tabs.onRemoved` (탭 닫힘)

### cdp-client.ts 설계 (page runtime 측)

```typescript
const pending = new Map<string, { resolve, reject }>()

function sendCdpEvent(method: string, params: object): Promise<object> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
    postBridgeMessage('cdp_request', { requestId, method, params })
  })
}

function handleCdpResponse({ requestId, result, error }) {
  const p = pending.get(requestId)
  if (!p) return
  pending.delete(requestId)
  error ? p.reject(new Error(error)) : p.resolve(result)
}
```

타임아웃: 5초 내 응답 없으면 reject.

## Event Sequence CDP Mapping

### Click
```typescript
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
```
브라우저가 pointerdown/mousedown/pointerup/mouseup/click 전부 자동 생성.

### Dblclick
```typescript
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2 })
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2 })
```

### Contextmenu
```typescript
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 })
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 })
```

### Hover
```typescript
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
```

### Longpress
```typescript
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
await sleep(500)
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
```

### Pointer Drag (React Flow 등)

타겟 기반 드래그 (`destinationTargetId`):
```typescript
// command-handlers.ts에서 src/dst 좌표 모두 사전 해석
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mousePressed', x: srcX, y: srcY, button: 'left' })
for (const step of interpolatedSteps) {
  sendCdpEvent('Input.dispatchMouseEvent', { type: 'mouseMoved', x: step.x, y: step.y })
}
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dstX, y: dstY, button: 'left' })
```

좌표 기반 드래그 (`destinationCoords`):
```typescript
// destinationCoords가 직접 제공됨. 보간 스텝 계산 후 동일 CDP 시퀀스.
// 차이점: hover 타겟 추적이 불필요 (CDP가 브라우저 레벨에서 자동 처리)
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mousePressed', x: srcX, y: srcY, button: 'left' })
for (const step of interpolatedSteps) {
  sendCdpEvent('Input.dispatchMouseEvent', { type: 'mouseMoved', x: step.x, y: step.y })
}
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dstX, y: dstY, button: 'left' })
```

`event-sequences.ts`에 두 변형 모두 구현. CDP에서는 hover 타겟을 브라우저가 자동 처리하므로, 기존 `document.elementFromPoint` 기반 수동 hover 추적은 불필요.

### HTML5 Drag (`draggable="true"`)
```typescript
sendCdpEvent('Input.setInterceptDrags', { enabled: true })
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mousePressed', x: srcX, y: srcY, button: 'left' })
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dstX, y: dstY, button: 'left' })
// 브라우저가 dragIntercepted 이벤트 발생, 드래그 데이터 캡처
sendCdpEvent('Input.dispatchDragEvent', { type: 'drop', x: dstX, y: dstY, data: capturedDragData })
sendCdpEvent('Input.setInterceptDrags', { enabled: false })
```

### Wheel (캔버스 줌/팬)
```typescript
sendCdpEvent('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
sendCdpEvent('Input.dispatchMouseEvent', {
  type: 'mouseWheel', x, y, deltaX: 0, deltaY,
  modifiers: ctrlKey ? 4 : 0  // bit 2 = Ctrl, 핀치줌용
})
```

## Cursor Animation Synchronization

커서 애니메이션과 CDP 이벤트는 page runtime 내에서 순차 실행으로 동기화:

```typescript
// Click example
const coords = resolveTargetCoords(targetId)
await cursorAnimator.moveTo(coords)
await cursorAnimator.pressDown()
await eventSequences.click(coords)
await cursorAnimator.release()

// Drag example
await cursorAnimator.moveTo(srcCoords)
await cursorAnimator.pressDown()
await eventSequences.mousePressed(srcCoords)

for (const step of interpolatedSteps) {
  cursorAnimator.setPosition(step)          // 즉시 (await 안 함)
  await eventSequences.mouseMoved(step)     // CDP 호출
  await raf()                               // 프레임 동기화
}

await eventSequences.mouseReleased(dstCoords)
await cursorAnimator.release()
```

`event-sequences.ts`의 모든 함수는 `async` (CDP 왕복 대기).

## Bridge Extension

### 추가 메시지 흐름
```
Page Runtime → Content Script → Background  (cdp_request)
Background → Content Script → Page Runtime  (cdp_response)
Background → Content Script → Page Runtime  (cdp_event)  ← push (HTML5 drag용)
```

Content script가 양방향 중계:
- page runtime → `postMessage` → content script → `chrome.runtime.sendMessage` → background
- background → `chrome.tabs.sendMessage` → content script → `postMessage` → page runtime

### page-runtime.ts 라우팅 추가

`packages/extension/src/runtime/page-runtime.ts`의 메시지 핸들러에 `cdp_response`와 `cdp_event` 타입 추가 필요. 현재 `init_runtime`, `command`, `request_snapshot`, `config_update`, `agent_activity`만 처리 중. 신규 메시지 타입은 `cdp-client.ts` 모듈의 `handleCdpResponse()` / `handleCdpEvent()`로 라우팅.

## Manifest Changes

```json
"permissions": ["nativeMessaging", "activeTab", "scripting", "storage", "debugger"]
```

## Removed Code

기존 `page-agent-runtime.ts`에서 제거되는 합성 이벤트 함수들 (전부 CDP 버전으로 재작성):

- `dispatchPointerLikeEvent()` — 삭제 (CDP가 자동 생성)
- `dispatchMouseLikeEvent()` — 삭제 (CDP가 자동 생성)
- `dispatchWheelEvent()` — 삭제 (CDP가 자동 생성)
- `dispatchDragLikeEvent()` — 삭제 (`Input.dispatchDragEvent`로 대체)
- `dispatchHoverTransition()` — 삭제 (`mouseMoved`가 hover 자동 생성)
- `performPointerClickSequence()` — `event-sequences.ts`에 CDP 버전 재작성
- `performPointerDblClickSequence()` — CDP 버전 재작성
- `performContextMenuSequence()` — CDP 버전 재작성
- `performHoverSequence()` — CDP 버전 재작성
- `performLongPressSequence()` — CDP 버전 재작성
- `performPointerDragSequence()` — CDP 버전 재작성
- `performPointerDragToCoords()` — CDP 버전 재작성
- `performHtmlDragSequence()` — CDP `Input.dispatchDragEvent` 버전 재작성

합성 이벤트 코드 0줄 남김.

## MCP Interface

변경 없음. `agrune_act`, `agrune_drag`, `agrune_pointer`, `agrune_fill`, `agrune_wait`, `agrune_guide` 등 모든 MCP 도구의 외부 스키마는 그대로 유지.

## Fill Command Strategy

`fill` 커맨드는 CDP 마이그레이션 범위 **밖**. 이유:

- `fill`은 마우스/포인터 이벤트를 디스패치하지 않음. `element.focus()` → native setter로 값 설정 → `input`/`change` 이벤트 발생
- `input`/`change` 이벤트는 `isTrusted` 여부와 무관하게 React/Vue 등에서 동작함 (값은 이미 native setter로 세팅됨)
- CDP `Input.insertText`로 대체할 수도 있으나, 현재 방식(native setter + synthetic input/change)이 React controlled component에서 검증된 패턴

따라서 `fill`의 `setElementValue` 로직은 현재 방식 유지. 합성 이벤트 0줄 목표에서 `fill`의 `input`/`change` 이벤트는 예외 — 이들은 포인터/마우스 이벤트가 아니라 폼 값 변경 알림이므로 `isTrusted` 이슈와 무관.

## Guide Command

`guide` 커맨드는 내부적으로 커서 애니메이션 + click을 수행. CDP 전환 대상에 포함:

- `guide()`의 클릭은 `event-sequences.ts`의 `cdpClick()` 사용
- 커서 애니메이션은 강제 활성화 (기존과 동일)
- `command-handlers.ts`에서 act()와 유사한 패턴으로 처리

## Pointer Command CDP Mapping

`agrune_pointer`는 임의 포인터/wheel 시퀀스를 실행하는 로우레벨 커맨드. CDP 전환 시:

```typescript
// 각 action을 1:1로 CDP 호출에 매핑
for (const action of actions) {
  switch (action.type) {
    case 'pointerdown':
      await sendCdpEvent('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: action.x, y: action.y, button: 'left', clickCount: 1
      })
      break
    case 'pointermove':
      await sendCdpEvent('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: action.x, y: action.y
      })
      break
    case 'pointerup':
      await sendCdpEvent('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: action.x, y: action.y, button: 'left', clickCount: 1
      })
      break
    case 'wheel':
      await sendCdpEvent('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: action.x, y: action.y, deltaX: 0, deltaY: action.deltaY,
        modifiers: action.ctrlKey ? 4 : 0
      })
      break
  }
}
```

기존 합성 이벤트 루프와 1:1 대응. MCP 인터페이스 변경 없음.

**참고:** 기존 코드에서 `pointerup` 시 `click` 이벤트를 명시적으로 디스패치했으나, CDP에서는 `mousePressed` + `mouseReleased`가 같은 위치에서 발생하면 브라우저가 `click`을 자동 생성. 따라서 CDP `mouseReleased`만으로 충분. 단, pressed/released 위치가 다르면 click이 생성되지 않을 수 있음 (기존 합성 방식에서는 무조건 생성됨) — 이는 실제 브라우저 동작에 더 가까운 올바른 동작.

## HTML5 Drag: CDP Event Subscription

`Input.setInterceptDrags` 사용 시 브라우저가 `Input.dragIntercepted` **이벤트**를 발생시킴. 이는 request/response가 아니라 push 이벤트이므로 `cdp-handler.ts`에 이벤트 구독이 필요:

```typescript
// cdp-handler.ts
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === 'Input.dragIntercepted') {
    // dragData를 요청한 탭으로 전달
    chrome.tabs.sendMessage(source.tabId, {
      type: 'cdp_event',
      method,
      params  // { data: DragData }
    })
  }
})
```

Page runtime 측 `cdp-client.ts`에도 이벤트 수신 추가:

```typescript
// cdp_event 수신 핸들러
function handleCdpEvent({ method, params }) {
  if (method === 'Input.dragIntercepted') {
    pendingDragData = params.data  // HTML5 drag 시퀀스에서 사용
  }
}
```

메시지 타입 추가:
```typescript
// Background → Page Runtime (push)
{ type: 'cdp_event', method: string, params: object }
```

## Coordinate System

CDP `Input.dispatchMouseEvent`의 `x`/`y`는 뷰포트 기준 좌표 (viewport-relative). 현재 코드의 `clientX`/`clientY`와 동일한 좌표계.

**불변 조건:** page runtime이 `getBoundingClientRect()` 등으로 계산한 좌표를 그대로 CDP에 전달. 좌표 변환 불필요.

`command-handlers.ts`가 `dom-utils.ts`로 좌표를 해석하고, 해석된 좌표를 `event-sequences.ts`에 전달. `event-sequences.ts`는 DOM에 직접 접근하지 않고 전달받은 좌표만 사용.

## Drag Animation-Event Interleaving

드래그 시 커서 애니메이션과 CDP 이벤트가 프레임 단위로 인터리빙됨. 이 오케스트레이션은 `command-handlers.ts`가 담당:

```typescript
// command-handlers.ts — drag with cursor animation
async function executeDragWithCursor(src, dst, steps) {
  await cursorAnimator.moveTo(src)
  await cursorAnimator.pressDown()
  await eventSequences.mousePressed(src)

  for (const step of steps) {
    cursorAnimator.setPosition(step)        // DOM 업데이트 (동기)
    await eventSequences.mouseMoved(step)   // CDP 호출 (비동기)
    await raf()                             // 프레임 대기
  }

  await eventSequences.mouseReleased(dst)
  await cursorAnimator.release()
}
```

**모듈 경계 명확화:**
- `cursor-animator.ts`: 커서 DOM 요소 생성/이동/press/release 애니메이션만 담당. 이벤트 디스패치 호출 안 함.
- `event-sequences.ts`: CDP 호출만 담당. 커서 DOM 조작 안 함.
- `command-handlers.ts`: 두 모듈을 프레임 단위로 조합하는 오케스트레이터. 드래그 루프가 여기에 있음.

## Error Handling

### chrome.debugger.attach 실패

```typescript
async function ensureAttached(tabId: number): Promise<void> {
  if (attachedTabs.has(tabId)) return
  try {
    await chrome.debugger.attach({ tabId }, '1.3')
    attachedTabs.add(tabId)
  } catch (err) {
    // "Another debugger is already attached" 등
    throw new CdpAttachError(err.message)
  }
}
```

attach 실패 시 `CdpAttachError`가 bridge를 통해 page runtime → command handler → MCP 응답으로 전파. MCP 도구 결과에 `ok: false, error: "CDP attach failed: ..."` 반환.

### 페이지 네비게이션 시 cleanup

page runtime이 재설치되면 `cdp-client.ts`의 pending map도 초기화됨. 이전 pending 요청은 타임아웃(5초)으로 자동 reject.

background 측 debugger 연결은 네비게이션 후에도 유지됨 (같은 탭). SPA pushState도 동일.

### Drag 시퀀스 중 fire-and-forget

드래그의 중간 `mouseMoved` 단계는 응답을 기다리되, 실패해도 시퀀스를 중단하지 않음 (best-effort). 최종 `mouseReleased`만 실패 시 에러 반환.

## Minimum Chromium Version

- `Input.dispatchMouseEvent` (mouseWheel 포함): Chrome 64+
- `Input.setInterceptDrags` / `Input.dispatchDragEvent`: Chrome 91+
- **최소 지원 버전: Chrome 91**

## Risks & Mitigations

| 리스크 | 대응 |
|--------|------|
| `chrome.debugger` 인포바 | lazy attach로 읽기 전용 시 미노출. 튜토리얼 특성상 인포바 존재 자체는 큰 문제 아님 |
| 비활성 탭에서 CDP 미동작 | agrune은 활성 탭 대상이므로 해당 없음 |
| DevTools와 debugger 동시 연결 충돌 | attach 실패 시 MCP 에러 응답. DevTools 닫으라는 안내 포함 |
| bridge 메시지 왕복 레이턴시 | click < 4ms. 드래그 중간 단계는 best-effort |
| `Input.dispatchDragEvent` 브라우저 버전 의존 | 최소 Chrome 91. Chromium only |
| 페이지 네비게이션 중 pending 요청 | 5초 타임아웃 자동 reject. page runtime 재설치 시 pending map 초기화 |
| attach 실패 (다른 디버거 연결) | MCP 에러 응답으로 명확히 전파 |
