import {
  createCommandError,
  mergeCompanionConfig,
  type CommandResult,
  type CompanionConfig,
  type PageSnapshot,
  type PageTarget,
} from '@webcli-dom/core'
import type {
  WebCliManifest,
  WebCliRuntimeOptions,
  WebCliTargetEntry,
} from '../types'

const DEFAULT_OPTIONS: WebCliRuntimeOptions = {
  clickAutoScroll: true,
  clickRetryCount: 2,
  clickRetryDelayMs: 120,
}

const DEFAULT_EXECUTION_CONFIG: CompanionConfig = {
  autoScroll: true,
  clickDelayMs: 0,
  pointerAnimation: false,
}

type ActionKind = 'click' | 'fill'
type WaitState = 'visible' | 'hidden' | 'enabled' | 'disabled'

interface TargetDescriptor {
  actionKind: ActionKind
  groupId: string
  groupName?: string
  groupDesc?: string
  target: WebCliTargetEntry
}

interface MutableSnapshotStore {
  version: number
  signature: string | null
  latest: PageSnapshot | null
}

export interface PageAgentRuntime {
  getSnapshot: () => PageSnapshot
  act: (input: {
    commandId?: string
    targetId: string
    expectedVersion?: number
    config?: Partial<CompanionConfig>
  }) => Promise<CommandResult>
  fill: (input: {
    commandId?: string
    targetId: string
    value: string
    expectedVersion?: number
    config?: Partial<CompanionConfig>
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
  }) => Promise<CommandResult>
}

export interface PageAgentRuntimeHandle extends PageAgentRuntime {
  dispose: () => void
}

interface GlobalRuntimeStore {
  active?: PageAgentRuntimeHandle
}

const GLOBAL_RUNTIME_KEY = '__webcli_dom_page_agent_runtime__'

declare global {
  interface Window {
    webcliDom?: PageAgentRuntime
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
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

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false
  }
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function isInViewport(rect: DOMRect): boolean {
  return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth
}

function isEnabled(element: HTMLElement): boolean {
  if ('disabled' in element) {
    return !(element as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled
  }
  return true
}

function isPointInsideViewport(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight
}

function isTopmostInteractable(element: HTMLElement): boolean {
  if (typeof document.elementFromPoint !== 'function') {
    return true
  }

  const rect = element.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  // clamp rect to visible viewport area
  const visLeft = Math.max(rect.left, 0)
  const visTop = Math.max(rect.top, 0)
  const visRight = Math.min(rect.right, vw)
  const visBottom = Math.min(rect.bottom, vh)

  if (visRight - visLeft < 1 || visBottom - visTop < 1) {
    return false
  }

  const samplePoints = [
    [(visLeft + visRight) / 2, (visTop + visBottom) / 2],
    [visLeft + 4, visTop + 4],
    [visRight - 4, visTop + 4],
    [visLeft + 4, visBottom - 4],
    [visRight - 4, visBottom - 4],
  ]

  for (const [x, y] of samplePoints) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !isPointInsideViewport(x, y)) {
      continue
    }
    const topmost = document.elementFromPoint(x, y)
    if (topmost && (topmost === element || element.contains(topmost))) {
      return true
    }
  }

  return false
}

function isSensitive(element: HTMLElement): boolean {
  return element.getAttribute('data-webcli-sensitive') === 'true'
}

function isOverlayElement(element: HTMLElement): boolean {
  let current: HTMLElement | null = element
  while (current && current !== document.body) {
    const role = current.getAttribute('role')
    const ariaModal = current.getAttribute('aria-modal')
    const style = window.getComputedStyle(current)
    const zIndex = Number(style.zIndex)

    if (
      role === 'dialog' ||
      role === 'alertdialog' ||
      ariaModal === 'true' ||
      (style.position === 'fixed' && Number.isFinite(zIndex) && zIndex > 0)
    ) {
      return true
    }

    current = current.parentElement
  }

  return false
}

function isFillableElement(
  element: Element,
): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  )
}

function collectDescriptors(manifest: WebCliManifest): TargetDescriptor[] {
  const result: TargetDescriptor[] = []

  for (const group of manifest.groups) {
    for (const tool of group.tools) {
      if (tool.status !== 'active') continue
      if (tool.action !== 'click' && tool.action !== 'fill') continue
      for (const target of tool.targets) {
        result.push({
          actionKind: tool.action,
          groupId: group.groupId,
          groupName: group.groupName,
          groupDesc: group.groupDesc,
          target,
        })
      }
    }
  }

  return result.sort((left, right) => left.target.targetId.localeCompare(right.target.targetId))
}

