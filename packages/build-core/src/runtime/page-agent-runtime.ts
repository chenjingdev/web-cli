import {
  type CommandResult,
  type DragPlacement,
  type PageSnapshot,
  type AgagruneRuntimeConfig,
  mergeRuntimeConfig,
} from '@agrune/core'
import { ActionQueue } from './action-queue'
import { DEFAULT_CURSOR_NAME } from './cursors/index'
import type {
  AgagruneManifest,
  AgagruneRuntimeOptions,
} from '../types'
import {
  type PointerCoords,
  getElementCenter,
  getDragPlacementCoords,
  getEventTargetAtPoint,
  getInteractablePoint,
  isElementInViewport,
  isEnabled,
  isRelevantSnapshotMutation,
  isTopmostInteractable,
  isVisible,
  smoothScrollIntoView,
  waitForNextFrame,
} from './dom-utils'
import {
  type ActionKind,
  type MutableSnapshotStore,
  type TargetDescriptor,
  ACT_COMPATIBLE_KINDS,
  DOM_SETTLE_QUIET_WINDOW_MS,
  DOM_SETTLE_STABLE_FRAMES,
  DOM_SETTLE_TIMEOUT_MS,
  SNAPSHOT_RELEVANT_ATTRIBUTES,
  buildErrorResult,
  buildFlowBlockedResult,
  buildSuccessResult,
  collectDescriptors,
  collectLiveDescriptors,
  findSnapshotTarget,
  isOverlayFlowLocked,
  makeSnapshot,
  mergeDescriptors,
  resolveRuntimeTarget,
} from './snapshot'
import {
  type AnimationEventDeps,
  IDLE_TIMEOUT_MS,
  animateCursorTo,
  animateHtmlDragWithCursor,
  animatePointerDragToCoordsWithCursor,
  animatePointerDragWithCursor,
  cursorState,
  flashPointerOverlay,
  getOrCreateCursorElement,
  hideAuroraGlow,
  hidePointerOverlay,
  showAuroraGlow,
  showIdlePointerOverlay,
} from './cursor-animator'
import {
  type CommandHandlerDeps,
  type SyntheticDispatchFallback,
  type WaitState,
  DEFAULT_OPTIONS,
  handleAct,
  handleDrag,
  handleFill,
  handleGuide,
  handlePointer,
  handleRead,
  handleWait,
  normalizeExecutionConfig,
  sleep,
  withDescriptor,
} from './command-handlers'
import { type EventSequences, createEventSequences } from './event-sequences'
import { createCdpClient, type CdpClient } from './cdp-client'

// Constants DEFAULT_OPTIONS, DEFAULT_EXECUTION_CONFIG, WaitState, MAX_READ_CHARS,
// SKIP_TAGS, and read/fill utilities moved to ./command-handlers

export interface PageAgentRuntime {
  getSnapshot: () => PageSnapshot
  beginAgentActivity: () => void
  endAgentActivity: () => void
  act: (input: {
    commandId?: string
    targetId: string
    action?: 'click' | 'dblclick' | 'contextmenu' | 'hover' | 'longpress'
    expectedVersion?: number
    config?: Partial<AgagruneRuntimeConfig>
  }) => Promise<CommandResult>
  drag: (input: {
    commandId?: string
    sourceTargetId: string
    destinationTargetId?: string
    destinationCoords?: { x: number; y: number }
    placement?: DragPlacement
    expectedVersion?: number
    config?: Partial<AgagruneRuntimeConfig>
  }) => Promise<CommandResult>
  fill: (input: {
    commandId?: string
    targetId: string
    value: string
    expectedVersion?: number
    config?: Partial<AgagruneRuntimeConfig>
  }) => Promise<CommandResult>
  wait: (input: {
    commandId?: string
    targetId: string
    state: WaitState
    timeoutMs?: number
  }) => Promise<CommandResult>
  guide: (input: {
    commandId?: string
    targetId: string
    expectedVersion?: number
    config?: Partial<AgagruneRuntimeConfig>
  }) => Promise<CommandResult>
  read: (input: {
    commandId?: string
    selector?: string
    expectedVersion?: number
  }) => Promise<CommandResult>
  pointer: (input: {
    commandId?: string
    targetId?: string
    selector?: string
    coords?: { x: number; y: number }
    actions: Array<
      | { type: 'pointerdown'; x: number; y: number }
      | { type: 'pointermove'; x: number; y: number }
      | { type: 'pointerup'; x: number; y: number }
      | { type: 'wheel'; x: number; y: number; deltaY: number; ctrlKey?: boolean }
    >
  }) => Promise<CommandResult>
  applyConfig: (config: Partial<AgagruneRuntimeConfig>) => void
  /** Returns true while a command or agent-driven activity is actively in progress. */
  isBusy: () => boolean
  /** Returns true when visual effects are active (agent busy, queue processing, or idle timer pending). */
  isActive: () => boolean
}

