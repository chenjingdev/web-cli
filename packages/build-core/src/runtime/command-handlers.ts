import {
  type CommandResult,
  type DragPlacement,
  type PageSnapshot,
  type AgagruneRuntimeConfig,
  mergeRuntimeConfig,
} from '@agrune/core'
import type { AgagruneRuntimeOptions } from '../types'
import {
  type PointerCoords,
  getElementCenter,
  getDragPlacementCoords,
  getInteractablePoint,
  isElementInViewport,
  isEnabled,
  isFillableElement,
  isTopmostInteractable,
  isVisible,
  smoothScrollIntoView,
} from './dom-utils'
import {
  type ActionKind,
  type MutableSnapshotStore,
  type TargetDescriptor,
  ACT_COMPATIBLE_KINDS,
  buildErrorResult,
  buildFlowBlockedResult,
  buildSuccessResult,
  captureTarget,
  findSnapshotTarget,
  isOverlayFlowLocked,
  parseRuntimeTargetId,
  resolveRuntimeTarget,
} from './snapshot'
import { DEFAULT_CURSOR_NAME } from './cursors/index'
import {
  animateWithRAF,
  easeOutCubic,
  flashPointerOverlay,
  getOrCreateCursorElement,
  getCursorStartPosition,
  getCursorTranslatePosition,
  setCursorTransform,
  applyCursorPressStyle,
  removeCursorPressStyle,
  waitForCursorTransition,
  triggerCursorClick,
  saveCursorPosition,
  resolvePointerDurationMs,
  CURSOR_CLICK_PRESS_MS,
} from './cursor-animator'
import { getCursorMeta } from './cursors/index'
import type { EventSequences, Coords } from './event-sequences'
import type { ActionQueue } from './action-queue'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_OPTIONS: AgagruneRuntimeOptions = {
  clickAutoScroll: true,
  clickRetryCount: 2,
  clickRetryDelayMs: 120,
}

export const DEFAULT_EXECUTION_CONFIG: AgagruneRuntimeConfig = {
  autoScroll: true,
  clickDelayMs: 0,
  pointerDurationMs: 600,
  pointerAnimation: false,
  cursorName: DEFAULT_CURSOR_NAME,
  auroraGlow: true,
  auroraTheme: 'dark',
}

export type WaitState = 'visible' | 'hidden' | 'enabled' | 'disabled'

export const MAX_READ_CHARS = 50_000

export const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG',
])

// ---------------------------------------------------------------------------
// Constants — drag
// ---------------------------------------------------------------------------

const DRAG_MOVE_STEPS = 12

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Convert PointerCoords (clientX/clientY) to event-sequences Coords (x/y) */
function toCoords(pc: PointerCoords): Coords {
  return { x: pc.clientX, y: pc.clientY }
}

/** requestAnimationFrame as a promise — one-frame sync */
function raf(): Promise<void> {
  return new Promise(r => requestAnimationFrame(() => r()))
}

export function normalizeExecutionConfig(
  runtimeOptions: AgagruneRuntimeOptions,
  next?: Partial<AgagruneRuntimeConfig>,
): AgagruneRuntimeConfig {
  return mergeRuntimeConfig(
    {
      ...DEFAULT_EXECUTION_CONFIG,
      autoScroll: runtimeOptions.clickAutoScroll,
    },
    next,
  )
}

// ---------------------------------------------------------------------------
// Read utilities
// ---------------------------------------------------------------------------

export function isVisibleForRead(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return false
  if (el.getAttribute('aria-hidden') === 'true') return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none') return false
  if (style.visibility === 'hidden') return false
  if (style.opacity === '0') return false
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false
  return true
}

export function domToMarkdown(root: Element): string {
  const parts: string[] = []
  walkNode(root, parts, 0)
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim()
}

