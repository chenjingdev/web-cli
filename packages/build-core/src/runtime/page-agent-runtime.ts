import {
  createCommandError,
  type AuroraTheme,
  type CommandResult,
  type DragPlacement,
  type PageSnapshot,
  type PageTarget,
  type PageTargetReason,
  type AgagruneRuntimeConfig,
  mergeRuntimeConfig,
} from '@agrune/core'
import { ActionQueue } from './action-queue'
import { getCursorMeta, DEFAULT_CURSOR_NAME, POINTER_FILL_SVG, POINTER_BORDER_MASK_SVG } from './cursors/index'
import { Motion } from 'ai-motion'
import type {
  AgagruneManifest,
  AgagruneRuntimeOptions,
  AgagruneTargetEntry,
} from '../types'
import {
  type PointerCoords,
  buildLiveSelector,
  getElementCenter,
  getDragPlacementCoords,
  getEventTargetAtPoint,
  getInteractablePoint,
  isElementInViewport,
  isEnabled,
  isFillableElement,
  isOverlayElement,
  isRelevantSnapshotMutation,
  isSensitive,
  isTopmostInteractable,
  isVisible,
  smoothScrollIntoView,
  waitForNextFrame,
} from './dom-utils'

const DEFAULT_OPTIONS: AgagruneRuntimeOptions = {
  clickAutoScroll: true,
  clickRetryCount: 2,
  clickRetryDelayMs: 120,
}

const DEFAULT_EXECUTION_CONFIG: AgagruneRuntimeConfig = {
  autoScroll: true,
  clickDelayMs: 0,
  pointerDurationMs: 600,
  pointerAnimation: false,
  cursorName: DEFAULT_CURSOR_NAME,
  auroraGlow: true,
  auroraTheme: 'dark',
}

type ActionKind = 'click' | 'fill' | 'dblclick' | 'contextmenu' | 'hover' | 'longpress'
type WaitState = 'visible' | 'hidden' | 'enabled' | 'disabled'

const VALID_ACTIONS = new Set(['click', 'fill', 'dblclick', 'contextmenu', 'hover', 'longpress'])
const ACT_COMPATIBLE_KINDS = new Set(['click', 'dblclick', 'contextmenu', 'hover', 'longpress'])
const MAX_READ_CHARS = 50_000
const LIVE_SCAN_ACTION_SELECTOR = '[data-agrune-action]'
const LIVE_SCAN_GROUP_SELECTOR = '[data-agrune-group]'
const LIVE_SCAN_DEFAULT_GROUP_ID = 'default'
const LIVE_SCAN_DEFAULT_GROUP_NAME = 'Default'
const DOM_SETTLE_TIMEOUT_MS = 320
const DOM_SETTLE_QUIET_WINDOW_MS = 48
const DOM_SETTLE_STABLE_FRAMES = 2
const SNAPSHOT_RELEVANT_ATTRIBUTES = [
  'aria-modal',
  'class',
  'data-agrune-action',
  'data-agrune-desc',
  'data-agrune-group',
  'data-agrune-group-desc',
  'data-agrune-group-name',
  'data-agrune-key',
  'data-agrune-name',
  'disabled',
  'hidden',
  'role',
  'style',
]

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG',
])

