# Canvas Viewport Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI가 viewport를 모르는 상태로 캔버스 노드를 정밀 제어할 수 있게 한다. Viewport 관리는 런타임이 전담.

**Architecture:** agrune_drag 핸들러 안에 "viewport preparation" 단계를 삽입하여 offscreen 노드를 자동 팬으로 뷰포트 안에 가져온 뒤 드래그를 실행한다. 상대좌표(relativeTo) 모드를 추가하여 AI의 좌표 계산 부담을 줄인다. viewportTransform은 AI 응답에서 제거하고 런타임 내부용으로 격하한다.

**Tech Stack:** TypeScript, CDP (Input.dispatchMouseEvent), Zod, @agrune/core

**Spec:** `docs/superpowers/specs/2026-03-29-canvas-viewport-compiler-design.md`

---

### Task 1: viewportTransform AI 노출 제거

**Files:**
- Modify: `packages/mcp-server/src/public-shapes.ts:25` (viewportTransform 필드)
- Modify: `packages/mcp-server/src/public-shapes.ts:117-158` (toPublicGroups 함수)

- [ ] **Step 1: PublicSnapshotGroup에서 viewportTransform 제거**

`packages/mcp-server/src/public-shapes.ts`에서:

```typescript
// 변경 전 (line 25)
export interface PublicSnapshotGroup {
  groupId: string
  groupName?: string
  groupDesc?: string
  targetCount: number
  actionKinds: PageTarget['actionKinds'][number][]
  sampleTargetNames: string[]
  viewportTransform?: { translateX: number; translateY: number; scale: number }
  meta?: unknown
}

// 변경 후
export interface PublicSnapshotGroup {
  groupId: string
  groupName?: string
  groupDesc?: string
  targetCount: number
  actionKinds: PageTarget['actionKinds'][number][]
  sampleTargetNames: string[]
  meta?: unknown
}
```

- [ ] **Step 2: toPublicGroups에서 viewportTransform 매핑 제거**

`packages/mcp-server/src/public-shapes.ts`의 `toPublicGroups` 함수에서:

```typescript
// 변경 전 (line 117-158)
function toPublicGroups(targets: PageTarget[], snapshotGroups: PageSnapshotGroup[]): PublicSnapshotGroup[] {
  const transformMap = new Map(
    snapshotGroups
      .filter(g => g.viewportTransform)
      .map(g => [g.groupId, g.viewportTransform]),
  )
  const metaMap = new Map(
    snapshotGroups
      .filter(g => g.meta !== undefined)
      .map(g => [g.groupId, g.meta]),
  )
  // ...
  return Array.from(groups.values()).map(group => ({
    // ...
    ...(transformMap.has(group.groupId) ? { viewportTransform: transformMap.get(group.groupId) } : {}),
    ...(metaMap.has(group.groupId) ? { meta: metaMap.get(group.groupId) } : {}),
  }))
}

// 변경 후 — transformMap 전체 삭제, viewportTransform spread 삭제
function toPublicGroups(targets: PageTarget[], snapshotGroups: PageSnapshotGroup[]): PublicSnapshotGroup[] {
  const metaMap = new Map(
    snapshotGroups
      .filter(g => g.meta !== undefined)
      .map(g => [g.groupId, g.meta]),
  )
  // ... groups 수집 로직 동일 ...
  return Array.from(groups.values()).map(group => ({
    groupId: group.groupId,
    groupName: group.groupName,
    groupDesc: group.groupDesc,
    targetCount: group.targets.length,
    actionKinds: [...new Set(group.targets.flatMap(target => target.actionKinds))],
    sampleTargetNames: group.targets
      .map(target => target.name)
      .filter(name => name.length > 0)
      .slice(0, 3),
    ...(metaMap.has(group.groupId) ? { meta: metaMap.get(group.groupId) } : {}),
  }))
}
```

- [ ] **Step 3: 빌드 확인**