export function walkNode(node: Node, parts: string[], listDepth: number): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.replace(/\s+/g, ' ') ?? ''
    if (text.trim()) parts.push(text)
    return
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return
  const el = node as Element
  if (!isVisibleForRead(el)) return

  const tag = el.tagName

  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag[1])
    const text = el.textContent?.trim() ?? ''
    if (text) parts.push(`\n\n${'#'.repeat(level)} ${text}\n\n`)
    return
  }

  if (tag === 'P') {
    parts.push('\n\n')
    Array.from(el.childNodes).forEach(child => walkNode(child, parts, listDepth))
    parts.push('\n\n')
    return
  }

  if (tag === 'UL' || tag === 'OL') {
    parts.push('\n')
    let index = 1
    Array.from(el.children).forEach(child => {
      if (child.tagName === 'LI') {
        const indent = '  '.repeat(listDepth)
        const bullet = tag === 'UL' ? '- ' : `${index++}. `
        parts.push(`${indent}${bullet}`)
        Array.from(child.childNodes).forEach(liChild => walkNode(liChild, parts, listDepth + 1))
        parts.push('\n')
      }
    })
    parts.push('\n')
    return
  }

  if (tag === 'TABLE') {
    const rows = el.querySelectorAll('tr')
    rows.forEach((row, rowIndex) => {
      const cells = row.querySelectorAll('th, td')
      const cellTexts = Array.from(cells).map(c => c.textContent?.trim() ?? '')
      parts.push(`| ${cellTexts.join(' | ')} |\n`)
      if (rowIndex === 0) {
        parts.push(`| ${cellTexts.map(() => '---').join(' | ')} |\n`)
      }
    })
    parts.push('\n')
    return
  }

  if (tag === 'A') {
    const href = (el as HTMLAnchorElement).href
    const text = el.textContent?.trim() ?? ''
    if (text) parts.push(`[${text}](${href})`)
    return
  }

  if (tag === 'IMG') {
    const alt = el.getAttribute('alt') ?? ''
    const src = (el as HTMLImageElement).src
    parts.push(`![${alt}](${src})`)
    return
  }

  if (tag === 'STRONG' || tag === 'B') {
    parts.push('**')
    Array.from(el.childNodes).forEach(child => walkNode(child, parts, listDepth))
    parts.push('**')
    return
  }
  if (tag === 'EM' || tag === 'I') {
    parts.push('*')
    Array.from(el.childNodes).forEach(child => walkNode(child, parts, listDepth))
    parts.push('*')
    return
  }

  if (tag === 'CODE') {
    const parent = el.parentElement
    if (parent?.tagName === 'PRE') {
      parts.push(`\n\n\`\`\`\n${el.textContent ?? ''}\n\`\`\`\n\n`)
      return
    }
    parts.push(`\`${el.textContent?.trim() ?? ''}\``)
    return
  }
  if (tag === 'PRE') {
    const codeChild = el.querySelector('code')
    if (codeChild) {
      walkNode(codeChild, parts, listDepth)
      return
    }
    parts.push(`\n\n\`\`\`\n${el.textContent ?? ''}\n\`\`\`\n\n`)
    return
  }

  if (tag === 'INPUT') {
    const input = el as HTMLInputElement
    parts.push(`[input: ${input.value || input.placeholder || ''}]`)
    return
  }
  if (tag === 'SELECT') {
    const select = el as HTMLSelectElement
    const selected = select.options[select.selectedIndex]
    parts.push(`[select: ${selected?.text ?? ''}]`)
    return
  }
  if (tag === 'TEXTAREA') {
    const textarea = el as HTMLTextAreaElement
    parts.push(`[textarea: ${textarea.value || textarea.placeholder || ''}]`)
    return
  }

  if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'MAIN' || tag === 'HEADER' || tag === 'FOOTER' || tag === 'NAV' || tag === 'ASIDE') {
    parts.push('\n')
    Array.from(el.childNodes).forEach(child => walkNode(child, parts, listDepth))
    parts.push('\n')
    return
  }

  if (tag === 'BR') {
    parts.push('\n')
    return
  }

  if (tag === 'HR') {
    parts.push('\n\n---\n\n')
    return
  }

  Array.from(el.childNodes).forEach(child => walkNode(child, parts, listDepth))
}

// ---------------------------------------------------------------------------
// Fill utility
// ---------------------------------------------------------------------------