export interface PageAgentRuntimeHandle extends PageAgentRuntime {
  dispose: () => void
}

const runtimeDisposers = new WeakMap<PageAgentRuntime, () => void>()

interface GlobalRuntimeStore {
  active?: PageAgentRuntimeHandle
}

const GLOBAL_RUNTIME_KEY = '__agrune_page_agent_runtime__'

declare global {
  interface Window {
    agruneDom?: PageAgentRuntime
  }
}

function getGlobalRuntimeStore(): GlobalRuntimeStore {
  const root = globalThis as typeof globalThis & {
    [GLOBAL_RUNTIME_KEY]?: GlobalRuntimeStore
  }
  if (!root[GLOBAL_RUNTIME_KEY]) {
    root[GLOBAL_RUNTIME_KEY] = {}
  }
  return root[GLOBAL_RUNTIME_KEY]
}


const DRAG_POINTER_ID = 1
const DRAG_MOVE_STEPS = 12

// ---------------------------------------------------------------------------
// Event dispatch dependency bag for animated cursor wrappers
// ---------------------------------------------------------------------------

function getAnimationEventDeps(): AnimationEventDeps {
  return {
    dispatchHoverTransition,
    dispatchPointerLikeEvent,
    dispatchMouseLikeEvent,
    dispatchDragMove,
    dispatchDragRelease,
    dispatchDragLikeEvent,
    createSyntheticDataTransfer,
    sleep,
  }
}

function dispatchMouseLikeEvent(
  target: EventTarget,
  type: string,
  coords: PointerCoords,
  buttons: number,
  bubbles: boolean,
  options?: { button?: number; detail?: number },
): void {
  const event = new MouseEvent(type, {
    bubbles,
    button: options?.button ?? 0,
    buttons,
    cancelable: true,
    clientX: coords.clientX,
    clientY: coords.clientY,
    composed: true,
    detail: options?.detail ?? 1,
    screenX: coords.clientX,
    screenY: coords.clientY,
  })
  target.dispatchEvent(event)
}

function dispatchPointerLikeEvent(
  target: EventTarget,
  type: string,
  coords: PointerCoords,
  buttons: number,
  bubbles: boolean,
  options?: { button?: number },
): void {
  if (typeof window.PointerEvent !== 'function') return

  const event = new window.PointerEvent(type, {
    bubbles,
    button: options?.button ?? 0,
    buttons,
    cancelable: true,
    clientX: coords.clientX,
    clientY: coords.clientY,
    composed: true,
    isPrimary: true,
    pointerId: DRAG_POINTER_ID,
    pointerType: 'mouse',
    pressure: buttons === 0 ? 0 : 0.5,
    screenX: coords.clientX,
    screenY: coords.clientY,
  })
  target.dispatchEvent(event)
}

function dispatchWheelEvent(
  target: EventTarget,
  coords: PointerCoords,
  deltaY: number,
  ctrlKey: boolean,
): void {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: coords.clientX,
    clientY: coords.clientY,
    screenX: coords.clientX,
    screenY: coords.clientY,
    deltaY,
    deltaMode: 0,
    ctrlKey,
    composed: true,
  })
  target.dispatchEvent(event)
}