Run: `cd /Users/chenjing/dev/agrune/agrune && pnpm build`
Expected: 성공. `viewportTransform`은 `PageSnapshotGroup`(core)에는 여전히 존재하므로 내부 참조 깨지지 않음.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-server/src/public-shapes.ts
git commit -m "refactor: remove viewportTransform from AI-facing snapshot"
```

---

### Task 2: updatedTransform 반환 제거

**Files:**
- Modify: `packages/build-core/src/runtime/command-handlers.ts:1269-1301` (pointer handler의 wheel 결과)

- [ ] **Step 1: pointer handler에서 updatedTransform 로직 제거**

`packages/build-core/src/runtime/command-handlers.ts`에서:

```typescript
// 변경 전 (line 1267-1301)
  const nextSnapshot = await deps.captureSettledSnapshot(2)

  const hasWheelAction = input.actions.some(a => a.type === 'wheel')
  let updatedTransform: Record<string, unknown> | undefined

  if (hasWheelAction && element) {
    const groupEl = element.closest<HTMLElement>('[data-agrune-group]')
    if (groupEl) {
      const groupId = groupEl.getAttribute('data-agrune-group')?.trim()
      const canvasSelector = groupEl.getAttribute('data-agrune-canvas')?.trim()
      if (groupId && canvasSelector) {
        const transformEl = groupEl.querySelector<HTMLElement>(canvasSelector)
        if (transformEl) {
          const style = window.getComputedStyle(transformEl)
          if (style.transform && style.transform !== 'none') {
            const m = new DOMMatrix(style.transform)
            updatedTransform = {
              groupId,
              viewportTransform: {
                translateX: Math.round(m.e),
                translateY: Math.round(m.f),
                scale: Math.round(m.a * 1000) / 1000,
              },
            }
          }
        }
      }
    }
  }

  return buildSuccessResult(commandId, nextSnapshot, {
    actionKind: 'pointer',
    actionsCount: input.actions.length,
    ...(updatedTransform ? { updatedTransform } : {}),
  })

// 변경 후
  const nextSnapshot = await deps.captureSettledSnapshot(2)

  return buildSuccessResult(commandId, nextSnapshot, {
    actionKind: 'pointer',
    actionsCount: input.actions.length,
  })
```

- [ ] **Step 2: 빌드 확인**

Run: `cd /Users/chenjing/dev/agrune/agrune && pnpm build`
Expected: 성공.

- [ ] **Step 3: Commit**

```bash
git add packages/build-core/src/runtime/command-handlers.ts
git commit -m "refactor: remove updatedTransform from pointer handler result"
```

---

### Task 3: OFFSCREEN 에러 코드 제거

**Files:**
- Modify: `packages/core/src/index.ts:12` (COMMAND_ERROR_CODES)

- [ ] **Step 1: OFFSCREEN 에러 코드 제거**

`packages/core/src/index.ts`에서:

```typescript
// 변경 전 (line 1-13)
export const COMMAND_ERROR_CODES = [
  'STALE_SNAPSHOT',
  'TARGET_NOT_FOUND',
  'NOT_VISIBLE',
  'DISABLED',
  'FLOW_BLOCKED',
  'TIMEOUT',
  'SESSION_NOT_ACTIVE',
  'AGENT_STOPPED',
  'INVALID_TARGET',
  'INVALID_COMMAND',
  'OFFSCREEN',
] as const

// 변경 후 — OFFSCREEN 제거, CANVAS_PAN_FAILED 추가
export const COMMAND_ERROR_CODES = [
  'STALE_SNAPSHOT',
  'TARGET_NOT_FOUND',
  'NOT_VISIBLE',
  'DISABLED',
  'FLOW_BLOCKED',
  'TIMEOUT',
  'SESSION_NOT_ACTIVE',
  'AGENT_STOPPED',
  'INVALID_TARGET',
  'INVALID_COMMAND',
  'CANVAS_PAN_FAILED',
] as const
```

- [ ] **Step 2: 빌드 확인**

Run: `cd /Users/chenjing/dev/agrune/agrune && pnpm build`
Expected: 성공. `OFFSCREEN`을 참조하는 곳이 있으면 에러 발생 — 다음 태스크에서 수정.

빌드 에러가 나면 `OFFSCREEN`을 grep하여 모든 참조를 확인하고 Task 4에서 함께 수정.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "refactor: replace OFFSCREEN error code with CANVAS_PAN_FAILED"
```

