import {
  createCommandError,
  mergeCompanionConfig,
  type CommandResult,
  type CompanionConfig,
  type DragPlacement,
  type PageSnapshot,
  type PageTarget,
  type PageTargetReason,
} from '@webcli-dom/core'
import { getCursorMeta, DEFAULT_CURSOR_NAME, POINTER_FILL_SVG, POINTER_BORDER_MASK_SVG } from './cursors/index'
import { Motion } from 'ai-motion'
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
  cursorName: DEFAULT_CURSOR_NAME,
  auroraGlow: true,
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

interface TargetState {
  visible: boolean
  inViewport: boolean
  enabled: boolean
  covered: boolean
  actionableNow: boolean
  overlay: boolean
  sensitive: boolean
  reason: PageTargetReason
}

export interface PageAgentRuntime {
  getSnapshot: () => PageSnapshot
  act: (input: {
    commandId?: string
    targetId: string
    expectedVersion?: number
    config?: Partial<CompanionConfig>
  }) => Promise<CommandResult>
  drag: (input: {
    commandId?: string
    sourceTargetId: string
    destinationTargetId: string
    placement?: DragPlacement
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
    config?: Partial<CompanionConfig>
  }) => Promise<CommandResult>
  applyConfig: (config: Partial<CompanionConfig>) => void
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

function resolveTargetReason(input: {
  actionKind: ActionKind
  visible: boolean
  inViewport: boolean
  enabled: boolean
  covered: boolean
  sensitive: boolean
}): PageTargetReason {
  if (!input.visible) {
    return 'hidden'
  }
  if (!input.inViewport) {
    return 'offscreen'
  }
  if (input.covered) {
    return 'covered'
  }
  if (!input.enabled) {
    return 'disabled'
  }
  if (input.actionKind === 'fill' && input.sensitive) {
    return 'sensitive'
  }
  return 'ready'
}

function captureTargetState(actionKind: ActionKind, element: HTMLElement): TargetState {
  const sensitive = isSensitive(element)
  const rect = element.getBoundingClientRect()
  const visible = isVisible(element)
  const inViewport = visible && isInViewport(rect)
  const enabled = isEnabled(element)
  const covered = inViewport ? !isTopmostInteractable(element) : false
  const actionableNow = visible && enabled && !covered
  const overlay = isOverlayElement(element)

  return {
    visible,
    inViewport,
    enabled,
    covered,
    actionableNow,
    overlay,
    sensitive,
    reason: resolveTargetReason({
      actionKind,
      visible,
      inViewport,
      enabled,
      covered,
      sensitive,
    }),
  }
}

function captureTarget(descriptor: TargetDescriptor): PageTarget {
  const element = findElement(descriptor)
  if (!element) {
    throw new Error(`missing element for target ${descriptor.target.targetId}`)
  }
  const state = captureTargetState(descriptor.actionKind, element)
  const textContent = element.textContent?.trim() ?? ''
  const valuePreview =
    isFillableElement(element) && !state.sensitive ? element.value : null

  // 동적 속성(name/desc)이 null이면 DOM에서 읽는다
  const name = descriptor.target.name ?? element.getAttribute('data-webcli-name') ?? textContent
  const description = descriptor.target.desc ?? element.getAttribute('data-webcli-desc') ?? ''

  return {
    actionKind: descriptor.actionKind,
    description,
    enabled: state.enabled,
    groupId: descriptor.groupId,
    groupName: descriptor.groupName,
    groupDesc: descriptor.groupDesc,
    name,
    reason: state.reason,
    selector: descriptor.target.selector,
    sensitive: state.sensitive,
    targetId: descriptor.target.targetId,
    visible: state.visible,
    inViewport: state.inViewport,
    covered: state.covered,
    actionableNow: state.actionableNow,
    overlay: state.overlay,
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
      reason: target.reason,
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
// Cursor animation system (page-agent style)
// ---------------------------------------------------------------------------

const CURSOR_STYLE_ID = 'webcli-cursor-style'
const CURSOR_ANIMATION_DURATION_MS = 600
const CURSOR_CLICK_PRESS_MS = 100
const CURSOR_POST_ANIMATION_DELAY_MS = 200
const DRAG_POINTER_ID = 1
const DRAG_MOVE_STEPS = 12

interface CursorState {
  element: HTMLDivElement
  cursorName: string
  lastX: number | null
  lastY: number | null
}

interface PointerCoords {
  clientX: number
  clientY: number
}

let cursorState: CursorState | null = null

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function ensureCursorStyles(): void {
  if (document.getElementById(CURSOR_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = CURSOR_STYLE_ID
  style.textContent = `
.webcli-cursor{position:fixed;top:0;left:0;width:75px;height:75px;pointer-events:none;z-index:2147483647;will-change:transform;display:none}
.webcli-cursor-filling{position:absolute;width:100%;height:100%;background-image:url("${POINTER_FILL_SVG}");background-size:100% 100%;background-repeat:no-repeat;filter:drop-shadow(3px 4px 4px rgba(0,0,0,0.4));transform-origin:center;transform:rotate(-135deg) scale(1.2);margin-left:-10px;margin-top:-18px}
.webcli-cursor-border{position:absolute;width:100%;height:100%;background:linear-gradient(45deg,rgb(57,182,255),rgb(189,69,251));-webkit-mask-image:url("${POINTER_BORDER_MASK_SVG}");mask-image:url("${POINTER_BORDER_MASK_SVG}");-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;transform-origin:center;transform:rotate(-135deg) scale(1.2);margin-left:-10px;margin-top:-18px}
.webcli-cursor-ripple{position:absolute;width:100%;height:100%;pointer-events:none;margin-left:-50%;margin-top:-50%}
.webcli-cursor-ripple::after{content:"";opacity:0;position:absolute;inset:0;border:4px solid rgba(57,182,255,1);border-radius:50%}
.webcli-cursor.clicking .webcli-cursor-ripple::after{animation:webcli-ripple 300ms ease-out forwards}
@keyframes webcli-ripple{0%{transform:scale(0);opacity:1}100%{transform:scale(2);opacity:0}}
`
  document.head.appendChild(style)
}

function createPointerCursorElement(): HTMLDivElement {
  ensureCursorStyles()
  const el = document.createElement('div')
  el.className = 'webcli-cursor'
  el.setAttribute('data-webcli-pointer', 'true')

  const ripple = document.createElement('div')
  ripple.className = 'webcli-cursor-ripple'
  const filling = document.createElement('div')
  filling.className = 'webcli-cursor-filling'
  const border = document.createElement('div')
  border.className = 'webcli-cursor-border'

  el.appendChild(ripple)
  el.appendChild(filling)
  el.appendChild(border)
  return el
}

function createSvgCursorElement(meta: import('./cursors/index').CursorMeta): HTMLDivElement {
  const el = document.createElement('div')
  el.setAttribute('data-webcli-pointer', 'true')
  el.innerHTML = meta.svg ?? ''
  Object.assign(el.style, {
    position: 'fixed',
    top: '0px',
    left: '0px',
    width: `${meta.width}px`,
    height: `${meta.height}px`,
    pointerEvents: 'none',
    zIndex: '2147483647',
    willChange: 'transform',
    display: 'none',
  })
  return el
}

function getOrCreateCursorElement(cursorName: string): CursorState {
  const meta = getCursorMeta(cursorName)

  if (cursorState) {
    if (!cursorState.element.parentElement) {
      document.body.appendChild(cursorState.element)
    }
    if (cursorState.cursorName !== cursorName) {
      cursorState.element.remove()
      const el = meta.kind === 'css-layers' ? createPointerCursorElement() : createSvgCursorElement(meta)
      document.body.appendChild(el)
      cursorState.element = el
      cursorState.cursorName = cursorName
    }
    return cursorState
  }

  const el = meta.kind === 'css-layers' ? createPointerCursorElement() : createSvgCursorElement(meta)
  document.body.appendChild(el)
  cursorState = { element: el, cursorName, lastX: null, lastY: null }
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

async function smoothScrollIntoView(element: HTMLElement): Promise<void> {
  if (isInViewport(element.getBoundingClientRect())) {
    return
  }
  element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  const deadline = performance.now() + 800
  let lastScrollX = window.scrollX
  let lastScrollY = window.scrollY
  let stableFrames = 0
  while (performance.now() < deadline) {
    await new Promise<void>(r => requestAnimationFrame(() => r()))
    const sx = window.scrollX
    const sy = window.scrollY
    if (sx === lastScrollX && sy === lastScrollY) {
      stableFrames++
      if (stableFrames >= 3) break
    } else {
      stableFrames = 0
      lastScrollX = sx
      lastScrollY = sy
    }
  }
}

function triggerCursorClick(el: HTMLDivElement): void {
  el.classList.remove('clicking')
  void el.offsetHeight
  el.classList.add('clicking')
}

async function animateCursorTo(element: HTMLElement, cursorName: string, onPress?: () => void): Promise<void> {
  const meta = getCursorMeta(cursorName)
  const state = getOrCreateCursorElement(cursorName)
  const el = state.element

  const rect = element.getBoundingClientRect()
  const endX = rect.left + rect.width / 2 - meta.hotspotX
  const endY = rect.top + rect.height / 2 - meta.hotspotY

  let startX: number
  let startY: number
  if (state.lastX !== null && state.lastY !== null) {
    startX = state.lastX
    startY = state.lastY
  } else {
    startX = window.innerWidth + 20
    startY = window.innerHeight / 2
  }

  el.style.display = 'block'
  el.style.transform = `translate(${startX}px, ${startY}px)`

  await animateWithRAF(CURSOR_ANIMATION_DURATION_MS, raw => {
    const t = easeOutCubic(raw)
    const cx = startX + (endX - startX) * t
    const cy = startY + (endY - startY) * t
    el.style.transform = `translate(${cx}px, ${cy}px)`
  })

  // Press down: cursor shrinks
  el.style.transition = `transform ${CURSOR_CLICK_PRESS_MS}ms ease-in`
  el.style.transform = `translate(${endX}px, ${endY}px) scale(0.85)`
  await new Promise<void>(r => {
    const done = () => { el.removeEventListener('transitionend', done); r() }
    el.addEventListener('transitionend', done, { once: true })
    setTimeout(done, CURSOR_CLICK_PRESS_MS + 50) // fallback
  })

  // Cursor fully pressed — fire ripple + action at the impact moment
  triggerCursorClick(el)
  onPress?.()

  // Release
  el.style.transform = `translate(${endX}px, ${endY}px) scale(1)`
  await new Promise<void>(r => {
    const done = () => { el.removeEventListener('transitionend', done); r() }
    el.addEventListener('transitionend', done, { once: true })
    setTimeout(done, CURSOR_CLICK_PRESS_MS + 50)
  })
  el.style.transition = ''

  state.lastX = endX
  state.lastY = endY
}

// ---------------------------------------------------------------------------
// Aurora glow border effect (ai-motion WebGL)
// ---------------------------------------------------------------------------

let motionInstance: Motion | null = null
let motionWrapper: HTMLDivElement | null = null

function showAuroraGlow(): void {
  if (motionInstance) return

  try {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-webcli-aurora', 'true')
    Object.assign(wrapper.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483646',
      overflow: 'hidden',
      pointerEvents: 'none',
    })
    document.body.appendChild(wrapper)

    const motion = new Motion({
      mode: 'dark',
      borderWidth: 2,
      glowWidth: 800,
      borderRadius: 0,
      styles: { position: 'absolute', inset: '0' },
    })

    wrapper.appendChild(motion.element)
    motion.autoResize(wrapper)
    motion.start()
    motion.fadeIn()

    motionInstance = motion
    motionWrapper = wrapper
  } catch {
    // WebGL2 not available — silently skip
  }
}

function hideAuroraGlow(): void {
  if (!motionInstance || !motionWrapper) return
  try {
    motionInstance.fadeOut()
  } catch { /* ignore */ }
  const wrapper = motionWrapper
  motionInstance = null
  motionWrapper = null
  setTimeout(() => wrapper.remove(), 500)
}

async function flashPointerOverlay(element: HTMLElement, config: CompanionConfig, onPress?: () => void): Promise<void> {
  await animateCursorTo(element, config.cursorName ?? DEFAULT_CURSOR_NAME, onPress)
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

function getElementCenter(element: HTMLElement): PointerCoords {
  const rect = element.getBoundingClientRect()
  return {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  }
}

function getDragPlacementCoords(
  element: HTMLElement,
  placement: DragPlacement,
): PointerCoords {
  const rect = element.getBoundingClientRect()
  const horizontalCenter = rect.left + rect.width / 2
  const edgeOffset = Math.max(6, Math.min(18, rect.height * 0.2))

  if (placement === 'before') {
    return {
      clientX: horizontalCenter,
      clientY: rect.top + edgeOffset,
    }
  }

  if (placement === 'after') {
    return {
      clientX: horizontalCenter,
      clientY: rect.bottom - edgeOffset,
    }
  }

  return {
    clientX: horizontalCenter,
    clientY: rect.top + rect.height / 2,
  }
}

function dispatchMouseLikeEvent(
  target: EventTarget,
  type: string,
  coords: PointerCoords,
  buttons: number,
  bubbles: boolean,
): void {
  const event = new MouseEvent(type, {
    bubbles,
    button: 0,
    buttons,
    cancelable: true,
    clientX: coords.clientX,
    clientY: coords.clientY,
    composed: true,
    detail: 1,
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
): void {
  if (typeof window.PointerEvent !== 'function') return

  const event = new window.PointerEvent(type, {
    bubbles,
    button: 0,
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

function getEventTargetAtPoint(
  fallback: HTMLElement,
  coords: PointerCoords,
): HTMLElement {
  const hit = document.elementFromPoint(coords.clientX, coords.clientY)
  return hit instanceof HTMLElement ? hit : fallback
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
        await smoothScrollIntoView(element)

        if (!isInViewport(element.getBoundingClientRect())) {
          return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is outside of viewport: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }
        if (!isTopmostInteractable(element)) {
          return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is covered by another element: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }
        if (!isEnabled(element)) {
          return buildErrorResult(input.commandId ?? input.targetId, 'DISABLED', `target is disabled: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }

        showAuroraGlow()
        if (config.clickDelayMs > 0) {
          await sleep(config.clickDelayMs)
        }

        if (config.pointerAnimation) {
          await flashPointerOverlay(element, config, () => element.click())
        } else {
          element.click()
        }
        const nextSnapshot = captureSnapshot()
        return buildSuccessResult(input.commandId ?? input.targetId, nextSnapshot, {
          actionKind: 'click',
          targetId: descriptor.target.targetId,
        })
      }),

    drag: async input =>
      withDescriptor(
        input.commandId ?? input.sourceTargetId,
        input.sourceTargetId,
        input.expectedVersion,
        async (sourceDescriptor, sourceElement, snapshot) => {
          if (input.sourceTargetId === input.destinationTargetId) {
            return buildErrorResult(
              input.commandId ?? input.sourceTargetId,
              'INVALID_COMMAND',
              'sourceTargetId and destinationTargetId must be different',
              snapshot,
              input.sourceTargetId,
            )
          }

          const destinationDescriptor = descriptors.find(
            entry => entry.target.targetId === input.destinationTargetId,
          )
          if (!destinationDescriptor) {
            return buildErrorResult(
              input.commandId ?? input.sourceTargetId,
              'TARGET_NOT_FOUND',
              `target not found: ${input.destinationTargetId}`,
              snapshot,
              input.destinationTargetId,
            )
          }

          const destinationElement = findElement(destinationDescriptor)
          if (!destinationElement) {
            return buildErrorResult(
              input.commandId ?? input.sourceTargetId,
              'TARGET_NOT_FOUND',
              `element not found: ${destinationDescriptor.target.selector}`,
              snapshot,
              input.destinationTargetId,
            )
          }

          if (!isVisible(sourceElement)) {
            return buildErrorResult(
              input.commandId ?? input.sourceTargetId,
              'NOT_VISIBLE',
              `target is not visible: ${sourceDescriptor.target.targetId}`,
              snapshot,
              sourceDescriptor.target.targetId,
            )
          }

          const config = normalizeExecutionConfig(runtimeOptions, input.config)
          await smoothScrollIntoView(sourceElement)

          if (!isInViewport(sourceElement.getBoundingClientRect())) {
            return buildErrorResult(
              input.commandId ?? input.sourceTargetId,
              'NOT_VISIBLE',
              `target is outside of viewport: ${sourceDescriptor.target.targetId}`,
              snapshot,
              sourceDescriptor.target.targetId,
            )
          }
          if (!isTopmostInteractable(sourceElement)) {
            return buildErrorResult(
              input.commandId ?? input.sourceTargetId,
              'NOT_VISIBLE',
              `target is covered by another element: ${sourceDescriptor.target.targetId}`,
              snapshot,
              sourceDescriptor.target.targetId,
            )
          }
          if (!isEnabled(sourceElement)) {
            return buildErrorResult(
              input.commandId ?? input.sourceTargetId,
              'DISABLED',
              `target is disabled: ${sourceDescriptor.target.targetId}`,
              snapshot,
              sourceDescriptor.target.targetId,
            )
          }

          if (config.clickDelayMs > 0) {
            await sleep(config.clickDelayMs)
          }

          await smoothScrollIntoView(destinationElement)
          const placement = input.placement ?? 'inside'

          if (!isVisible(destinationElement)) {
            return buildErrorResult(
              input.commandId ?? input.sourceTargetId,
              'NOT_VISIBLE',
              `target is not visible: ${destinationDescriptor.target.targetId}`,
              snapshot,
              destinationDescriptor.target.targetId,
            )
          }
          if (!isInViewport(destinationElement.getBoundingClientRect())) {
            return buildErrorResult(
              input.commandId ?? input.sourceTargetId,
              'NOT_VISIBLE',
              `target is outside of viewport: ${destinationDescriptor.target.targetId}`,
              snapshot,
              destinationDescriptor.target.targetId,
            )
          }
          if (!isTopmostInteractable(destinationElement)) {
            return buildErrorResult(
              input.commandId ?? input.sourceTargetId,
              'NOT_VISIBLE',
              `target is covered by another element: ${destinationDescriptor.target.targetId}`,
              snapshot,
              destinationDescriptor.target.targetId,
            )
          }

          showAuroraGlow()
          await performPointerDragSequence(sourceElement, destinationElement, placement)
          const nextSnapshot = captureSnapshot()
          return buildSuccessResult(input.commandId ?? input.sourceTargetId, nextSnapshot, {
            actionKind: 'drag',
            destinationTargetId: input.destinationTargetId,
            placement,
            sourceTargetId: input.sourceTargetId,
          })
        },
      ),

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
        await smoothScrollIntoView(element)

        if (!isInViewport(element.getBoundingClientRect())) {
          return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is outside of viewport: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }
        if (!isTopmostInteractable(element)) {
          return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is covered by another element: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }
        if (!isEnabled(element)) {
          return buildErrorResult(input.commandId ?? input.targetId, 'DISABLED', `target is disabled: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
        }

        showAuroraGlow()
        if (config.clickDelayMs > 0) {
          await sleep(config.clickDelayMs)
        }

        if (config.pointerAnimation) {
          await flashPointerOverlay(element, config, () => setElementValue(element, input.value))
        } else {
          setElementValue(element, input.value)
        }
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
        await smoothScrollIntoView(element)

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
        const guideConfig = normalizeExecutionConfig(runtimeOptions, input.config)
        showAuroraGlow()
        await animateCursorTo(element, guideConfig.cursorName ?? DEFAULT_CURSOR_NAME, () => element.click())
        const nextSnapshot = captureSnapshot()
        return buildSuccessResult(input.commandId ?? input.targetId, nextSnapshot, {
          actionKind: 'guide',
          targetId: descriptor.target.targetId,
        })
      }),

    applyConfig: (config: Partial<CompanionConfig>) => {
      if (config.pointerAnimation === false && cursorState?.element) {
        cursorState.element.style.display = 'none'
      }
      if (config.cursorName && cursorState && config.cursorName !== cursorState.cursorName) {
        getOrCreateCursorElement(config.cursorName)
      }
    },
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