function createSyntheticDataTransfer(): DataTransfer {
  if (typeof DataTransfer === 'function') {
    return new DataTransfer()
  }

  const store = new Map<string, string>()
  const dataTransfer = {
    dropEffect: 'move',
    effectAllowed: 'all',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [] as string[],
    clearData(format?: string) {
      if (typeof format === 'string' && format) {
        store.delete(format)
      } else {
        store.clear()
      }
      this.types = Array.from(store.keys())
    },
    getData(format: string) {
      return store.get(format) ?? ''
    },
    setData(format: string, data: string) {
      store.set(format, data)
      this.types = Array.from(store.keys())
    },
    setDragImage() {
      // noop
    },
  } satisfies Partial<DataTransfer> & {
    clearData: (format?: string) => void
    getData: (format: string) => string
    setData: (format: string, data: string) => void
    setDragImage: DataTransfer['setDragImage']
    types: string[]
  }

  return dataTransfer as DataTransfer
}

function dispatchDragLikeEvent(
  target: EventTarget,
  type: string,
  coords: PointerCoords,
  dataTransfer: DataTransfer,
): void {
  const event =
    typeof window.DragEvent === 'function'
      ? new window.DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: coords.clientX,
          clientY: coords.clientY,
          screenX: coords.clientX,
          screenY: coords.clientY,
        })
      : new Event(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
        })

  for (const [key, value] of Object.entries({
    clientX: coords.clientX,
    clientY: coords.clientY,
    screenX: coords.clientX,
    screenY: coords.clientY,
    dataTransfer,
  })) {
    if (key in event) continue
    Object.defineProperty(event, key, {
      configurable: true,
      enumerable: true,
      value,
    })
  }

  if ('dataTransfer' in event) {
    try {
      Object.defineProperty(event, 'dataTransfer', {
        configurable: true,
        enumerable: true,
        value: dataTransfer,
      })
    } catch {
      // noop
    }
  }

  target.dispatchEvent(event)
}

function dispatchHoverTransition(
  previousTarget: HTMLElement | null,
  nextTarget: HTMLElement | null,
  coords: PointerCoords,
  buttons: number,
): void {
  if (previousTarget === nextTarget) return

  if (previousTarget) {
    dispatchPointerLikeEvent(previousTarget, 'pointerout', coords, buttons, true)
    dispatchMouseLikeEvent(previousTarget, 'mouseout', coords, buttons, true)
  }

  if (nextTarget) {
    dispatchPointerLikeEvent(nextTarget, 'pointerover', coords, buttons, true)
    dispatchMouseLikeEvent(nextTarget, 'mouseover', coords, buttons, true)
  }
}

function performPointerClickSequence(element: HTMLElement): void {
  const coords = getInteractablePoint(element)
  const pressTarget = getEventTargetAtPoint(element, coords)

  dispatchHoverTransition(null, pressTarget, coords, 0)
  dispatchPointerLikeEvent(pressTarget, 'pointermove', coords, 0, true)
  dispatchMouseLikeEvent(pressTarget, 'mousemove', coords, 0, true)
  dispatchPointerLikeEvent(pressTarget, 'pointerdown', coords, 1, true)
  dispatchMouseLikeEvent(pressTarget, 'mousedown', coords, 1, true)
  const releaseTarget = getEventTargetAtPoint(element, coords)
  dispatchPointerLikeEvent(releaseTarget, 'pointerup', coords, 0, true)
  dispatchMouseLikeEvent(releaseTarget, 'mouseup', coords, 0, true)
  dispatchMouseLikeEvent(releaseTarget, 'click', coords, 0, true, { detail: 1 })
}

function performPointerDblClickSequence(element: HTMLElement): void {
  const coords = getInteractablePoint(element)
  const pressTarget = getEventTargetAtPoint(element, coords)

  // First click (detail: 1)
  dispatchHoverTransition(null, pressTarget, coords, 0)
  dispatchPointerLikeEvent(pressTarget, 'pointerdown', coords, 1, true)
  dispatchMouseLikeEvent(pressTarget, 'mousedown', coords, 1, true)
  const releaseTarget1 = getEventTargetAtPoint(element, coords)
  dispatchPointerLikeEvent(releaseTarget1, 'pointerup', coords, 0, true)
  dispatchMouseLikeEvent(releaseTarget1, 'mouseup', coords, 0, true)
  dispatchMouseLikeEvent(releaseTarget1, 'click', coords, 0, true, { detail: 1 })

  // Second click (detail: 2)
  dispatchPointerLikeEvent(pressTarget, 'pointerdown', coords, 1, true)
  dispatchMouseLikeEvent(pressTarget, 'mousedown', coords, 1, true, { detail: 2 })
  const releaseTarget2 = getEventTargetAtPoint(element, coords)
  dispatchPointerLikeEvent(releaseTarget2, 'pointerup', coords, 0, true)
  dispatchMouseLikeEvent(releaseTarget2, 'mouseup', coords, 0, true, { detail: 2 })
  dispatchMouseLikeEvent(releaseTarget2, 'click', coords, 0, true, { detail: 2 })

  // dblclick event
  dispatchMouseLikeEvent(releaseTarget2, 'dblclick', coords, 0, true, { detail: 2 })
}