---

### Task 4: 자동 팬 (viewport preparation) 구현

**Files:**
- Modify: `packages/build-core/src/runtime/command-handlers.ts:994-1046` (coordinate-based drag branch)
- Modify: `packages/build-core/src/runtime/dom-utils.ts` (자동 팬 유틸리티 추가)

- [ ] **Step 1: dom-utils.ts에 자동 팬 함수 추가**

`packages/build-core/src/runtime/dom-utils.ts` 파일 끝에 추가:

```typescript
import type { ViewportTransform } from '@agrune/core'
import type { EventSequences } from './event-sequences'

/**
 * 지정한 canvas 좌표가 viewport 안에 들어오도록 자동 팬한다.
 * wheel 이벤트를 반복 발사하고 transform 변화를 확인하여 보정.
 * @returns 팬 후 새 transform. 팬 실패 시 null.
 */
export async function autoPanToCanvasPoint(
  canvasX: number,
  canvasY: number,
  groupEl: HTMLElement,
  canvasSelector: string,
  eventSequences: EventSequences,
  maxAttempts = 3,
): Promise<ViewportTransform | null> {
  const MARGIN = 50 // viewport 가장자리 여백

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const transformEl = groupEl.querySelector<HTMLElement>(canvasSelector)
    if (!transformEl) return null

    const transform = parseTransform(transformEl)
    const vp = canvasToViewport(canvasX, canvasY, transform)

    // 이미 viewport 안이면 현재 transform 반환
    if (
      vp.x >= MARGIN &&
      vp.y >= MARGIN &&
      vp.x <= window.innerWidth - MARGIN &&
      vp.y <= window.innerHeight - MARGIN
    ) {
      return transform
    }

    // viewport 중심과의 차이를 delta로 계산
    const centerX = window.innerWidth / 2
    const centerY = window.innerHeight / 2
    const deltaX = vp.x - centerX
    const deltaY = vp.y - centerY

    // wheel 이벤트로 팬 (shift 없이 — React Flow 기본 wheel=줌이므로 shift+wheel=팬)
    // 또는 deltaX/Y가 큰 방향으로 wheel 팬 시도
    // React Flow에서 wheel pan은 마우스 wheel의 deltaX/deltaY가 직접 translate에 반영됨
    await eventSequences.wheel(
      { x: centerX, y: centerY },
      deltaY,
      false,
    )

    // 약간의 안정화 대기
    await new Promise(r => setTimeout(r, 100))

    // transform이 변했는지 확인
    const newTransform = parseTransform(transformEl)
    if (
      newTransform.translateX === transform.translateX &&
      newTransform.translateY === transform.translateY &&
      newTransform.scale === transform.scale
    ) {
      // transform 변화 없음 — 이 라이브러리에서 wheel 팬이 안 됨
      return null
    }
  }

  // maxAttempts 소진 — 마지막으로 한 번 더 확인
  const transformEl = groupEl.querySelector<HTMLElement>(canvasSelector)
  if (!transformEl) return null

  const finalTransform = parseTransform(transformEl)
  const finalVp = canvasToViewport(canvasX, canvasY, finalTransform)
  if (isPointInsideViewport(finalVp.x, finalVp.y)) {
    return finalTransform
  }

  return null
}

function parseTransform(element: HTMLElement): ViewportTransform {
  const style = window.getComputedStyle(element)
  if (!style.transform || style.transform === 'none') {
    return { translateX: 0, translateY: 0, scale: 1 }
  }
  const m = new DOMMatrix(style.transform)
  return {
    translateX: Math.round(m.e),
    translateY: Math.round(m.f),
    scale: Math.round(m.a * 1000) / 1000,
  }
}
```