function findElement(descriptor: TargetDescriptor): HTMLElement | null {
  return document.querySelector<HTMLElement>(descriptor.target.selector)
}

function normalizeExecutionConfig(
  runtimeOptions: WebCliRuntimeOptions,
  next?: Partial<CompanionConfig>,
): CompanionConfig {
  return mergeCompanionConfig(
    {
      ...DEFAULT_EXECUTION_CONFIG,
      autoScroll: runtimeOptions.clickAutoScroll,
    },
    next,
  )
}

function captureTarget(descriptor: TargetDescriptor): PageTarget {
  const element = findElement(descriptor)
  if (!element) {
    throw new Error(`missing element for target ${descriptor.target.targetId}`)
  }
  const sensitive = element ? isSensitive(element) : false
  const textContent = element.textContent?.trim() ?? ''
  const valuePreview =
    isFillableElement(element) && !sensitive ? element.value : null
  const rect = element.getBoundingClientRect()
  const visible = isVisible(element)
  const inViewport = visible && isInViewport(rect)
  const enabled = isEnabled(element)
  const covered = inViewport ? !isTopmostInteractable(element) : false
  const actionableNow = visible && enabled && !covered
  const overlay = isOverlayElement(element)

  return {
    actionKind: descriptor.actionKind,
    description: descriptor.target.desc,
    enabled,
    groupId: descriptor.groupId,
    groupName: descriptor.groupName,
    groupDesc: descriptor.groupDesc,
    name: descriptor.target.name,
    selector: descriptor.target.selector,
    sensitive,
    targetId: descriptor.target.targetId,
    visible,
    inViewport,
    covered,
    actionableNow,
    overlay,
    textContent,
    valuePreview,
    sourceFile: descriptor.target.sourceFile,
    sourceLine: descriptor.target.sourceLine,
    sourceColumn: descriptor.target.sourceColumn,
  }
}

function makeSnapshot(
  descriptors: TargetDescriptor[],
  store: MutableSnapshotStore,
): PageSnapshot {
  const targets = descriptors.flatMap(descriptor => {
    const element = findElement(descriptor)
    if (!element) {
      return []
    }
    return [captureTarget(descriptor)]
  })

  const groups = new Map<string, { groupId: string; groupName?: string; groupDesc?: string; targetIds: string[] }>()
  for (const target of targets) {
    const group = groups.get(target.groupId)
    if (group) {
      group.targetIds.push(target.targetId)
      continue
    }

    groups.set(target.groupId, {
      groupId: target.groupId,
      groupName: target.groupName,
      groupDesc: target.groupDesc,
      targetIds: [target.targetId],
    })
  }

  const signature = JSON.stringify({
    targets: targets.map(target => ({
      actionKind: target.actionKind,
      actionableNow: target.actionableNow,
      covered: target.covered,
      enabled: target.enabled,
      inViewport: target.inViewport,
      sensitive: target.sensitive,
      targetId: target.targetId,
      textContent: target.textContent,
      valuePreview: target.valuePreview,
      visible: target.visible,
    })),
    title: document.title,
    url: window.location.href,
  })

  if (store.signature !== signature) {
    store.version += 1
    store.signature = signature
  }

  const snapshot: PageSnapshot = {
    capturedAt: Date.now(),
    groups: Array.from(groups.values()).map(group => ({
      groupId: group.groupId,
      groupName: group.groupName,
      groupDesc: group.groupDesc,
      targetIds: group.targetIds.sort(),
    })),
    targets,
    title: document.title,
    url: window.location.href,
    version: store.version,
  }

  store.latest = snapshot
  return snapshot
}

function buildErrorResult(
  commandId: string,
  code: Parameters<typeof createCommandError>[0],
  message: string,
  snapshot: PageSnapshot,
  targetId?: string,
): CommandResult {
  return {
    commandId,
    error: createCommandError(code, message, {
      snapshotVersion: snapshot.version,
      targetId,
    }),
    ok: false,
    snapshotVersion: snapshot.version,
    snapshot,
  }
}

function buildSuccessResult(
  commandId: string,
  snapshot: PageSnapshot,
  result: Record<string, unknown>,
): CommandResult {
  return {
    commandId,
    ok: true,
    result,
    snapshotVersion: snapshot.version,
    snapshot,
  }
}