function performContextMenuSequence(element: HTMLElement): void {
  const coords = getInteractablePoint(element)
  const pressTarget = getEventTargetAtPoint(element, coords)

  dispatchHoverTransition(null, pressTarget, coords, 0)
  dispatchPointerLikeEvent(pressTarget, 'pointerdown', coords, 2, true, { button: 2 })
  dispatchMouseLikeEvent(pressTarget, 'mousedown', coords, 2, true, { button: 2 })
  const releaseTarget = getEventTargetAtPoint(element, coords)
  dispatchPointerLikeEvent(releaseTarget, 'pointerup', coords, 0, true, { button: 2 })
  dispatchMouseLikeEvent(releaseTarget, 'mouseup', coords, 0, true, { button: 2 })
  dispatchMouseLikeEvent(releaseTarget, 'contextmenu', coords, 0, true, { button: 2 })
}

function performHoverSequence(element: HTMLElement): void {
  const coords = getInteractablePoint(element)
  const target = getEventTargetAtPoint(element, coords)

  dispatchPointerLikeEvent(target, 'pointerover', coords, 0, true)
  dispatchPointerLikeEvent(target, 'pointerenter', coords, 0, false)
  dispatchMouseLikeEvent(target, 'mouseover', coords, 0, true)
  dispatchMouseLikeEvent(target, 'mouseenter', coords, 0, false)
}

async function performLongPressSequence(element: HTMLElement): Promise<void> {
  const coords = getInteractablePoint(element)
  const pressTarget = getEventTargetAtPoint(element, coords)

  dispatchHoverTransition(null, pressTarget, coords, 0)
  dispatchPointerLikeEvent(pressTarget, 'pointerdown', coords, 1, true)
  dispatchMouseLikeEvent(pressTarget, 'mousedown', coords, 1, true)

  await sleep(500)

  const releaseTarget = getEventTargetAtPoint(element, coords)
  dispatchPointerLikeEvent(releaseTarget, 'pointerup', coords, 0, true)
  dispatchMouseLikeEvent(releaseTarget, 'mouseup', coords, 0, true)
  // click event intentionally omitted — longpress is separate from click
}

async function performHtmlDragSequence(
  sourceElement: HTMLElement,
  destinationElement: HTMLElement,
  placement: DragPlacement,
): Promise<void> {
  const dataTransfer = createSyntheticDataTransfer()
  const sourceCoords = getElementCenter(sourceElement)
  const destinationCoords = getDragPlacementCoords(destinationElement, placement)

  dispatchHoverTransition(null, sourceElement, sourceCoords, 0)
  dispatchDragLikeEvent(sourceElement, 'dragstart', sourceCoords, dataTransfer)
  await sleep(0)

  dispatchDragLikeEvent(destinationElement, 'dragenter', destinationCoords, dataTransfer)
  dispatchDragLikeEvent(destinationElement, 'dragover', destinationCoords, dataTransfer)
  await sleep(0)

  dispatchDragLikeEvent(destinationElement, 'drop', destinationCoords, dataTransfer)
  await sleep(0)

  dispatchDragLikeEvent(sourceElement, 'dragend', destinationCoords, dataTransfer)
}