function isVisibleForRead(el: Element): boolean {
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

function domToMarkdown(root: Element): string {
  const parts: string[] = []
  walkNode(root, parts, 0)
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim()
}

function walkNode(node: Node, parts: string[], listDepth: number): void {
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

interface TargetDescriptor {
  actionKinds: ActionKind[]
  groupId: string
  groupName?: string
  groupDesc?: string
  target: AgagruneTargetEntry
}

interface RuntimeTargetMatch {
  descriptor: TargetDescriptor
  element: HTMLElement
  targetId: string
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


function collectDescriptors(manifest: AgagruneManifest): TargetDescriptor[] {
  const result: TargetDescriptor[] = []

  for (const group of manifest.groups) {
    for (const tool of group.tools) {
      if (tool.status !== 'active') continue
      const actionKinds = [...new Set(
        tool.action.split(',').map(a => a.trim()).filter(a => VALID_ACTIONS.has(a))
      )] as ActionKind[]
      if (actionKinds.length === 0) continue
      for (const target of tool.targets) {
        result.push({
          actionKinds,
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

function collectLiveDescriptors(): TargetDescriptor[] {
  const result: TargetDescriptor[] = []
  const elements = document.querySelectorAll<HTMLElement>(LIVE_SCAN_ACTION_SELECTOR)

  elements.forEach((element, index) => {
    const rawAction = element.getAttribute('data-agrune-action') ?? ''
    const actionKinds = [...new Set(
      rawAction.split(',').map(a => a.trim()).filter(a => VALID_ACTIONS.has(a))
    )] as ActionKind[]
    if (actionKinds.length === 0) return

    const key = element.getAttribute('data-agrune-key')?.trim()
    const groupEl = element.closest<HTMLElement>(LIVE_SCAN_GROUP_SELECTOR)
    const groupId = groupEl?.getAttribute('data-agrune-group')?.trim() || LIVE_SCAN_DEFAULT_GROUP_ID

    result.push({
      actionKinds,
      groupId,
      groupName: groupEl?.getAttribute('data-agrune-group-name') || (
        groupId === LIVE_SCAN_DEFAULT_GROUP_ID ? LIVE_SCAN_DEFAULT_GROUP_NAME : groupId
      ),
      groupDesc: groupEl?.getAttribute('data-agrune-group-desc') || undefined,
      target: {
        targetId: key || `agrune_${index}`,
        name: element.getAttribute('data-agrune-name'),
        desc: element.getAttribute('data-agrune-desc'),
        selector: buildLiveSelector(element),
        sourceFile: '',
        sourceLine: 0,
        sourceColumn: 0,
      },
    })
  })

  return result.sort((left, right) => left.target.targetId.localeCompare(right.target.targetId))
}

function mergeDescriptors(
  manifestDescriptors: TargetDescriptor[],
  liveDescriptors: TargetDescriptor[],
): TargetDescriptor[] {
  if (liveDescriptors.length === 0) {
    return manifestDescriptors
  }

  const merged = new Map(
    manifestDescriptors.map(descriptor => [descriptor.target.targetId, descriptor] as const),
  )
  let changed = false

  for (const descriptor of liveDescriptors) {
    const existing = merged.get(descriptor.target.targetId)
    if (!existing) {
      merged.set(descriptor.target.targetId, descriptor)
      changed = true
      continue
    }

    merged.set(descriptor.target.targetId, {
      actionKinds: descriptor.actionKinds,
      groupId: descriptor.groupId,
      groupName: descriptor.groupName,
      groupDesc: descriptor.groupDesc,
      target: {
        ...existing.target,
        name: descriptor.target.name ?? existing.target.name,
        desc: descriptor.target.desc ?? existing.target.desc,
        selector: descriptor.target.selector,
      },
    })
    changed = true
  }

  if (!changed) {
    return manifestDescriptors
  }

  return Array.from(merged.values())
    .sort((left, right) => left.target.targetId.localeCompare(right.target.targetId))
}

const REPEATED_TARGET_ID_DELIMITER = '__agrune_idx_'

function findElements(descriptor: TargetDescriptor): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(descriptor.target.selector))
}

function toRuntimeTargetId(baseTargetId: string, index: number, total: number): string {
  if (total <= 1) {
    return baseTargetId
  }
  return `${baseTargetId}${REPEATED_TARGET_ID_DELIMITER}${index}`
}

function parseRuntimeTargetId(targetId: string): {
  baseTargetId: string
  index: number
  hasExplicitIndex: boolean
} {
  const markerIndex = targetId.lastIndexOf(REPEATED_TARGET_ID_DELIMITER)
  if (markerIndex < 0) {
    return {
      baseTargetId: targetId,
      index: 0,
      hasExplicitIndex: false,
    }
  }

  const baseTargetId = targetId.slice(0, markerIndex)
  const indexText = targetId.slice(markerIndex + REPEATED_TARGET_ID_DELIMITER.length)
  const index = Number(indexText)
  if (!baseTargetId || !Number.isInteger(index) || index < 0) {
    return {
      baseTargetId: targetId,
      index: 0,
      hasExplicitIndex: false,
    }
  }

  return {
    baseTargetId,
    index,
    hasExplicitIndex: true,
  }
}

function resolveRuntimeTarget(
  descriptors: TargetDescriptor[],
  requestedTargetId: string,
): RuntimeTargetMatch | null {
  const { baseTargetId, index } = parseRuntimeTargetId(requestedTargetId)
  const descriptor = descriptors.find(entry => entry.target.targetId === baseTargetId)
  if (!descriptor) {
    return null
  }

  const elements = findElements(descriptor)
  const element = elements[index]
  if (!element) {
    return null
  }

  return {
    descriptor,
    element,
    targetId: toRuntimeTargetId(baseTargetId, index, elements.length),
  }
}

function normalizeExecutionConfig(
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

function resolveTargetReason(input: {
  actionKinds: ActionKind[]
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
  if (input.actionKinds.includes('fill') && input.sensitive) {
    return 'sensitive'
  }
  return 'ready'
}

function captureTargetState(actionKinds: ActionKind[], element: HTMLElement): TargetState {
  const sensitive = isSensitive(element)
  const visible = isVisible(element)
  const inViewport = visible && isElementInViewport(element)
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
      actionKinds,
      visible,
      inViewport,
      enabled,
      covered,
      sensitive,
    }),
  }
}

function captureTarget(
  descriptor: TargetDescriptor,
  element: HTMLElement,
  targetId: string,
): PageTarget {
  const state = captureTargetState(descriptor.actionKinds, element)
  const textContent = element.textContent?.trim() ?? ''
  const valuePreview =
    isFillableElement(element) && !state.sensitive ? element.value : null

  // 동적 속성(name/desc)이 null이면 DOM에서 읽는다
  const name = descriptor.target.name ?? element.getAttribute('data-agrune-name') ?? textContent
  const description = descriptor.target.desc ?? element.getAttribute('data-agrune-desc') ?? ''

  let rect: PageTarget['rect'] | undefined
  if (state.actionableNow) {
    const domRect = element.getBoundingClientRect()
    rect = {
      x: Math.round(domRect.left),
      y: Math.round(domRect.top),
      width: Math.round(domRect.width),
      height: Math.round(domRect.height),
    }
  }

  return {
    actionKinds: descriptor.actionKinds,
    description,
    enabled: state.enabled,
    groupId: descriptor.groupId,
    groupName: descriptor.groupName,
    groupDesc: descriptor.groupDesc,
    name,
    reason: state.reason,
    selector: descriptor.target.selector,
    sensitive: state.sensitive,
    targetId,
    visible: state.visible,
    inViewport: state.inViewport,
    covered: state.covered,
    actionableNow: state.actionableNow,
    overlay: state.overlay,
    textContent,
    valuePreview,
    rect,
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
    const elements = findElements(descriptor)
    return elements.map((element, index) =>
      captureTarget(
        descriptor,
        element,
        toRuntimeTargetId(descriptor.target.targetId, index, elements.length),
      ),
    )
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
      actionKinds: target.actionKinds,
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

function isRunnableSnapshotTarget(target: PageTarget): boolean {
  return target.actionableNow === true
}

function isOverlayFlowLocked(snapshot: PageSnapshot): boolean {
  return snapshot.targets.some(target => target.overlay && isRunnableSnapshotTarget(target))
}

function findSnapshotTarget(
  snapshot: PageSnapshot,
  targetId: string,
): PageTarget | undefined {
  return snapshot.targets.find(target => target.targetId === targetId)
}

function buildFlowBlockedResult(
  commandId: string,
  snapshot: PageSnapshot,
  targetId: string,
): CommandResult {
  return buildErrorResult(
    commandId,
    'FLOW_BLOCKED',
    `target is blocked by active overlay flow: ${targetId}`,
    snapshot,
    targetId,
  )
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

const CURSOR_STYLE_ID = 'agrune-cursor-style'
const CURSOR_CLICK_PRESS_MS = 100
const CURSOR_POST_ANIMATION_DELAY_MS = 200
const DRAG_POINTER_ID = 1
const DRAG_MOVE_STEPS = 12
const IDLE_TIMEOUT_MS = 5_000

function resolvePointerDurationMs(durationMs: number | undefined): number {
  return Number.isFinite(durationMs) && durationMs != null && durationMs >= 0
    ? durationMs
    : DEFAULT_EXECUTION_CONFIG.pointerDurationMs
}

interface CursorState {
  element: HTMLDivElement
  cursorName: string
  lastX: number | null
  lastY: number | null
}

let cursorState: CursorState | null = null

function hidePointerOverlay(): void {
  if (!cursorState) return
  cursorState.element.style.display = 'none'
  cursorState.element.style.transition = ''
  cursorState.element.classList.remove('clicking')
  // Preserve lastX/lastY so the cursor resumes from its last position
  // when re-activated (e.g. between consecutive agent tool calls)
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function ensureCursorStyles(): void {
  if (document.getElementById(CURSOR_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = CURSOR_STYLE_ID
  style.textContent = `
.agrune-cursor{position:fixed;top:0;left:0;width:75px;height:75px;pointer-events:none;z-index:2147483647;will-change:transform;display:none}
.agrune-cursor-filling{position:absolute;width:100%;height:100%;background-image:url("${POINTER_FILL_SVG}");background-size:100% 100%;background-repeat:no-repeat;filter:drop-shadow(3px 4px 4px rgba(0,0,0,0.4));transform-origin:center;transform:rotate(-135deg) scale(1.2);margin-left:-10px;margin-top:-18px}
.agrune-cursor-border{position:absolute;width:100%;height:100%;background:linear-gradient(45deg,rgb(57,182,255),rgb(189,69,251));-webkit-mask-image:url("${POINTER_BORDER_MASK_SVG}");mask-image:url("${POINTER_BORDER_MASK_SVG}");-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;transform-origin:center;transform:rotate(-135deg) scale(1.2);margin-left:-10px;margin-top:-18px}
.agrune-cursor-ripple{position:absolute;width:100%;height:100%;pointer-events:none;margin-left:-50%;margin-top:-50%}
.agrune-cursor-ripple::after{content:"";opacity:0;position:absolute;inset:0;border:4px solid rgba(57,182,255,1);border-radius:50%}
.agrune-cursor.clicking .agrune-cursor-ripple::after{animation:agrune-ripple 300ms ease-out forwards}
@keyframes agrune-ripple{0%{transform:scale(0);opacity:1}100%{transform:scale(2);opacity:0}}
`
  document.head.appendChild(style)
}

function createPointerCursorElement(): HTMLDivElement {
  ensureCursorStyles()
  const el = document.createElement('div')
  el.className = 'agrune-cursor'
  el.setAttribute('data-agrune-pointer', 'true')

  const ripple = document.createElement('div')
  ripple.className = 'agrune-cursor-ripple'
  const filling = document.createElement('div')
  filling.className = 'agrune-cursor-filling'
  const border = document.createElement('div')
  border.className = 'agrune-cursor-border'

  el.appendChild(ripple)
  el.appendChild(filling)
  el.appendChild(border)
  return el
}

function createSvgCursorElement(meta: import('./cursors/index').CursorMeta): HTMLDivElement {
  const el = document.createElement('div')
  el.setAttribute('data-agrune-pointer', 'true')
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

function triggerCursorClick(el: HTMLDivElement): void {
  el.classList.remove('clicking')
  void el.offsetHeight
  el.classList.add('clicking')
}

function setCursorTransform(
  el: HTMLDivElement,
  x: number,
  y: number,
  scale = 1,
): void {
  el.style.transform =
    scale === 1
      ? `translate(${x}px, ${y}px)`
      : `translate(${x}px, ${y}px) scale(${scale})`
}

async function waitForCursorTransition(el: HTMLDivElement): Promise<void> {
  await new Promise<void>(r => {
    const done = () => { el.removeEventListener('transitionend', done); r() }
    el.addEventListener('transitionend', done, { once: true })
    setTimeout(done, CURSOR_CLICK_PRESS_MS + 50)
  })
}

function applyCursorPressStyle(el: HTMLDivElement): void {
  el.style.transition = `transform ${CURSOR_CLICK_PRESS_MS}ms ease-in`
}

function removeCursorPressStyle(el: HTMLDivElement): void {
  el.style.transition = ''
}

function saveCursorPosition(state: CursorState, x: number, y: number): void {
  state.lastX = x
  state.lastY = y
}

function getCursorStartPosition(state: CursorState): { x: number; y: number } {
  if (state.lastX !== null && state.lastY !== null) {
    return {
      x: state.lastX,
      y: state.lastY,
    }
  }

  return {
    x: window.innerWidth + 20,
    y: window.innerHeight / 2,
  }
}

function getCursorTranslatePosition(
  coords: PointerCoords,
  meta: import('./cursors/index').CursorMeta,
): { x: number; y: number } {
  return {
    x: coords.clientX - meta.hotspotX,
    y: coords.clientY - meta.hotspotY,
  }
}

async function animateCursorTo(
  element: HTMLElement,
  cursorName: string,
  durationMs: number,
  onPress?: () => void,
): Promise<void> {
  const animationDurationMs = resolvePointerDurationMs(durationMs)
  const meta = getCursorMeta(cursorName)
  const state = getOrCreateCursorElement(cursorName)
  const el = state.element

  const { x: endX, y: endY } = getCursorTranslatePosition(getInteractablePoint(element), meta)
  const { x: startX, y: startY } = getCursorStartPosition(state)

  el.style.display = 'block'
  setCursorTransform(el, startX, startY)

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

  // Cursor fully pressed — fire ripple + action at the impact moment
  triggerCursorClick(el)
  onPress?.()

  // Release
  setCursorTransform(el, endX, endY, 1)
  await waitForCursorTransition(el)
  el.style.transition = ''

  state.lastX = endX
  state.lastY = endY
}

function getIdleCursorPosition(meta: import('./cursors/index').CursorMeta): { x: number; y: number } {
  return {
    x: window.innerWidth - meta.hotspotX - 32,
    y: 32 - meta.hotspotY,
  }
}

function showIdlePointerOverlay(cursorName: string): void {
  const meta = getCursorMeta(cursorName)
  const state = getOrCreateCursorElement(cursorName)
  const el = state.element
  const position =
    state.lastX != null && state.lastY != null
      ? { x: state.lastX, y: state.lastY }
      : getIdleCursorPosition(meta)

  el.style.display = 'block'
  el.style.transition = ''
  el.classList.remove('clicking')
  setCursorTransform(el, position.x, position.y)
  state.lastX = position.x
  state.lastY = position.y
}

async function animatePointerDragWithCursor(
  sourceElement: HTMLElement,
  destinationElement: HTMLElement,
  placement: DragPlacement,
  cursorName: string,
  durationMs: number,
): Promise<void> {
  const animationDurationMs = resolvePointerDurationMs(durationMs)
  const meta = getCursorMeta(cursorName)
  const state = getOrCreateCursorElement(cursorName)
  const el = state.element

  const sourceCoords = getInteractablePoint(sourceElement)
  const destinationCoords = getDragPlacementCoords(destinationElement, placement)
  const { x: sourceX, y: sourceY } = getCursorTranslatePosition(sourceCoords, meta)
  const { x: destinationX, y: destinationY } = getCursorTranslatePosition(destinationCoords, meta)
  const { x: startX, y: startY } = getCursorStartPosition(state)

  el.style.display = 'block'
  setCursorTransform(el, startX, startY)

  await animateWithRAF(animationDurationMs, raw => {
    const t = easeOutCubic(raw)
    const cx = startX + (sourceX - startX) * t
    const cy = startY + (sourceY - startY) * t
    setCursorTransform(el, cx, cy)
  })

  const pressTarget = getEventTargetAtPoint(sourceElement, sourceCoords)
  dispatchHoverTransition(null, pressTarget, sourceCoords, 0)
  dispatchPointerLikeEvent(pressTarget, 'pointermove', sourceCoords, 0, true)
  dispatchMouseLikeEvent(pressTarget, 'mousemove', sourceCoords, 0, true)
  el.style.transition = `transform ${CURSOR_CLICK_PRESS_MS}ms ease-in`
  setCursorTransform(el, sourceX, sourceY, 0.85)
  await waitForCursorTransition(el)

  dispatchPointerLikeEvent(pressTarget, 'pointerdown', sourceCoords, 1, true)
  dispatchMouseLikeEvent(pressTarget, 'mousedown', sourceCoords, 1, true)

  let previousHover = pressTarget
  el.style.transition = ''
  await animateWithRAF(animationDurationMs, raw => {
    const t = raw
    const coords = {
      clientX:
        sourceCoords.clientX +
        (destinationCoords.clientX - sourceCoords.clientX) * t,
      clientY:
        sourceCoords.clientY +
        (destinationCoords.clientY - sourceCoords.clientY) * t,
    }
    const { x, y } = getCursorTranslatePosition(coords, meta)
    setCursorTransform(el, x, y, 0.85)

    const nextHover = getEventTargetAtPoint(destinationElement, coords)
    dispatchHoverTransition(previousHover, nextHover, coords, 1)
    dispatchDragMove(sourceElement, nextHover, coords)
    previousHover = nextHover
  })

  const dropTarget = getEventTargetAtPoint(destinationElement, destinationCoords)
  dispatchHoverTransition(previousHover, dropTarget, destinationCoords, 1)
  dispatchDragRelease(sourceElement, dropTarget, destinationCoords)

  el.style.transition = `transform ${CURSOR_CLICK_PRESS_MS}ms ease-out`
  setCursorTransform(el, destinationX, destinationY, 1)
  await waitForCursorTransition(el)
  el.style.transition = ''

  state.lastX = destinationX
  state.lastY = destinationY
}

async function animatePointerDragToCoordsWithCursor(
  sourceElement: HTMLElement,
  destinationCoords: PointerCoords,
  cursorName: string,
  durationMs: number,
): Promise<void> {
  const animationDurationMs = resolvePointerDurationMs(durationMs)
  const meta = getCursorMeta(cursorName)
  const state = getOrCreateCursorElement(cursorName)
  const el = state.element

  const sourceCoords = getInteractablePoint(sourceElement)
  const { x: sourceX, y: sourceY } = getCursorTranslatePosition(sourceCoords, meta)
  const { x: destinationX, y: destinationY } = getCursorTranslatePosition(destinationCoords, meta)
  const { x: startX, y: startY } = getCursorStartPosition(state)

  el.style.display = 'block'
  setCursorTransform(el, startX, startY)

  await animateWithRAF(animationDurationMs, raw => {
    const t = easeOutCubic(raw)
    const cx = startX + (sourceX - startX) * t
    const cy = startY + (sourceY - startY) * t
    setCursorTransform(el, cx, cy)
  })

  const pressTarget = getEventTargetAtPoint(sourceElement, sourceCoords)
  dispatchHoverTransition(null, pressTarget, sourceCoords, 0)
  dispatchPointerLikeEvent(pressTarget, 'pointermove', sourceCoords, 0, true)
  dispatchMouseLikeEvent(pressTarget, 'mousemove', sourceCoords, 0, true)
  dispatchPointerLikeEvent(pressTarget, 'pointerdown', sourceCoords, 1, true)
  dispatchMouseLikeEvent(pressTarget, 'mousedown', sourceCoords, 1, true)

  applyCursorPressStyle(el)
  await sleep(CURSOR_CLICK_PRESS_MS)

  let previousHover = pressTarget
  await animateWithRAF(animationDurationMs, raw => {
    const t = easeOutCubic(raw)
    const cx = sourceX + (destinationX - sourceX) * t
    const cy = sourceY + (destinationY - sourceY) * t
    setCursorTransform(el, cx, cy)

    const coords: PointerCoords = {
      clientX: sourceCoords.clientX + (destinationCoords.clientX - sourceCoords.clientX) * t,
      clientY: sourceCoords.clientY + (destinationCoords.clientY - sourceCoords.clientY) * t,
    }
    const nextHover = (document.elementFromPoint(coords.clientX, coords.clientY) as HTMLElement | null) ?? sourceElement
    dispatchHoverTransition(previousHover, nextHover, coords, 1)
    dispatchDragMove(sourceElement, nextHover, coords)
    previousHover = nextHover
  })

  const dropTarget = (document.elementFromPoint(destinationCoords.clientX, destinationCoords.clientY) as HTMLElement | null) ?? sourceElement
  dispatchHoverTransition(previousHover, dropTarget, destinationCoords, 1)
  dispatchDragRelease(sourceElement, dropTarget, destinationCoords)

  removeCursorPressStyle(el)
  saveCursorPosition(state, destinationX, destinationY)
}

async function animateHtmlDragWithCursor(
  sourceElement: HTMLElement,
  destinationElement: HTMLElement,
  placement: DragPlacement,
  cursorName: string,
  durationMs: number,
): Promise<void> {
  const animationDurationMs = resolvePointerDurationMs(durationMs)
  const dataTransfer = createSyntheticDataTransfer()
  const sourceCoords = getInteractablePoint(sourceElement)
  const destinationCoords = getDragPlacementCoords(destinationElement, placement)
  const meta = getCursorMeta(cursorName)
  const state = getOrCreateCursorElement(cursorName)
  const el = state.element
  const { x: sourceX, y: sourceY } = getCursorTranslatePosition(sourceCoords, meta)
  const { x: destinationX, y: destinationY } = getCursorTranslatePosition(destinationCoords, meta)
  const { x: startX, y: startY } = getCursorStartPosition(state)

  el.style.display = 'block'
  setCursorTransform(el, startX, startY)

  await animateWithRAF(animationDurationMs, raw => {
    const t = easeOutCubic(raw)
    const cx = startX + (sourceX - startX) * t
    const cy = startY + (sourceY - startY) * t
    setCursorTransform(el, cx, cy)
  })

  const pressTarget = getEventTargetAtPoint(sourceElement, sourceCoords)
  dispatchHoverTransition(null, pressTarget, sourceCoords, 0)
  dispatchPointerLikeEvent(pressTarget, 'pointermove', sourceCoords, 0, true)
  dispatchMouseLikeEvent(pressTarget, 'mousemove', sourceCoords, 0, true)
  el.style.transition = `transform ${CURSOR_CLICK_PRESS_MS}ms ease-in`
  setCursorTransform(el, sourceX, sourceY, 0.85)
  await waitForCursorTransition(el)

  dispatchPointerLikeEvent(pressTarget, 'pointerdown', sourceCoords, 1, true)
  dispatchMouseLikeEvent(pressTarget, 'mousedown', sourceCoords, 1, true)
  dispatchDragLikeEvent(sourceElement, 'dragstart', sourceCoords, dataTransfer)
  await sleep(0)

  let previousHover = pressTarget
  let previousDropTarget: HTMLElement | null = null
  el.style.transition = ''
  await animateWithRAF(animationDurationMs, raw => {
    const t = raw
    const coords = {
      clientX:
        sourceCoords.clientX +
        (destinationCoords.clientX - sourceCoords.clientX) * t,
      clientY:
        sourceCoords.clientY +
        (destinationCoords.clientY - sourceCoords.clientY) * t,
    }
    const { x, y } = getCursorTranslatePosition(coords, meta)
    setCursorTransform(el, x, y, 0.85)

    const nextHover = getEventTargetAtPoint(destinationElement, coords)
    dispatchHoverTransition(previousHover, nextHover, coords, 1)
    if (nextHover !== previousDropTarget) {
      dispatchDragLikeEvent(nextHover, 'dragenter', coords, dataTransfer)
      previousDropTarget = nextHover
    }
    dispatchDragLikeEvent(nextHover, 'dragover', coords, dataTransfer)
    previousHover = nextHover
  })

  const dropTarget = getEventTargetAtPoint(destinationElement, destinationCoords)
  dispatchHoverTransition(previousHover, dropTarget, destinationCoords, 1)
  if (dropTarget !== previousDropTarget) {
    dispatchDragLikeEvent(dropTarget, 'dragenter', destinationCoords, dataTransfer)
  }
  dispatchDragLikeEvent(dropTarget, 'dragover', destinationCoords, dataTransfer)
  dispatchDragLikeEvent(dropTarget, 'drop', destinationCoords, dataTransfer)
  await sleep(0)
  dispatchDragLikeEvent(sourceElement, 'dragend', destinationCoords, dataTransfer)

  el.style.transition = `transform ${CURSOR_CLICK_PRESS_MS}ms ease-out`
  setCursorTransform(el, destinationX, destinationY, 1)
  await waitForCursorTransition(el)
  el.style.transition = ''

  state.lastX = destinationX
  state.lastY = destinationY
}

// ---------------------------------------------------------------------------
// Aurora glow border effect (ai-motion WebGL)
// ---------------------------------------------------------------------------

let motionInstance: Motion | null = null
let motionWrapper: HTMLDivElement | null = null
let currentAuroraTheme: AuroraTheme = 'dark'

function showAuroraGlow(theme: AuroraTheme): void {
  if (motionInstance && motionWrapper?.isConnected && currentAuroraTheme === theme) return
  if (motionInstance && !motionWrapper?.isConnected) {
    motionInstance = null
    motionWrapper = null
  }
  if (motionWrapper && currentAuroraTheme !== theme) {
    const staleWrapper = motionWrapper
    try {
      motionInstance?.fadeOut()
    } catch {
      // ignore
    }
    staleWrapper.remove()
    motionInstance = null
    motionWrapper = null
  }

  try {
    if (!document.body) return

    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-agrune-aurora', 'true')
    Object.assign(wrapper.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483646',
      overflow: 'hidden',
      pointerEvents: 'none',
    })
    document.body.appendChild(wrapper)

    const motion = new Motion({
      mode: theme,
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
    currentAuroraTheme = theme
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

async function flashPointerOverlay(
  element: HTMLElement,
  config: AgagruneRuntimeConfig,
  onPress?: () => void,
): Promise<void> {
  await animateCursorTo(
    element,
    config.cursorName ?? DEFAULT_CURSOR_NAME,
    config.pointerDurationMs,
    onPress,
  )
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

    const resolvedTarget = resolveRuntimeTarget(getDescriptors(), targetId)
    if (!resolvedTarget) {
      return buildErrorResult(commandId, 'TARGET_NOT_FOUND', `target not found: ${targetId}`, currentSnapshot, targetId)
    }

    return effect(resolvedTarget.descriptor, resolvedTarget.element, currentSnapshot)
  }

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

    act: async input =>
      withDescriptor(input.commandId ?? input.targetId, input.targetId, input.expectedVersion, async (descriptor, element, snapshot) => {
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

        const config = resolveExecutionConfig(input.config)
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

        // longpress is async (500ms wait) — cannot go inside synchronous flashPointerOverlay callback
        if (action === 'longpress') {
          await performLongPressSequence(element)
        } else if (config.pointerAnimation) {
          await queue.push({
            type: 'animation',
            execute: () => flashPointerOverlay(element, config, () => {
              switch (action) {
                case 'click': performPointerClickSequence(element); break
                case 'dblclick': performPointerDblClickSequence(element); break
                case 'contextmenu': performContextMenuSequence(element); break
                case 'hover': performHoverSequence(element); break
              }
            }),
          })
        } else {
          switch (action) {
            case 'click': performPointerClickSequence(element); break
            case 'dblclick': performPointerDblClickSequence(element); break
            case 'contextmenu': performContextMenuSequence(element); break
            case 'hover': performHoverSequence(element); break
          }
        }
        const nextSnapshot = await captureSettledSnapshot(2)
        return buildSuccessResult(input.commandId ?? input.targetId, nextSnapshot, {
          actionKind: action,
          targetId: input.targetId,
        })
      }),

    drag: async input =>
      withDescriptor(
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

          const config = resolveExecutionConfig(input.config)
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
            const destCoords: PointerCoords = {
              clientX: input.destinationCoords!.x,
              clientY: input.destinationCoords!.y,
            }

            if (config.pointerAnimation) {
              await queue.push({
                type: 'animation',
                execute: async () => {
                  await animatePointerDragToCoordsWithCursor(
                    sourceElement,
                    destCoords,
                    config.cursorName ?? DEFAULT_CURSOR_NAME,
                    config.pointerDurationMs,
                  )
                },
              })
            } else {
              await performPointerDragToCoords(sourceElement, destCoords)
            }

            const nextSnapshot = await captureSettledSnapshot(2)
            return buildSuccessResult(input.commandId ?? input.sourceTargetId, nextSnapshot, {
              actionKind: 'drag',
              sourceTargetId: input.sourceTargetId,
              destinationCoords: input.destinationCoords,
            })
          }

          // --- Branch: target-based drag (existing logic) ---
          const destinationTarget = resolveRuntimeTarget(getDescriptors(), input.destinationTargetId!)
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

          if (config.pointerAnimation) {
            await queue.push({
              type: 'animation',
              execute: async () => {
                if (sourceElement.draggable) {
                  await animateHtmlDragWithCursor(
                    sourceElement,
                    destinationElement,
                    placement,
                    config.cursorName ?? DEFAULT_CURSOR_NAME,
                    config.pointerDurationMs,
                  )
                } else {
                  await animatePointerDragWithCursor(
                    sourceElement,
                    destinationElement,
                    placement,
                    config.cursorName ?? DEFAULT_CURSOR_NAME,
                    config.pointerDurationMs,
                  )
                }
              },
            })
          } else if (sourceElement.draggable) {
            await performHtmlDragSequence(sourceElement, destinationElement, placement)
          } else {
            await performPointerDragSequence(sourceElement, destinationElement, placement)
          }

          const nextSnapshot = await captureSettledSnapshot(2)
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

        const config = resolveExecutionConfig(input.config)
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
          await queue.push({
            type: 'animation',
            execute: () => flashPointerOverlay(element, config, () => setElementValue(element, input.value)),
          })
        } else {
          setElementValue(element, input.value)
        }
        const nextSnapshot = await captureSettledSnapshot(2)
        return buildSuccessResult(input.commandId ?? input.targetId, nextSnapshot, {
          actionKind: 'fill',
          targetId: input.targetId,
          value: input.value,
        })
      }),

    wait: async input => {
      const timeoutMs =
        typeof input.timeoutMs === 'number' && input.timeoutMs > 0 ? input.timeoutMs : 5_000
      const startedAt = Date.now()
      const { baseTargetId } = parseRuntimeTargetId(input.targetId)
      const descriptor = getDescriptors().find(entry => entry.target.targetId === baseTargetId)

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
        const resolvedTarget = resolveRuntimeTarget(getDescriptors(), input.targetId)
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
    },

    guide: async input =>
      withDescriptor(input.commandId ?? input.targetId, input.targetId, input.expectedVersion, async (descriptor, element, snapshot) => {
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
        const guideConfig = resolveExecutionConfig(input.config)
        await queue.push({
          type: 'animation',
          execute: () =>
            animateCursorTo(
              element,
              guideConfig.cursorName ?? DEFAULT_CURSOR_NAME,
              guideConfig.pointerDurationMs,
              () => performPointerClickSequence(element),
            ),
        })
        const nextSnapshot = captureSnapshot()
        return buildSuccessResult(input.commandId ?? input.targetId, nextSnapshot, {
          actionKind: 'guide',
          targetId: input.targetId,
        })
      }),

    read: async (input) => {
      const root = input.selector
        ? document.querySelector(input.selector)
        : document.body
      if (!root) {
        const snapshot = captureSnapshot()
        return buildErrorResult(
          input.commandId ?? 'read',
          'TARGET_NOT_FOUND',
          `selector not found: ${input.selector}`,
          snapshot,
        )
      }

      await captureSettledSnapshot(1)
      const fullMarkdown = domToMarkdown(root)
      const truncated = fullMarkdown.length > MAX_READ_CHARS
      const markdown = truncated
        ? fullMarkdown.slice(0, MAX_READ_CHARS) + '\n\n[truncated — use selector to read specific sections]'
        : fullMarkdown

      const snapshot = captureSnapshot()
      return buildSuccessResult(input.commandId ?? 'read', snapshot, {
        markdown,
        truncated,
        charCount: fullMarkdown.length,
      })
    },

    pointer: async input => {
      const commandId = input.commandId ?? 'pointer'

      let element: HTMLElement | null = null

      if (input.targetId) {
        const target = resolveRuntimeTarget(getDescriptors(), input.targetId)
        if (!target) {
          const snapshot = await captureSettledSnapshot(0)
          return buildErrorResult(commandId, 'TARGET_NOT_FOUND', `target not found: ${input.targetId}`, snapshot, input.targetId)
        }
        element = target.element
      } else if (input.selector) {
        element = document.querySelector<HTMLElement>(input.selector)
        if (!element) {
          const snapshot = await captureSettledSnapshot(0)
          return buildErrorResult(commandId, 'TARGET_NOT_FOUND', `element not found for selector: ${input.selector}`, snapshot)
        }
      } else if (input.coords) {
        element = document.elementFromPoint(input.coords.x, input.coords.y) as HTMLElement | null
        if (!element) {
          const snapshot = await captureSettledSnapshot(0)
          return buildErrorResult(commandId, 'TARGET_NOT_FOUND', `no element at coordinates (${input.coords.x}, ${input.coords.y})`, snapshot)
        }
      } else {
        const snapshot = await captureSettledSnapshot(0)
        return buildErrorResult(commandId, 'INVALID_COMMAND', 'Must specify targetId, selector, or coords', snapshot)
      }

      if (!input.actions || input.actions.length === 0) {
        const snapshot = await captureSettledSnapshot(0)
        return buildErrorResult(commandId, 'INVALID_COMMAND', 'actions array must not be empty', snapshot)
      }

      for (const action of input.actions) {
        const coords: PointerCoords = { clientX: action.x, clientY: action.y }
        const eventTarget = (document.elementFromPoint(action.x, action.y) as HTMLElement | null) ?? element

        switch (action.type) {
          case 'pointerdown':
            dispatchPointerLikeEvent(eventTarget, 'pointerdown', coords, 1, true)
            dispatchMouseLikeEvent(eventTarget, 'mousedown', coords, 1, true)
            break
          case 'pointermove':
            dispatchPointerLikeEvent(eventTarget, 'pointermove', coords, 1, true)
            dispatchMouseLikeEvent(eventTarget, 'mousemove', coords, 1, true)
            break
          case 'pointerup':
            dispatchPointerLikeEvent(eventTarget, 'pointerup', coords, 0, true)
            dispatchMouseLikeEvent(eventTarget, 'mouseup', coords, 0, true)
            dispatchMouseLikeEvent(eventTarget, 'click', coords, 0, true, { detail: 1 })
            break
          case 'wheel':
            dispatchWheelEvent(eventTarget, coords, action.deltaY, action.ctrlKey ?? false)
            break
        }
      }

      const nextSnapshot = await captureSettledSnapshot(2)
      return buildSuccessResult(commandId, nextSnapshot, {
        actionKind: 'pointer',
        actionsCount: input.actions.length,
      })
    },

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