참고: `parseTransform`은 `getCanvasGroupTransform`(command-handlers.ts:837-846)에서 인라인 되어 있는 로직과 동일. 중복이지만, dom-utils에 정규 유틸로 빼는 것이므로 나중에 command-handlers의 인라인 버전도 이 함수로 교체 가능.

- [ ] **Step 2: drag handler에 자동 팬 적용 (coordinate-based branch)**

`packages/build-core/src/runtime/command-handlers.ts`의 coordinate-based drag branch (line 994-1046)를 수정:

```typescript
      // --- Branch: coordinate-based drag ---
      if (hasCoords) {
        const transform = getCanvasGroupTransform(deps.getDescriptors(), input.sourceTargetId)
        const srcCoords = getElementCenter(sourceElement)

        let destCoords: PointerCoords
        if (transform) {
          // -- 자동 팬: 소스 노드가 viewport 밖이면 먼저 팬 --
          if (!isElementInViewport(sourceElement)) {
            const groupEl = findCanvasGroupEl(deps.getDescriptors(), input.sourceTargetId)
            const canvasSelector = groupEl?.getAttribute('data-agrune-canvas')?.trim()
            if (groupEl && canvasSelector) {
              const srcCanvas = viewportToCanvas(srcCoords.clientX, srcCoords.clientY, transform)
              const panResult = await autoPanToCanvasPoint(
                srcCanvas.x, srcCanvas.y, groupEl, canvasSelector, deps.eventSequences,
              )
              if (!panResult) {
                return buildErrorResult(
                  input.commandId ?? input.sourceTargetId,
                  'CANVAS_PAN_FAILED',
                  'Failed to pan canvas to bring source target into viewport.',
                  snapshot,
                  input.sourceTargetId,
                )
              }
            }
          }

          // 팬 후 transform 재조회
          const freshTransform = getCanvasGroupTransform(deps.getDescriptors(), input.sourceTargetId)!
          const vp = canvasToViewport(input.destinationCoords!.x, input.destinationCoords!.y, freshTransform)
          destCoords = { clientX: vp.x, clientY: vp.y }

          // -- 자동 팬: 목적지가 viewport 밖이면 팬 --
          if (!isPointInsideViewport(vp.x, vp.y)) {
            const groupEl = findCanvasGroupEl(deps.getDescriptors(), input.sourceTargetId)
            const canvasSelector = groupEl?.getAttribute('data-agrune-canvas')?.trim()
            if (groupEl && canvasSelector) {
              const panResult = await autoPanToCanvasPoint(
                input.destinationCoords!.x, input.destinationCoords!.y,
                groupEl, canvasSelector, deps.eventSequences,
              )
              if (!panResult) {
                return buildErrorResult(
                  input.commandId ?? input.sourceTargetId,
                  'CANVAS_PAN_FAILED',
                  'Failed to pan canvas to bring destination into viewport.',
                  snapshot,
                  input.sourceTargetId,
                )
              }
              // 팬 후 좌표 재계산
              const vpAfterPan = canvasToViewport(
                input.destinationCoords!.x, input.destinationCoords!.y, panResult,
              )
              destCoords = { clientX: vpAfterPan.x, clientY: vpAfterPan.y }
            }
          }

          // 팬 후 소스 좌표도 재계산
          const freshSrcCoords = getElementCenter(sourceElement)
          Object.assign(srcCoords, freshSrcCoords)
        } else {
          destCoords = {
            clientX: input.destinationCoords!.x,
            clientY: input.destinationCoords!.y,
          }
        }

        // 이하 드래그 실행 코드는 기존과 동일 (line 1020-1045)
        // ...
      }
```

- [ ] **Step 3: findCanvasGroupEl 헬퍼 추가**