// ---------------------------------------------------------------------------
// Cursor animation system
// ---------------------------------------------------------------------------

const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <g filter="url(#shadow)">
    <path d="M5 3L5 21L9.5 16.5L13.5 22L16 20.5L12 14.5L18 14.5L5 3Z" fill="white" stroke="black" stroke-width="1.2" stroke-linejoin="round"/>
  </g>
  <defs>
    <filter id="shadow" x="0" y="0" width="24" height="28" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="1" stdDeviation="0.8" flood-opacity="0.35"/>
    </filter>
  </defs>
</svg>`

const CURSOR_ANIMATION_DURATION_MS = 600
const CURSOR_CLICK_PRESS_MS = 100
const CURSOR_CLICK_RING_MS = 300
const CURSOR_POST_ANIMATION_DELAY_MS = 200

interface CursorState {
  element: HTMLDivElement
  lastX: number | null
  lastY: number | null
}

let cursorState: CursorState | null = null

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function getOrCreateCursorElement(): CursorState {
  if (cursorState) {
    // Ensure it's still in the DOM (might have been removed)
    if (!cursorState.element.parentElement) {
      document.body.appendChild(cursorState.element)
    }
    return cursorState
  }

  const el = document.createElement('div')
  el.setAttribute('data-webcli-pointer', 'true')
  el.innerHTML = CURSOR_SVG
  Object.assign(el.style, {
    position: 'fixed',
    top: '0px',
    left: '0px',
    width: '24px',
    height: '24px',
    pointerEvents: 'none',
    zIndex: '2147483647',
    willChange: 'transform',
    display: 'none',
  })

  document.body.appendChild(el)
  cursorState = { element: el, lastX: null, lastY: null }
  return cursorState
}

function animateWithRAF(
  durationMs: number,
  onFrame: (progress: number) => void,
): Promise<void> {
  return new Promise(resolve => {
    const startTime = performance.now()
    function tick(now: number) {
      const elapsed = now - startTime
      const raw = Math.min(elapsed / durationMs, 1)
      onFrame(raw)
      if (raw < 1) {
        requestAnimationFrame(tick)
      } else {
        resolve()
      }
    }
    requestAnimationFrame(tick)
  })
}

function createClickRing(x: number, y: number): HTMLDivElement {
  const ring = document.createElement('div')
  ring.setAttribute('data-webcli-pointer', 'true')
  Object.assign(ring.style, {
    position: 'fixed',
    left: `${x}px`,
    top: `${y}px`,
    width: '0px',
    height: '0px',
    borderRadius: '50%',
    border: '2px solid #ff5a36',
    pointerEvents: 'none',
    zIndex: '2147483647',
    transform: 'translate(-50%, -50%)',
    opacity: '1',
    boxSizing: 'border-box',
  })
  document.body.appendChild(ring)
  return ring
}

async function animateCursorTo(element: HTMLElement): Promise<void> {
  const state = getOrCreateCursorElement()
  const el = state.element

  // Determine end position: center of the target element
  const rect = element.getBoundingClientRect()
  const endX = rect.left + rect.width / 2
  const endY = rect.top + rect.height / 2

  // Determine start position
  let startX: number
  let startY: number
  if (state.lastX !== null && state.lastY !== null) {
    startX = state.lastX
    startY = state.lastY
  } else {
    // Start from right edge, vertically centered
    startX = window.innerWidth + 20
    startY = window.innerHeight / 2
  }

  // Show cursor at start position
  el.style.display = 'block'
  el.style.transform = `translate(${startX}px, ${startY}px)`

  // Animate from start to end
  await animateWithRAF(CURSOR_ANIMATION_DURATION_MS, raw => {
    const t = easeOutCubic(raw)
    const currentX = startX + (endX - startX) * t
    const currentY = startY + (endY - startY) * t
    el.style.transform = `translate(${currentX}px, ${currentY}px)`
  })

  // Click effect: scale-down (press)
  el.style.transform = `translate(${endX}px, ${endY}px) scale(0.75)`
  el.style.transition = `transform ${CURSOR_CLICK_PRESS_MS}ms ease-in`

  // Pulse ring on target
  const ring = createClickRing(endX, endY)

  await Promise.all([
    sleep(CURSOR_CLICK_PRESS_MS),
    animateWithRAF(CURSOR_CLICK_RING_MS, raw => {
      const size = raw * 40
      ring.style.width = `${size}px`
      ring.style.height = `${size}px`
      ring.style.opacity = `${1 - raw}`
    }),
  ])

  ring.remove()

  // Scale cursor back to normal
  el.style.transform = `translate(${endX}px, ${endY}px) scale(1)`
  await sleep(CURSOR_CLICK_PRESS_MS)

  // Clear transition so future RAF animations aren't affected
  el.style.transition = ''

  // Save final position
  state.lastX = endX
  state.lastY = endY
}

/**
 * Legacy pointer overlay. Now delegates to the cursor animation system.
 * Kept for backward compatibility.
 */
async function flashPointerOverlay(element: HTMLElement): Promise<void> {
  await animateCursorTo(element)
}

function setElementValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  element.focus()
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
    descriptor?.set?.call(element, value)
  } else {
    element.value = value
  }
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

export function createPageAgentRuntime(
  manifest: WebCliManifest,
  options: Partial<WebCliRuntimeOptions> = {},
): PageAgentRuntime {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Page agent runtime requires a browser environment.')
  }

  const runtimeOptions = { ...DEFAULT_OPTIONS, ...options }
  const descriptors = collectDescriptors(manifest)
  const snapshotStore: MutableSnapshotStore = {
    latest: null,
    signature: null,
    version: 0,
  }

  const captureSnapshot = () => makeSnapshot(descriptors, snapshotStore)

  const withDescriptor = async (
    commandId: string,
    targetId: string,
    expectedVersion: number | undefined,
    effect: (
      descriptor: TargetDescriptor,
      element: HTMLElement,
      snapshot: PageSnapshot,
    ) => Promise<CommandResult>,
  ): Promise<CommandResult> => {
    const currentSnapshot = captureSnapshot()
    if (
      typeof expectedVersion === 'number' &&
      Number.isFinite(expectedVersion) &&
      expectedVersion !== currentSnapshot.version
    ) {
      return buildErrorResult(
        commandId,
        'STALE_SNAPSHOT',
        `snapshot version mismatch: expected ${expectedVersion}, received ${currentSnapshot.version}`,
        currentSnapshot,
        targetId,
      )
    }

    const descriptor = descriptors.find(entry => entry.target.targetId === targetId)
    if (!descriptor) {
      return buildErrorResult(commandId, 'TARGET_NOT_FOUND', `target not found: ${targetId}`, currentSnapshot, targetId)
    }

    const element = findElement(descriptor)
    if (!element) {
      return buildErrorResult(
        commandId,
        'TARGET_NOT_FOUND',
        `element not found: ${descriptor.target.selector}`,
        currentSnapshot,
        targetId,
      )
    }

    return effect(descriptor, element, currentSnapshot)
  }

  return {
    getSnapshot: captureSnapshot,

    act: async input =>
      withDescriptor(input.commandId ?? input.targetId, input.targetId, input.expectedVersion, async (descriptor, element, snapshot) => {
        if (descriptor.actionKind !== 'click') {
          return buildErrorResult(input.commandId ?? input.targetId, 'INVALID_TARGET', `target does not support click: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }

        if (!isVisible(element)) {
          return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is not visible: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }

        const config = normalizeExecutionConfig(runtimeOptions, input.config)
        if (config.autoScroll && !isInViewport(element.getBoundingClientRect())) {
          element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' })
        }

        if (!isInViewport(element.getBoundingClientRect())) {
          return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is outside of viewport: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }
        if (!isTopmostInteractable(element)) {
          return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is covered by another element: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }
        if (!isEnabled(element)) {
          return buildErrorResult(input.commandId ?? input.targetId, 'DISABLED', `target is disabled: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }

        if (config.pointerAnimation) {
          await flashPointerOverlay(element)
        }
        if (config.clickDelayMs > 0) {
          await sleep(config.clickDelayMs)
        }

        element.click()
        const nextSnapshot = captureSnapshot()
        return buildSuccessResult(input.commandId ?? input.targetId, nextSnapshot, {
          actionKind: 'click',
          targetId: descriptor.target.targetId,
        })
      }),

    fill: async input =>
      withDescriptor(input.commandId ?? input.targetId, input.targetId, input.expectedVersion, async (descriptor, element, snapshot) => {
        if (descriptor.actionKind !== 'fill') {
          return buildErrorResult(input.commandId ?? input.targetId, 'INVALID_TARGET', `target does not support fill: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }
        if (!isFillableElement(element)) {
          return buildErrorResult(input.commandId ?? input.targetId, 'INVALID_TARGET', `target is not fillable: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }
        if (!isVisible(element)) {
          return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is not visible: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }

        const config = normalizeExecutionConfig(runtimeOptions, input.config)
        if (config.autoScroll && !isInViewport(element.getBoundingClientRect())) {
          element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' })
        }

        if (!isInViewport(element.getBoundingClientRect())) {
          return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is outside of viewport: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }
        if (!isTopmostInteractable(element)) {
          return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is covered by another element: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }
        if (!isEnabled(element)) {
          return buildErrorResult(input.commandId ?? input.targetId, 'DISABLED', `target is disabled: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }

        if (config.pointerAnimation) {
          await flashPointerOverlay(element)
        }
        if (config.clickDelayMs > 0) {
          await sleep(config.clickDelayMs)
        }

        setElementValue(element, input.value)
        const nextSnapshot = captureSnapshot()
        return buildSuccessResult(input.commandId ?? input.targetId, nextSnapshot, {
          actionKind: 'fill',
          targetId: descriptor.target.targetId,
          value: input.value,
        })
      }),

    wait: async input => {
      const timeoutMs =
        typeof input.timeoutMs === 'number' && input.timeoutMs > 0 ? input.timeoutMs : 5_000
      const startedAt = Date.now()
      const descriptor = descriptors.find(entry => entry.target.targetId === input.targetId)

      if (!descriptor) {
        const snapshot = captureSnapshot()
        return buildErrorResult(
          input.commandId ?? input.targetId,
          'TARGET_NOT_FOUND',
          `target not found: ${input.targetId}`,
          snapshot,
          input.targetId,
        )
      }

      for (;;) {
        const snapshot = captureSnapshot()
        const target = captureTarget(descriptor)

        const matched =
          (input.state === 'visible' && target.visible) ||
          (input.state === 'hidden' && !target.visible) ||
          (input.state === 'enabled' && target.enabled) ||
          (input.state === 'disabled' && !target.enabled)

        if (matched) {
          return buildSuccessResult(input.commandId ?? input.targetId, snapshot, {
            state: input.state,
            targetId: input.targetId,
          })
        }

        if (Date.now() - startedAt >= timeoutMs) {
          return buildErrorResult(
            input.commandId ?? input.targetId,
            'TIMEOUT',
            `wait timed out for ${input.targetId} (${input.state})`,
            snapshot,
            input.targetId,
          )
        }

        await sleep(50)
      }
    },

    guide: async input =>
      withDescriptor(input.commandId ?? input.targetId, input.targetId, input.expectedVersion, async (descriptor, element, snapshot) => {
        if (descriptor.actionKind !== 'click') {
          return buildErrorResult(input.commandId ?? input.targetId, 'INVALID_TARGET', `target does not support click: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }

        if (!isVisible(element)) {
          return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is not visible: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }

        // Always auto-scroll for guide mode
        if (!isInViewport(element.getBoundingClientRect())) {
          element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' })
        }

        if (!isInViewport(element.getBoundingClientRect())) {
          return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is outside of viewport: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }
        if (!isTopmostInteractable(element)) {
          return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is covered by another element: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }
        if (!isEnabled(element)) {
          return buildErrorResult(input.commandId ?? input.targetId, 'DISABLED', `target is disabled: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }

        // Always perform cursor animation in guide mode (ignore config.pointerAnimation)
        await animateCursorTo(element)
        await sleep(CURSOR_POST_ANIMATION_DELAY_MS)

        element.click()
        const nextSnapshot = captureSnapshot()
        return buildSuccessResult(input.commandId ?? input.targetId, nextSnapshot, {
          actionKind: 'guide',
          targetId: descriptor.target.targetId,
        })
      }),
  }
}

export function getInstalledPageAgentRuntime(): PageAgentRuntimeHandle | null {
  return getGlobalRuntimeStore().active ?? null
}

export function installPageAgentRuntime(
  manifest: WebCliManifest,
  options: Partial<WebCliRuntimeOptions> = {},
): PageAgentRuntimeHandle {
  const runtime = createPageAgentRuntime(manifest, options)
  const globalStore = getGlobalRuntimeStore()
  globalStore.active?.dispose()

  const handle: PageAgentRuntimeHandle = {
    ...runtime,
    dispose() {
      const current = getGlobalRuntimeStore()
      if (current.active === handle) {
        current.active = undefined
      }
      if (typeof window !== 'undefined' && window.webcliDom === runtime) {
        delete window.webcliDom
      }
    },
  }

  globalStore.active = handle
  window.webcliDom = runtime
  return handle
}