function dispatchDragMove(
  sourceElement: HTMLElement,
  hoverTarget: HTMLElement,
  coords: PointerCoords,
): void {
  if (hoverTarget === sourceElement) {
    dispatchPointerLikeEvent(sourceElement, 'pointermove', coords, 1, true)
    dispatchMouseLikeEvent(sourceElement, 'mousemove', coords, 1, true)
    return
  }

  dispatchPointerLikeEvent(sourceElement, 'pointermove', coords, 1, false)
  dispatchMouseLikeEvent(sourceElement, 'mousemove', coords, 1, false)
  dispatchPointerLikeEvent(hoverTarget, 'pointermove', coords, 1, true)
  dispatchMouseLikeEvent(hoverTarget, 'mousemove', coords, 1, true)
}

function dispatchDragRelease(
  sourceElement: HTMLElement,
  dropTarget: HTMLElement,
  coords: PointerCoords,
): void {
  if (dropTarget !== sourceElement) {
    dispatchPointerLikeEvent(sourceElement, 'pointerup', coords, 0, false)
    dispatchMouseLikeEvent(sourceElement, 'mouseup', coords, 0, false)
  }

  dispatchPointerLikeEvent(dropTarget, 'pointerup', coords, 0, true)
  dispatchMouseLikeEvent(dropTarget, 'mouseup', coords, 0, true)
}

async function performPointerDragSequence(
  sourceElement: HTMLElement,
  destinationElement: HTMLElement,
  placement: DragPlacement,
): Promise<void> {
  const sourceCoords = getElementCenter(sourceElement)
  dispatchHoverTransition(null, sourceElement, sourceCoords, 0)
  dispatchPointerLikeEvent(sourceElement, 'pointerdown', sourceCoords, 1, true)
  dispatchMouseLikeEvent(sourceElement, 'mousedown', sourceCoords, 1, true)

  const destinationCoords = getDragPlacementCoords(destinationElement, placement)
  let previousHover = sourceElement

  for (let step = 1; step <= DRAG_MOVE_STEPS; step += 1) {
    const progress = step / DRAG_MOVE_STEPS
    const coords = {
      clientX:
        sourceCoords.clientX +
        (destinationCoords.clientX - sourceCoords.clientX) * progress,
      clientY:
        sourceCoords.clientY +
        (destinationCoords.clientY - sourceCoords.clientY) * progress,
    }

    const nextHover = getEventTargetAtPoint(destinationElement, coords)
    dispatchHoverTransition(previousHover, nextHover, coords, 1)
    dispatchDragMove(sourceElement, nextHover, coords)
    previousHover = nextHover
  }

  const dropTarget = getEventTargetAtPoint(destinationElement, destinationCoords)
  dispatchHoverTransition(previousHover, dropTarget, destinationCoords, 1)
  dispatchDragRelease(sourceElement, dropTarget, destinationCoords)
}

async function performPointerDragToCoords(
  sourceElement: HTMLElement,
  destinationCoords: PointerCoords,
): Promise<void> {
  const sourceCoords = getElementCenter(sourceElement)
  dispatchHoverTransition(null, sourceElement, sourceCoords, 0)
  dispatchPointerLikeEvent(sourceElement, 'pointerdown', sourceCoords, 1, true)
  dispatchMouseLikeEvent(sourceElement, 'mousedown', sourceCoords, 1, true)

  let previousHover: HTMLElement = sourceElement

  for (let step = 1; step <= DRAG_MOVE_STEPS; step += 1) {
    const progress = step / DRAG_MOVE_STEPS
    const coords: PointerCoords = {
      clientX:
        sourceCoords.clientX +
        (destinationCoords.clientX - sourceCoords.clientX) * progress,
      clientY:
        sourceCoords.clientY +
        (destinationCoords.clientY - sourceCoords.clientY) * progress,
    }

    const nextHover = (document.elementFromPoint(coords.clientX, coords.clientY) as HTMLElement | null) ?? sourceElement
    dispatchHoverTransition(previousHover, nextHover, coords, 1)
    dispatchDragMove(sourceElement, nextHover, coords)
    previousHover = nextHover
  }

  const dropTarget = (document.elementFromPoint(destinationCoords.clientX, destinationCoords.clientY) as HTMLElement | null) ?? sourceElement
  dispatchHoverTransition(previousHover, dropTarget, destinationCoords, 1)
  dispatchDragRelease(sourceElement, dropTarget, destinationCoords)
}