`packages/build-core/src/runtime/command-handlers.ts`의 canvas group helpers 섹션 (line 807 근처)에 추가:

```typescript
function findCanvasGroupEl(
  descriptors: TargetDescriptor[],
  targetId: string,
): HTMLElement | null {
  const { baseTargetId } = parseRuntimeTargetId(targetId)
  const descriptor = descriptors.find(d => d.target.targetId === baseTargetId)
  if (!descriptor) return null
  return document.querySelector<HTMLElement>(
    `[data-agrune-group="${descriptor.groupId}"]`
  )
}
```

- [ ] **Step 4: 기존 OFFSCREEN 에러 반환 코드 제거**

`packages/build-core/src/runtime/command-handlers.ts` line 1004-1012의 기존 OFFSCREEN 에러를 삭제 (Step 2에서 자동 팬으로 교체됨):

```typescript
// 삭제할 코드 (line 1004-1012)
          if (!isPointInsideViewport(vp.x, vp.y)) {
            return buildErrorResult(
              input.commandId ?? input.sourceTargetId,
              'OFFSCREEN',
              'Target is outside viewport. Use wheel to pan/zoom first.',
              snapshot,
              input.sourceTargetId,
            )
          }
```

- [ ] **Step 5: dom-utils.ts에서 autoPanToCanvasPoint를 export 확인**

`canvasToViewport`, `isPointInsideViewport`가 이미 export되어 있으므로, 새 함수의 import만 command-handlers.ts 상단에 추가:

```typescript
import {
  // ... 기존 imports ...
  autoPanToCanvasPoint,
} from './dom-utils'
```

- [ ] **Step 6: 빌드 확인**

Run: `cd /Users/chenjing/dev/agrune/agrune && pnpm build`
Expected: 성공.

- [ ] **Step 7: Commit**

```bash
git add packages/build-core/src/runtime/dom-utils.ts packages/build-core/src/runtime/command-handlers.ts
git commit -m "feat: auto-pan viewport for offscreen canvas drag targets"
```

---

### Task 5: 상대좌표 (relativeTo) 모드 추가

**Files:**
- Modify: `packages/mcp-server/src/mcp-tools.ts:68-82` (agrune_drag 스키마)
- Modify: `packages/build-core/src/runtime/command-handlers.ts` (drag handler에서 relativeTo 해석)

- [ ] **Step 1: agrune_drag Zod 스키마에 relativeTo 추가**

`packages/mcp-server/src/mcp-tools.ts`에서 agrune_drag의 `destinationCoords`를 유니온으로 변경:

```typescript
// 변경 전 (line 68-82)
  mcp.tool(
    'agrune_drag',
    'Drag a source target to a destination. Destination can be another target (destinationTargetId) or coordinates (destinationCoords). For canvas groups, coords are in canvas space (auto-converted). Returns movedTarget with final position.',
    {
      sourceTargetId: z.string().describe('Source target ID'),
      destinationTargetId: z.string().optional().describe('Destination target ID'),
      destinationCoords: z.object({
        x: z.number().describe('X coordinate (canvas space for canvas groups, viewport otherwise)'),
        y: z.number().describe('Y coordinate'),
      }).optional().describe('Destination coordinates'),
      placement: z.enum(['before', 'inside', 'after']).optional().describe('Drop placement (only with destinationTargetId)'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_drag', args)),
  )

// 변경 후
  mcp.tool(
    'agrune_drag',
    'Drag a source target to a destination. Use destinationTargetId for target-to-target drag, or destinationCoords for coordinate-based placement. For canvas groups, coords are in canvas space (auto-converted). Use relativeTo to position relative to another target. Returns movedTarget with final position.',
    {
      sourceTargetId: z.string().describe('Source target ID'),
      destinationTargetId: z.string().optional().describe('Destination target ID'),
      destinationCoords: z.union([
        z.object({
          x: z.number().describe('X coordinate (canvas space for canvas groups)'),
          y: z.number().describe('Y coordinate'),
        }),
        z.object({
          relativeTo: z.string().describe('Reference target ID'),
          dx: z.number().describe('X offset from reference target center'),
          dy: z.number().describe('Y offset from reference target center'),
        }),
      ]).optional().describe('Destination: absolute coords or relative to another target'),
      placement: z.enum(['before', 'inside', 'after']).optional().describe('Drop placement (only with destinationTargetId)'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_drag', args)),
  )
```