export function setElementValue(
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

// ---------------------------------------------------------------------------
// Runtime dependency bag — passed from createPageAgentRuntime to handlers
// ---------------------------------------------------------------------------

export interface CommandHandlerDeps {
  captureSnapshot: () => PageSnapshot
  captureSettledSnapshot: (minimumFrames: number) => Promise<PageSnapshot>
  getDescriptors: () => TargetDescriptor[]
  resolveExecutionConfig: (patch?: Partial<AgagruneRuntimeConfig>) => AgagruneRuntimeConfig
  queue: ActionQueue
  eventSequences: EventSequences
}

// ---------------------------------------------------------------------------
// withDescriptor — shared target resolution helper
// ---------------------------------------------------------------------------

export async function withDescriptor(
  deps: CommandHandlerDeps,
  commandId: string,
  targetId: string,
  expectedVersion: number | undefined,
  effect: (
    descriptor: TargetDescriptor,
    element: HTMLElement,
    snapshot: PageSnapshot,
  ) => Promise<CommandResult>,
): Promise<CommandResult> {
  const currentSnapshot = deps.captureSnapshot()
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

  const resolvedTarget = resolveRuntimeTarget(deps.getDescriptors(), targetId)
  if (!resolvedTarget) {
    return buildErrorResult(commandId, 'TARGET_NOT_FOUND', `target not found: ${targetId}`, currentSnapshot, targetId)
  }

  return effect(resolvedTarget.descriptor, resolvedTarget.element, currentSnapshot)
}

// ---------------------------------------------------------------------------
// wait handler
// ---------------------------------------------------------------------------

export async function handleWait(
  deps: CommandHandlerDeps,
  input: {
    commandId?: string
    targetId: string
    state: WaitState
    timeoutMs?: number
  },
): Promise<CommandResult> {
  const timeoutMs =
    typeof input.timeoutMs === 'number' && input.timeoutMs > 0 ? input.timeoutMs : 5_000
  const startedAt = Date.now()
  const { baseTargetId } = parseRuntimeTargetId(input.targetId)
  const descriptor = deps.getDescriptors().find(entry => entry.target.targetId === baseTargetId)

  if (!descriptor) {
    const snapshot = deps.captureSnapshot()
    return buildErrorResult(
      input.commandId ?? input.targetId,
      'TARGET_NOT_FOUND',
      `target not found: ${input.targetId}`,
      snapshot,
      input.targetId,
    )
  }

  for (;;) {
    const snapshot = deps.captureSnapshot()
    const resolvedTarget = resolveRuntimeTarget(deps.getDescriptors(), input.targetId)
    if (!resolvedTarget) {
      return buildErrorResult(
        input.commandId ?? input.targetId,
        'TARGET_NOT_FOUND',
        `target not found: ${input.targetId}`,
        snapshot,
        input.targetId,
      )
    }
    const target = captureTarget(descriptor, resolvedTarget.element, resolvedTarget.targetId)

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
}

// ---------------------------------------------------------------------------
// read handler
// ---------------------------------------------------------------------------

export async function handleRead(
  deps: CommandHandlerDeps,
  input: {
    commandId?: string
    selector?: string
    expectedVersion?: number
  },
): Promise<CommandResult> {
  const root = input.selector
    ? document.querySelector(input.selector)
    : document.body

  if (!root) {
    const snapshot = deps.captureSnapshot()
    return buildErrorResult(
      input.commandId ?? 'read',
      'TARGET_NOT_FOUND',
      `selector not found: ${input.selector}`,
      snapshot,
    )
  }

  await deps.captureSettledSnapshot(1)
  const fullMarkdown = domToMarkdown(root)
  const truncated = fullMarkdown.length > MAX_READ_CHARS
  const markdown = truncated
    ? fullMarkdown.slice(0, MAX_READ_CHARS) + '\n\n[truncated — use selector to read specific sections]'
    : fullMarkdown

  const snapshot = deps.captureSnapshot()
  return buildSuccessResult(input.commandId ?? 'read', snapshot, {
    markdown,
    truncated,
    charCount: fullMarkdown.length,
  })
}

// ---------------------------------------------------------------------------
// fill handler
// ---------------------------------------------------------------------------

export async function handleFill(
  deps: CommandHandlerDeps,
  input: {
    commandId?: string
    targetId: string
    value: string
    expectedVersion?: number
    config?: Partial<AgagruneRuntimeConfig>
  },
): Promise<CommandResult> {
  return withDescriptor(deps, input.commandId ?? input.targetId, input.targetId, input.expectedVersion, async (descriptor, element, snapshot) => {
    const snapshotTarget = findSnapshotTarget(snapshot, input.targetId)
    if (snapshotTarget && isOverlayFlowLocked(snapshot) && !snapshotTarget.overlay) {
      return buildFlowBlockedResult(input.commandId ?? input.targetId, snapshot, input.targetId)
    }

    if (!descriptor.actionKinds.includes('fill')) {
      return buildErrorResult(input.commandId ?? input.targetId, 'INVALID_TARGET', `target does not support fill: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }
    if (!isFillableElement(element)) {
      return buildErrorResult(input.commandId ?? input.targetId, 'INVALID_TARGET', `target is not fillable: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }
    if (!isVisible(element)) {
      return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is not visible: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }

    const config = deps.resolveExecutionConfig(input.config)
    await smoothScrollIntoView(element)

    if (!isElementInViewport(element)) {
      return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is outside of viewport: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }
    if (!isTopmostInteractable(element)) {
      return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is covered by another element: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }
    if (!isEnabled(element)) {
      return buildErrorResult(input.commandId ?? input.targetId, 'DISABLED', `target is disabled: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }

    if (config.clickDelayMs > 0) {
      await sleep(config.clickDelayMs)
    }

    if (config.pointerAnimation) {
      await deps.queue.push({
        type: 'animation',
        execute: () => flashPointerOverlay(element, config, () => setElementValue(element, input.value)),
      })
    } else {
      setElementValue(element, input.value)
    }
    const nextSnapshot = await deps.captureSettledSnapshot(2)
    return buildSuccessResult(input.commandId ?? input.targetId, nextSnapshot, {
      actionKind: 'fill',
      targetId: input.targetId,
      value: input.value,
    })
  })
}

// ---------------------------------------------------------------------------
// CDP cursor-animated click orchestration
//
// Animates cursor to the target, then at the "press" moment fires a CDP
// event sequence.
// ---------------------------------------------------------------------------

async function animateCursorThenCdpAction(
  element: HTMLElement,
  cursorName: string,
  durationMs: number,
  cdpAction: (coords: Coords) => Promise<void>,
): Promise<void> {
  const animationDurationMs = resolvePointerDurationMs(durationMs)
  const meta = getCursorMeta(cursorName)
  const state = getOrCreateCursorElement(cursorName)
  const el = state.element

  const interactablePoint = getInteractablePoint(element)
  const { x: endX, y: endY } = getCursorTranslatePosition(interactablePoint, meta)
  const { x: startX, y: startY } = getCursorStartPosition(state)

  el.style.display = 'block'
  setCursorTransform(el, startX, startY)

  // Animate cursor travel to target
  await animateWithRAF(animationDurationMs, raw => {
    const t = easeOutCubic(raw)
    const cx = startX + (endX - startX) * t
    const cy = startY + (endY - startY) * t
    setCursorTransform(el, cx, cy)
  })

  // Press down: cursor shrinks
  el.style.transition = `transform ${CURSOR_CLICK_PRESS_MS}ms ease-in`
  setCursorTransform(el, endX, endY, 0.85)
  await waitForCursorTransition(el)

  // Cursor fully pressed — fire ripple + CDP event at the impact moment
  triggerCursorClick(el)
  await cdpAction(toCoords(interactablePoint))

  // Release
  setCursorTransform(el, endX, endY, 1)
  await waitForCursorTransition(el)
  el.style.transition = ''

  saveCursorPosition(state, endX, endY)
}

// ---------------------------------------------------------------------------
// CDP cursor-animated drag orchestration
// ---------------------------------------------------------------------------

function interpolateDragSteps(
  src: PointerCoords,
  dst: PointerCoords,
  steps: number,
): Coords[] {
  const result: Coords[] = []
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps
    result.push({
      x: src.clientX + (dst.clientX - src.clientX) * progress,
      y: src.clientY + (dst.clientY - src.clientY) * progress,
    })
  }
  return result
}

async function animateCursorDragWithCdp(
  sourceElement: HTMLElement,
  srcCoords: PointerCoords,
  dstCoords: PointerCoords,
  cursorName: string,
  durationMs: number,
  eventSeq: EventSequences,
): Promise<void> {
  const animationDurationMs = resolvePointerDurationMs(durationMs)
  const meta = getCursorMeta(cursorName)
  const state = getOrCreateCursorElement(cursorName)
  const el = state.element

  const { x: srcX, y: srcY } = getCursorTranslatePosition(srcCoords, meta)
  const { x: dstX, y: dstY } = getCursorTranslatePosition(dstCoords, meta)
  const { x: startX, y: startY } = getCursorStartPosition(state)

  el.style.display = 'block'
  setCursorTransform(el, startX, startY)

  // Phase 1: Animate cursor to source position
  await animateWithRAF(animationDurationMs, raw => {
    const t = easeOutCubic(raw)
    const cx = startX + (srcX - startX) * t
    const cy = startY + (srcY - startY) * t
    setCursorTransform(el, cx, cy)
  })

  // Press down
  applyCursorPressStyle(el)
  setCursorTransform(el, srcX, srcY, 0.85)
  await waitForCursorTransition(el)

  // CDP mouse press
  await eventSeq.mousePressed(toCoords(srcCoords))

  // Phase 2: Animate drag movement with interleaved CDP mouseMoved
  el.style.transition = ''
  const steps = interpolateDragSteps(srcCoords, dstCoords, DRAG_MOVE_STEPS)
  for (const step of steps) {
    const { x: cx, y: cy } = getCursorTranslatePosition(
      { clientX: step.x, clientY: step.y },
      meta,
    )
    setCursorTransform(el, cx, cy, 0.85)
    await eventSeq.mouseMoved(step)
    await raf()
  }

  // CDP mouse release
  await eventSeq.mouseReleased(toCoords(dstCoords))

  // Release cursor visual
  el.style.transition = `transform ${CURSOR_CLICK_PRESS_MS}ms ease-out`
  setCursorTransform(el, dstX, dstY, 1)
  await waitForCursorTransition(el)
  removeCursorPressStyle(el)

  saveCursorPosition(state, dstX, dstY)
}

async function animateCursorHtmlDragWithCdp(
  srcCoords: PointerCoords,
  dstCoords: PointerCoords,
  cursorName: string,
  durationMs: number,
  eventSeq: EventSequences,
): Promise<void> {
  const animationDurationMs = resolvePointerDurationMs(durationMs)
  const meta = getCursorMeta(cursorName)
  const state = getOrCreateCursorElement(cursorName)
  const el = state.element

  const { x: srcX, y: srcY } = getCursorTranslatePosition(srcCoords, meta)
  const { x: dstX, y: dstY } = getCursorTranslatePosition(dstCoords, meta)
  const { x: startX, y: startY } = getCursorStartPosition(state)

  el.style.display = 'block'
  setCursorTransform(el, startX, startY)

  // Phase 1: Animate cursor to source position
  await animateWithRAF(animationDurationMs, raw => {
    const t = easeOutCubic(raw)
    const cx = startX + (srcX - startX) * t
    const cy = startY + (srcY - startY) * t
    setCursorTransform(el, cx, cy)
  })

  // Press down
  applyCursorPressStyle(el)
  setCursorTransform(el, srcX, srcY, 0.85)
  await waitForCursorTransition(el)

  // CDP htmlDrag does all the event work
  await eventSeq.htmlDrag(toCoords(srcCoords), toCoords(dstCoords))

  // Phase 2: Animate cursor to destination (visual only — CDP drag is done)
  el.style.transition = ''
  await animateWithRAF(animationDurationMs, raw => {
    const t = raw
    const cx = srcX + (dstX - srcX) * t
    const cy = srcY + (dstY - srcY) * t
    setCursorTransform(el, cx, cy, 0.85)
  })

  // Release cursor visual
  el.style.transition = `transform ${CURSOR_CLICK_PRESS_MS}ms ease-out`
  setCursorTransform(el, dstX, dstY, 1)
  await waitForCursorTransition(el)
  removeCursorPressStyle(el)

  saveCursorPosition(state, dstX, dstY)
}

// ---------------------------------------------------------------------------
// act handler
// ---------------------------------------------------------------------------

export async function handleAct(
  deps: CommandHandlerDeps,
  input: {
    commandId?: string
    targetId: string
    action?: 'click' | 'dblclick' | 'contextmenu' | 'hover' | 'longpress'
    expectedVersion?: number
    config?: Partial<AgagruneRuntimeConfig>
  },
): Promise<CommandResult> {
  return withDescriptor(deps, input.commandId ?? input.targetId, input.targetId, input.expectedVersion, async (descriptor, element, snapshot) => {
    const snapshotTarget = findSnapshotTarget(snapshot, input.targetId)
    if (snapshotTarget && isOverlayFlowLocked(snapshot) && !snapshotTarget.overlay) {
      return buildFlowBlockedResult(input.commandId ?? input.targetId, snapshot, input.targetId)
    }

    if (!descriptor.actionKinds.some(k => ACT_COMPATIBLE_KINDS.has(k))) {
      return buildErrorResult(input.commandId ?? input.targetId, 'INVALID_TARGET', `target does not support act: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }

    const action = input.action ?? 'click'

    if (!descriptor.actionKinds.includes(action as ActionKind)) {
      return buildErrorResult(input.commandId ?? input.targetId, 'INVALID_TARGET', `target does not support action "${action}": ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }

    if (!isVisible(element)) {
      return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is not visible: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }

    const config = deps.resolveExecutionConfig(input.config)
    await smoothScrollIntoView(element)

    if (!isElementInViewport(element)) {
      return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is outside of viewport: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }
    if (!isTopmostInteractable(element)) {
      return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is covered by another element: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }
    if (!isEnabled(element)) {
      return buildErrorResult(input.commandId ?? input.targetId, 'DISABLED', `target is disabled: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }

    if (config.clickDelayMs > 0) {
      await sleep(config.clickDelayMs)
    }

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

    const nextSnapshot = await deps.captureSettledSnapshot(2)
    return buildSuccessResult(input.commandId ?? input.targetId, nextSnapshot, {
      actionKind: action,
      targetId: input.targetId,
    })
  })
}

// ---------------------------------------------------------------------------
// drag handler
// ---------------------------------------------------------------------------

export async function handleDrag(
  deps: CommandHandlerDeps,
  input: {
    commandId?: string
    sourceTargetId: string
    destinationTargetId?: string
    destinationCoords?: { x: number; y: number }
    placement?: DragPlacement
    expectedVersion?: number
    config?: Partial<AgagruneRuntimeConfig>
  },
): Promise<CommandResult> {
  return withDescriptor(
    deps,
    input.commandId ?? input.sourceTargetId,
    input.sourceTargetId,
    input.expectedVersion,
    async (sourceDescriptor, sourceElement, snapshot) => {
      const sourceSnapshotTarget = findSnapshotTarget(snapshot, input.sourceTargetId)

      const hasTargetId = input.destinationTargetId != null
      const hasCoords = input.destinationCoords != null

      if (hasTargetId === hasCoords) {
        return buildErrorResult(
          input.commandId ?? input.sourceTargetId,
          'INVALID_COMMAND',
          hasTargetId
            ? 'Cannot specify both destinationTargetId and destinationCoords'
            : 'Must specify either destinationTargetId or destinationCoords',
          snapshot,
          input.sourceTargetId,
        )
      }

      if (hasTargetId && input.sourceTargetId === input.destinationTargetId) {
        return buildErrorResult(
          input.commandId ?? input.sourceTargetId,
          'INVALID_COMMAND',
          'sourceTargetId and destinationTargetId must be different',
          snapshot,
          input.sourceTargetId,
        )
      }

      if (hasCoords && input.placement != null) {
        return buildErrorResult(
          input.commandId ?? input.sourceTargetId,
          'INVALID_COMMAND',
          'placement cannot be used with destinationCoords',
          snapshot,
          input.sourceTargetId,
        )
      }

      if (
        isOverlayFlowLocked(snapshot) &&
        !sourceSnapshotTarget?.overlay
      ) {
        return buildFlowBlockedResult(
          input.commandId ?? input.sourceTargetId,
          snapshot,
          input.sourceTargetId,
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

      const config = deps.resolveExecutionConfig(input.config)
      await smoothScrollIntoView(sourceElement)

      if (!isElementInViewport(sourceElement)) {
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

      // --- Branch: coordinate-based drag ---
      if (hasCoords) {
        const srcCoords = getElementCenter(sourceElement)
        const destCoords: PointerCoords = {
          clientX: input.destinationCoords!.x,
          clientY: input.destinationCoords!.y,
        }

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

        const nextSnapshot = await deps.captureSettledSnapshot(2)
        return buildSuccessResult(input.commandId ?? input.sourceTargetId, nextSnapshot, {
          actionKind: 'drag',
          sourceTargetId: input.sourceTargetId,
          destinationCoords: input.destinationCoords,
        })
      }

      // --- Branch: target-based drag ---
      const destinationTarget = resolveRuntimeTarget(deps.getDescriptors(), input.destinationTargetId!)
      if (!destinationTarget) {
        return buildErrorResult(
          input.commandId ?? input.sourceTargetId,
          'TARGET_NOT_FOUND',
          `target not found: ${input.destinationTargetId}`,
          snapshot,
          input.destinationTargetId!,
        )
      }

      const destinationDescriptor = destinationTarget.descriptor
      const destinationElement = destinationTarget.element
      const destinationSnapshotTarget = findSnapshotTarget(snapshot, input.destinationTargetId!)

      if (
        isOverlayFlowLocked(snapshot) &&
        !destinationSnapshotTarget?.overlay
      ) {
        return buildFlowBlockedResult(
          input.commandId ?? input.sourceTargetId,
          snapshot,
          input.destinationTargetId!,
        )
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
      if (!isElementInViewport(destinationElement)) {
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

      {
        const srcCoords = getElementCenter(sourceElement)
        const dstCoords = getDragPlacementCoords(destinationElement, placement)
        const isHtmlDrag = sourceElement.draggable

        if (config.pointerAnimation) {
          await deps.queue.push({
            type: 'animation',
            execute: () =>
              isHtmlDrag
                ? animateCursorHtmlDragWithCdp(
                    srcCoords,
                    dstCoords,
                    config.cursorName ?? DEFAULT_CURSOR_NAME,
                    config.pointerDurationMs,
                    deps.eventSequences,
                  )
                : animateCursorDragWithCdp(
                    sourceElement,
                    srcCoords,
                    dstCoords,
                    config.cursorName ?? DEFAULT_CURSOR_NAME,
                    config.pointerDurationMs,
                    deps.eventSequences,
                  ),
          })
        } else if (isHtmlDrag) {
          await deps.eventSequences.htmlDrag(toCoords(srcCoords), toCoords(dstCoords))
        } else {
          const steps = interpolateDragSteps(srcCoords, dstCoords, DRAG_MOVE_STEPS)
          await deps.eventSequences.pointerDrag(toCoords(srcCoords), toCoords(dstCoords), steps)
        }
      }

      const nextSnapshot = await deps.captureSettledSnapshot(2)
      return buildSuccessResult(input.commandId ?? input.sourceTargetId, nextSnapshot, {
        actionKind: 'drag',
        destinationTargetId: input.destinationTargetId,
        placement,
        sourceTargetId: input.sourceTargetId,
      })
    },
  )
}

// ---------------------------------------------------------------------------
// pointer handler
// ---------------------------------------------------------------------------

export async function handlePointer(
  deps: CommandHandlerDeps,
  input: {
    commandId?: string
    targetId?: string
    selector?: string
    coords?: { x: number; y: number }
    actions: Array<
      | { type: 'pointerdown'; x: number; y: number; delayMs?: number }
      | { type: 'pointermove'; x: number; y: number; delayMs?: number }
      | { type: 'pointerup'; x: number; y: number; delayMs?: number }
      | { type: 'wheel'; x: number; y: number; deltaY: number; ctrlKey?: boolean; delayMs?: number }
    >
  },
): Promise<CommandResult> {
  const commandId = input.commandId ?? 'pointer'

  let element: HTMLElement | null = null

  if (input.targetId) {
    const target = resolveRuntimeTarget(deps.getDescriptors(), input.targetId)
    if (!target) {
      const snapshot = await deps.captureSettledSnapshot(0)
      return buildErrorResult(commandId, 'TARGET_NOT_FOUND', `target not found: ${input.targetId}`, snapshot, input.targetId)
    }
    element = target.element
  } else if (input.selector) {
    element = document.querySelector<HTMLElement>(input.selector)
    if (!element) {
      const snapshot = await deps.captureSettledSnapshot(0)
      return buildErrorResult(commandId, 'TARGET_NOT_FOUND', `element not found for selector: ${input.selector}`, snapshot)
    }
  } else if (input.coords) {
    element = document.elementFromPoint(input.coords.x, input.coords.y) as HTMLElement | null
    if (!element) {
      const snapshot = await deps.captureSettledSnapshot(0)
      return buildErrorResult(commandId, 'TARGET_NOT_FOUND', `no element at coordinates (${input.coords.x}, ${input.coords.y})`, snapshot)
    }
  } else {
    const snapshot = await deps.captureSettledSnapshot(0)
    return buildErrorResult(commandId, 'INVALID_COMMAND', 'Must specify targetId, selector, or coords', snapshot)
  }

  if (!input.actions || input.actions.length === 0) {
    const snapshot = await deps.captureSettledSnapshot(0)
    return buildErrorResult(commandId, 'INVALID_COMMAND', 'actions array must not be empty', snapshot)
  }

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
    if (action.delayMs != null && action.delayMs > 0) {
      await new Promise(r => setTimeout(r, action.delayMs))
    }
  }

  const nextSnapshot = await deps.captureSettledSnapshot(2)
  return buildSuccessResult(commandId, nextSnapshot, {
    actionKind: 'pointer',
    actionsCount: input.actions.length,
  })
}

// ---------------------------------------------------------------------------
// guide handler
// ---------------------------------------------------------------------------

export async function handleGuide(
  deps: CommandHandlerDeps,
  input: {
    commandId?: string
    targetId: string
    expectedVersion?: number
    config?: Partial<AgagruneRuntimeConfig>
  },
): Promise<CommandResult> {
  return withDescriptor(deps, input.commandId ?? input.targetId, input.targetId, input.expectedVersion, async (descriptor, element, snapshot) => {
    const snapshotTarget = findSnapshotTarget(snapshot, input.targetId)
    if (snapshotTarget && isOverlayFlowLocked(snapshot) && !snapshotTarget.overlay) {
      return buildFlowBlockedResult(input.commandId ?? input.targetId, snapshot, input.targetId)
    }

    if (!descriptor.actionKinds.some(k => ACT_COMPATIBLE_KINDS.has(k))) {
      return buildErrorResult(input.commandId ?? input.targetId, 'INVALID_TARGET', `target does not support guide: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }

    if (!isVisible(element)) {
      return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is not visible: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }

    // Always auto-scroll for guide mode
    await smoothScrollIntoView(element)

    if (!isElementInViewport(element)) {
      return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is outside of viewport: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }
    if (!isTopmostInteractable(element)) {
      return buildErrorResult(input.commandId ?? input.targetId, 'NOT_VISIBLE', `target is covered by another element: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }
    if (!isEnabled(element)) {
      return buildErrorResult(input.commandId ?? input.targetId, 'DISABLED', `target is disabled: ${descriptor.target.targetId}`, snapshot, descriptor.target.targetId)
    }

    // Always perform cursor animation in guide mode (ignore config.pointerAnimation)
    const guideConfig = deps.resolveExecutionConfig(input.config)

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

    const nextSnapshot = deps.captureSnapshot()
    return buildSuccessResult(input.commandId ?? input.targetId, nextSnapshot, {
      actionKind: 'guide',
      targetId: input.targetId,
    })
  })
}