export function createPageAgentRuntime(
  manifest: AgagruneManifest,
  options: Partial<AgagruneRuntimeOptions> = {},
): PageAgentRuntime {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Page agent runtime requires a browser environment.')
  }

  const runtimeOptions = { ...DEFAULT_OPTIONS, ...options }
  const manifestDescriptors = collectDescriptors(manifest)
  const snapshotStore: MutableSnapshotStore = {
    latest: null,
    signature: null,
    version: 0,
  }
  let lastRelevantDomMutationAt = performance.now()
  let currentConfig = normalizeExecutionConfig(runtimeOptions)
  let agentActivityActive = false
  let activityIdleTimer: ReturnType<typeof setTimeout> | null = null
  const queue = new ActionQueue({ idleTimeoutMs: IDLE_TIMEOUT_MS })
  const mutationObserverRoot = document.body ?? document.documentElement
  const mutationObserver = mutationObserverRoot
    ? new MutationObserver((mutations) => {
        if (mutations.some(isRelevantSnapshotMutation)) {
          lastRelevantDomMutationAt = performance.now()
        }
      })
    : null

  mutationObserver?.observe(mutationObserverRoot, {
    attributes: true,
    attributeFilter: SNAPSHOT_RELEVANT_ATTRIBUTES,
    childList: true,
    subtree: true,
  })

  const getDescriptors = () => mergeDescriptors(manifestDescriptors, collectLiveDescriptors())
  const captureSnapshot = () => makeSnapshot(getDescriptors(), snapshotStore)
  const captureSettledSnapshot = async (minimumFrames: number) => {
    const deadline = performance.now() + DOM_SETTLE_TIMEOUT_MS
    let observedFrames = 0
    let stableFrames = 0

    while (performance.now() < deadline) {
      await waitForNextFrame()
      observedFrames += 1

      if (performance.now() - lastRelevantDomMutationAt >= DOM_SETTLE_QUIET_WINDOW_MS) {
        stableFrames += 1
      } else {
        stableFrames = 0
      }

      if (observedFrames >= minimumFrames && stableFrames >= DOM_SETTLE_STABLE_FRAMES) {
        break
      }
    }

    return captureSnapshot()
  }

  const resolveExecutionConfig = (
    patch?: Partial<AgagruneRuntimeConfig>,
  ): AgagruneRuntimeConfig => mergeRuntimeConfig(currentConfig, patch)

  const clearActivityIdleTimer = () => {
    if (activityIdleTimer !== null) {
      clearTimeout(activityIdleTimer)
      activityIdleTimer = null
    }
  }

  const syncActiveVisualEffects = () => {
    if (currentConfig.auroraGlow) {
      showAuroraGlow(currentConfig.auroraTheme)
    } else {
      hideAuroraGlow()
    }
    if (currentConfig.pointerAnimation) {
      showIdlePointerOverlay(currentConfig.cursorName ?? DEFAULT_CURSOR_NAME)
    } else {
      hidePointerOverlay()
    }
  }

  const hideVisualEffects = () => {
    hideAuroraGlow()
    hidePointerOverlay()
  }

  queue.onActivate = () => {
    clearActivityIdleTimer()
    syncActiveVisualEffects()
  }

  queue.onDeactivate = () => {
    if (!agentActivityActive) {
      scheduleActivityHide()
    }
  }

  const scheduleActivityHide = () => {
    clearActivityIdleTimer()
    activityIdleTimer = setTimeout(() => {
      activityIdleTimer = null
      if (!agentActivityActive && !queue.active) {
        hideVisualEffects()
      }
    }, IDLE_TIMEOUT_MS)
  }

  // CDP client + event sequences are set up lazily on first use if the
  // extension bridge is present.  In test environments (jsdom) or when
  // the extension hasn't injected its bridge, eventSequences stays null
  // and the handlers fall back to synthetic dispatch.
  let cdpClient: CdpClient | null = null
  let eventSequences: EventSequences | null = null

  const deps: CommandHandlerDeps = {
    captureSnapshot,
    captureSettledSnapshot,
    getDescriptors,
    resolveExecutionConfig,
    queue,
    get eventSequences() { return eventSequences },
    syntheticFallback: {
      performClick: performPointerClickSequence,
      performDblClick: performPointerDblClickSequence,
      performContextMenu: performContextMenuSequence,
      performHover: performHoverSequence,
      performLongPress: performLongPressSequence,
      performPointerDrag: performPointerDragSequence,
      performHtmlDrag: performHtmlDragSequence,
      performPointerDragToCoords: performPointerDragToCoords,
      dispatchPointerLikeEvent,
      dispatchMouseLikeEvent,
      dispatchWheelEvent,
      animatePointerDragWithCursor: (src, dst, placement, cursorName, durationMs) =>
        animatePointerDragWithCursor(src, dst, placement, cursorName, durationMs, getAnimationEventDeps()),
      animatePointerDragToCoordsWithCursor: (src, dst, cursorName, durationMs) =>
        animatePointerDragToCoordsWithCursor(src, dst, cursorName, durationMs, getAnimationEventDeps()),
      animateHtmlDragWithCursor: (src, dst, placement, cursorName, durationMs) =>
        animateHtmlDragWithCursor(src, dst, placement, cursorName, durationMs, getAnimationEventDeps()),
    },
  }

  /**
   * Enable CDP event dispatch.  Called externally (e.g. by the content-script
   * bridge) once the CDP channel is available.  Until then all handlers use
   * the synthetic dispatch fallback.
   */
  function enableCdp(postMessage: (type: string, data: unknown) => void): void {
    if (cdpClient) return // already enabled
    cdpClient = createCdpClient(postMessage)
    eventSequences = createEventSequences(cdpClient)
  }

  const localWithDescriptor = (
    commandId: string,
    targetId: string,
    expectedVersion: number | undefined,
    effect: (
      descriptor: TargetDescriptor,
      element: HTMLElement,
      snapshot: PageSnapshot,
    ) => Promise<CommandResult>,
  ) => withDescriptor(deps, commandId, targetId, expectedVersion, effect)

  const runtime: PageAgentRuntime = {
    getSnapshot: captureSnapshot,

    beginAgentActivity: () => {
      agentActivityActive = true
      clearActivityIdleTimer()
      syncActiveVisualEffects()
    },

    endAgentActivity: () => {
      agentActivityActive = false
      if (!queue.active) {
        scheduleActivityHide()
      }
    },

    act: async input => handleAct(deps, input),

    drag: async input => handleDrag(deps, input),

    fill: async input => handleFill(deps, input),

    wait: async input => handleWait(deps, input),

    guide: async input => handleGuide(deps, input),

    read: async input => handleRead(deps, input),

    pointer: async input => handlePointer(deps, input),

    applyConfig: (config: Partial<AgagruneRuntimeConfig>) => {
      currentConfig = mergeRuntimeConfig(currentConfig, config)
      if (config.cursorName && cursorState && config.cursorName !== cursorState.cursorName) {
        getOrCreateCursorElement(config.cursorName)
      }
      if (queue.active || agentActivityActive) {
        syncActiveVisualEffects()
      }
    },

    isBusy: () => agentActivityActive || queue.active,
    isActive: () => agentActivityActive || queue.active || activityIdleTimer !== null,
  }

  runtimeDisposers.set(runtime, () => {
    clearActivityIdleTimer()
    mutationObserver?.disconnect()
    queue.dispose()
    cdpClient?.dispose()
  })

  return runtime
}

export function getInstalledPageAgentRuntime(): PageAgentRuntimeHandle | null {
  return getGlobalRuntimeStore().active ?? null
}

export function installPageAgentRuntime(
  manifest: AgagruneManifest,
  options: Partial<AgagruneRuntimeOptions> = {},
): PageAgentRuntimeHandle {
  const runtime = createPageAgentRuntime(manifest, options)
  const globalStore = getGlobalRuntimeStore()
  globalStore.active?.dispose()

  const handle: PageAgentRuntimeHandle = {
    ...runtime,
    dispose() {
      runtimeDisposers.get(runtime)?.()
      runtimeDisposers.delete(runtime)
      hideAuroraGlow()
      hidePointerOverlay()
      const current = getGlobalRuntimeStore()
      if (current.active === handle) {
        current.active = undefined
      }
      if (typeof window !== 'undefined' && window.agruneDom === runtime) {
        delete window.agruneDom
      }
    },
  }

  globalStore.active = handle
  window.agruneDom = runtime
  return handle
}