- [ ] **Step 2: drag handler에서 relativeTo 해석**

`packages/build-core/src/runtime/command-handlers.ts`의 coordinate-based drag branch 진입 직전에 relativeTo를 절대좌표로 변환:

```typescript
      // --- Resolve relativeTo to absolute coords ---
      if (hasCoords && input.destinationCoords && 'relativeTo' in input.destinationCoords) {
        const relCoords = input.destinationCoords as { relativeTo: string; dx: number; dy: number }
        const refDescriptor = resolveRuntimeTarget(deps.getDescriptors(), relCoords.relativeTo)
        if (!refDescriptor) {
          return buildErrorResult(
            input.commandId ?? input.sourceTargetId,
            'TARGET_NOT_FOUND',
            `relativeTo target not found: ${relCoords.relativeTo}`,
            snapshot,
            relCoords.relativeTo,
          )
        }
        const refElement = refDescriptor.element
        const refRect = refElement.getBoundingClientRect()
        const refCx = refRect.left + refRect.width / 2
        const refCy = refRect.top + refRect.height / 2

        // canvas 그룹이면 canvas 좌표로 변환 후 offset 적용
        const refTransform = getCanvasGroupTransform(deps.getDescriptors(), relCoords.relativeTo)
        if (refTransform) {
          const refCanvas = viewportToCanvas(refCx, refCy, refTransform)
          input.destinationCoords = {
            x: refCanvas.x + relCoords.dx,
            y: refCanvas.y + relCoords.dy,
          }
        } else {
          input.destinationCoords = {
            x: Math.round(refCx + relCoords.dx),
            y: Math.round(refCy + relCoords.dy),
          }
        }
      }
```

이 코드를 coordinate-based drag branch의 `if (hasCoords) {` 바로 안에, `getCanvasGroupTransform` 호출 전에 삽입.

- [ ] **Step 3: 빌드 확인**

Run: `cd /Users/chenjing/dev/agrune/agrune && pnpm build`
Expected: 성공.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-server/src/mcp-tools.ts packages/build-core/src/runtime/command-handlers.ts
git commit -m "feat: add relativeTo mode for canvas drag destination"
```

---

### Task 6: 가이드/문서 업데이트

**Files:**
- Modify: `skills/skills/guide/SKILL.md`
- Modify: `skills/skills/annotate/references/pattern-canvas.md`

- [ ] **Step 1: guide SKILL.md 업데이트**

`skills/skills/guide/SKILL.md`에서 다음을 변경:

**Line 87 — agrune_drag의 destinationCoords 설명:**
```markdown
// 변경 전
| `destinationCoords` | `{x, y}`? | 놓을 좌표 (캔버스 그룹이면 canvas 좌표, 아니면 viewport 좌표) |

// 변경 후
| `destinationCoords` | `{x, y}` 또는 `{relativeTo, dx, dy}`? | 놓을 좌표. 절대좌표 `{x,y}` 또는 상대좌표 `{relativeTo: "targetId", dx, dy}`. 캔버스 그룹이면 canvas 좌표 |
```

**Line 91 — 캔버스 그룹 드래그 설명:**
```markdown
// 변경 전
**캔버스 그룹 드래그:** `data-agrune-canvas`가 있는 그룹의 타겟은 `destinationCoords`에 canvas 좌표를 사용한다. agrune이 자동으로 viewport 좌표로 변환. 결과에 `movedTarget: { targetId, center, size, coordSpace }` 포함.

// 변경 후
**캔버스 그룹 드래그:** `data-agrune-canvas`가 있는 그룹의 타겟은 `destinationCoords`에 canvas 좌표를 사용한다. agrune이 자동으로 viewport 변환 및 필요 시 자동 팬을 처리. offscreen 노드도 자동으로 뷰포트 안에 가져온다. 결과에 `movedTarget: { targetId, center, size, coordSpace }` 포함.

**상대좌표:** `destinationCoords: { relativeTo: "기획", dx: 150, dy: 0 }` — 참조 타겟 중심에서 offset만큼 떨어진 위치로 이동. 절대좌표 계산 없이 노드 간 관계만으로 배치 가능.
```

**Line 111 — 캔버스 휠 설명에서 updatedTransform 제거:**
```markdown
// 변경 전
**캔버스 휠:** 캔버스 그룹에서 wheel 액션 사용 시 결과에 `updatedTransform: { groupId, viewportTransform }` 포함. canvas 좌표는 변하지 않으므로 노드 위치 재조회 불필요.

// 변경 후
**캔버스 휠:** 캔버스 그룹에서 wheel 액션으로 줌/팬 가능. canvas 좌표는 줌/팬으로 변하지 않으므로 노드 위치 재조회 불필요.
```

**Line 170 — 에러 코드 테이블에서 OFFSCREEN 교체:**
```markdown
// 변경 전
| `OFFSCREEN` | 타겟이 뷰포트 밖 | wheel로 패닝/줌 후 재시도 |

// 변경 후
| `CANVAS_PAN_FAILED` | 캔버스 자동 팬 실패 | 캔버스 라이브러리의 wheel 동작이 예상과 다를 수 있음. agrune_pointer로 수동 팬 시도 |
```

**Line 185 — 좌표 시스템 설명에서 수동 팬 안내 제거:**
```markdown
// 변경 전
viewport 밖 타겟도 canvas 좌표로 포함되지만 조작 전 wheel로 뷰 안에 가져와야 한다.

// 변경 후
viewport 밖 타겟도 canvas 좌표로 포함되며, agrune이 조작 시 자동으로 뷰포트를 조정한다.
```

**Line 227-233 — 캔버스 노드 정렬 패턴 업데이트:**
```markdown
// 변경 전
### 캔버스 노드 정렬
\```
1. agrune_snapshot(groupId="workflow-nodes", mode="full")  → 전체 노드 (canvas 좌표)
2. 노드 center 좌표와 meta의 edges 정보 확인
3. agrune_drag(sourceTargetId="기획", destinationCoords={x:200, y:100})  → canvas 좌표로 이동
4. 결과의 movedTarget으로 최종 위치 확인
\```

// 변경 후
### 캔버스 노드 정렬
\```
1. agrune_snapshot(groupId="workflow-nodes", mode="full")  → 전체 노드 (canvas 좌표)
2. 노드 center 좌표와 meta의 edges 정보 확인
3. 기준 노드 배치: agrune_drag(sourceTargetId="기획", destinationCoords={x:200, y:100})
4. 상대 배치: agrune_drag(sourceTargetId="디자인", destinationCoords={relativeTo:"기획", dx:150, dy:0})
5. 결과의 movedTarget으로 최종 위치 확인
6. (선택) agrune_capture로 시각적 결과 검증
\```

**캔버스 타깃이 부족한 그룹 (라벨링 등):** 스냅샷에 조작 대상 타깃이 없으면 `agrune_capture`로 시각 확인 후 작업.
```

- [ ] **Step 2: pattern-canvas.md 업데이트**

`skills/skills/annotate/references/pattern-canvas.md`에서:

**Line 5 — 설명 수정:**
```markdown
// 변경 전
줌/팬이 있는 캔버스 컨테이너에는 `data-agrune-canvas` 속성을 추가하여 AI가 뷰포트 좌표와 캔버스 내부 좌표를 변환할 수 있게 한다.

// 변경 후
줌/팬이 있는 캔버스 컨테이너에는 `data-agrune-canvas` 속성을 추가하여 agrune 런타임이 뷰포트↔캔버스 좌표 변환을 자동 처리할 수 있게 한다.
```

**Line 10 — viewportTransform 설명 수정:**
```markdown
// 변경 전
스냅샷에 `viewportTransform: { translateX, translateY, scale }`이 포함되어, AI가 줌/팬 상태에서도 노드를 정확한 위치로 드래그할 수 있다.

// 변경 후
런타임이 내부적으로 transform을 파싱하여 canvas↔viewport 좌표 변환과 자동 팬을 처리한다. AI는 canvas 절대좌표만 사용.
```

**Line 64 — viewport 정보 중복 안내 수정:**
```markdown
// 변경 전
- **viewport 정보는 포함하지 않는다:** `data-agrune-canvas`가 이미 뷰포트 transform을 스냅샷에 포함하므로 중복 불필요

// 변경 후
- **viewport 정보는 포함하지 않는다:** `data-agrune-canvas`가 있으면 런타임이 내부적으로 transform을 파싱한다. meta에 viewport 정보를 넣을 필요 없음
```

**Line 106-108 — 줌/팬 조작 섹션 수정:**
```markdown
// 변경 전
## 줌/팬 조작

캔버스의 줌/팬은 어노테이션이 아니라 `agrune_pointer` 도구의 `wheel` 액션으로 처리된다. 별도 어노테이션 불필요.

// 변경 후
## 줌/팬 조작

캔버스의 줌/팬은 agrune 런타임이 자동으로 관리한다. 노드가 viewport 밖에 있으면 드래그 시 자동 팬이 실행된다. 수동 줌/팬이 필요하면 `agrune_pointer`의 `wheel` 액션을 사용. 별도 어노테이션 불필요.
```

- [ ] **Step 3: Commit**

```bash
git add skills/skills/guide/SKILL.md skills/skills/annotate/references/pattern-canvas.md
git commit -m "docs: update guide and pattern-canvas for viewport compiler"
```

---

### Task 7: MCP 서버 빌드 및 배포 확인

**Files:**
- 변경 없음. 기존 postbuild 스크립트로 배포.

- [ ] **Step 1: 전체 빌드**

Run: `cd /Users/chenjing/dev/agrune/agrune && pnpm build`
Expected: 모든 패키지 빌드 성공.

- [ ] **Step 2: MCP 서버 배포 확인**

postbuild 스크립트가 `skills/mcp-server/`로 배포하는지 확인:

Run: `cd /Users/chenjing/dev/agrune/agrune && ls -la ../skills/mcp-server/`
Expected: 최신 빌드 파일이 배포됨.

- [ ] **Step 3: 수동 테스트 — 기본 드래그**

1. 데모 앱 실행: `cd /Users/chenjing/dev/agrune/agrune/demo && pnpm dev`
2. Workflow 탭 열기
3. agrune_snapshot으로 노드 확인
4. agrune_drag로 노드 이동 — movedTarget에 canvas 좌표 반환 확인
5. viewportTransform이 스냅샷에 없는지 확인

- [ ] **Step 4: 수동 테스트 — 상대좌표**

1. agrune_drag(sourceTargetId="디자인", destinationCoords={relativeTo:"기획", dx:150, dy:0})
2. movedTarget 결과에서 기획 중심 + (150, 0) 근처인지 확인

- [ ] **Step 5: 수동 테스트 — 자동 팬**

1. agrune_pointer wheel로 캔버스 줌아웃하여 일부 노드를 뷰포트 밖으로 밀기
2. offscreen 노드에 agrune_drag 실행
3. 자동 팬이 일어나고 드래그가 성공하는지 확인
4. OFFSCREEN 에러가 아닌 정상 결과 반환 확인

- [ ] **Step 6: Commit (필요 시)**

테스트 중 발견한 수정사항이 있으면 커밋.
