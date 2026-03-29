import {
  createCommandError,
  type CommandResult,
  type PageSnapshot,
  type PageTarget,
  type PageTargetReason,
  type ViewportTransform,
} from '@agrune/core'
import type {
  AgagruneManifest,
  AgagruneTargetEntry,
} from '../types'
import {
  buildLiveSelector,
  isElementInViewport,
  isEnabled,
  isFillableElement,
  isOverlayElement,
  isSensitive,
  isTopmostInteractable,
  isVisible,
  viewportToCanvas,
} from './dom-utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionKind = 'click' | 'fill' | 'dblclick' | 'contextmenu' | 'hover' | 'longpress'

export interface TargetDescriptor {
  actionKinds: ActionKind[]
  groupId: string
  groupName?: string
  groupDesc?: string
  target: AgagruneTargetEntry
}

export interface RuntimeTargetMatch {
  descriptor: TargetDescriptor
  element: HTMLElement
  targetId: string
}

export interface MutableSnapshotStore {
  version: number
  signature: string | null
  latest: PageSnapshot | null
}

export interface TargetState {
  visible: boolean
  inViewport: boolean
  enabled: boolean
  covered: boolean
  actionableNow: boolean
  overlay: boolean
  sensitive: boolean
  reason: PageTargetReason
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VALID_ACTIONS = new Set(['click', 'fill', 'dblclick', 'contextmenu', 'hover', 'longpress'])
export const ACT_COMPATIBLE_KINDS = new Set(['click', 'dblclick', 'contextmenu', 'hover', 'longpress'])
export const LIVE_SCAN_ACTION_SELECTOR = '[data-agrune-action]'
export const LIVE_SCAN_GROUP_SELECTOR = '[data-agrune-group]'
export const LIVE_SCAN_DEFAULT_GROUP_ID = 'default'
export const LIVE_SCAN_DEFAULT_GROUP_NAME = 'Default'
export const DOM_SETTLE_TIMEOUT_MS = 320
export const DOM_SETTLE_QUIET_WINDOW_MS = 48
export const DOM_SETTLE_STABLE_FRAMES = 2
export const SNAPSHOT_RELEVANT_ATTRIBUTES = [
  'aria-modal',
  'class',
  'data-agrune-action',
  'data-agrune-canvas',
  'data-agrune-desc',
  'data-agrune-group',
  'data-agrune-group-desc',
  'data-agrune-group-name',
  'data-agrune-key',
  'data-agrune-meta',
  'data-agrune-name',
  'disabled',
  'hidden',
  'role',
  'style',
]

export const REPEATED_TARGET_ID_DELIMITER = '__agrune_idx_'

// ---------------------------------------------------------------------------
// Descriptor collection
// ---------------------------------------------------------------------------

export function collectDescriptors(manifest: AgagruneManifest): TargetDescriptor[] {
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

export function collectLiveDescriptors(): TargetDescriptor[] {
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

export function mergeDescriptors(
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

// ---------------------------------------------------------------------------
// Element / target-id helpers
// ---------------------------------------------------------------------------

export function findElements(descriptor: TargetDescriptor): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(descriptor.target.selector))
}

export function toRuntimeTargetId(baseTargetId: string, index: number, total: number): string {
  if (total <= 1) {
    return baseTargetId
  }
  return `${baseTargetId}${REPEATED_TARGET_ID_DELIMITER}${index}`
}

export function parseRuntimeTargetId(targetId: string): {
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

export function resolveRuntimeTarget(
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

// ---------------------------------------------------------------------------
// Target state capture
// ---------------------------------------------------------------------------

export function resolveTargetReason(input: {
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

export function captureTargetState(
  actionKinds: ActionKind[],
  element: HTMLElement,
  isCanvasGroup: boolean = false,
): TargetState {
  const sensitive = isSensitive(element)
  const visible = isVisible(element)
  const inViewport = visible && isElementInViewport(element)
  const enabled = isEnabled(element)
  const covered = inViewport ? !isTopmostInteractable(element) : false
  // Canvas group targets remain actionableNow even when covered
  const actionableNow = isCanvasGroup
    ? visible && enabled
    : visible && enabled && !covered
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

export function captureTarget(
  descriptor: TargetDescriptor,
  element: HTMLElement,
  targetId: string,
  viewportTransform?: ViewportTransform,
): PageTarget {
  const isCanvasGroup = viewportTransform !== undefined
  const state = captureTargetState(descriptor.actionKinds, element, isCanvasGroup)
  const textContent = element.textContent?.trim() ?? ''
  const valuePreview =
    isFillableElement(element) && !state.sensitive ? element.value : null

  // 동적 속성(name/desc)이 null이면 DOM에서 읽는다
  const name = descriptor.target.name ?? element.getAttribute('data-agrune-name') ?? textContent
  const description = descriptor.target.desc ?? element.getAttribute('data-agrune-desc') ?? ''

  let center: PageTarget['center']
  let size: PageTarget['size']
  let coordSpace: PageTarget['coordSpace']

  if (state.actionableNow) {
    const domRect = element.getBoundingClientRect()
    const cx = domRect.left + domRect.width / 2
    const cy = domRect.top + domRect.height / 2

    if (viewportTransform) {
      const canvasCenter = viewportToCanvas(cx, cy, viewportTransform)
      center = canvasCenter
      size = {
        w: Math.round(domRect.width / viewportTransform.scale),
        h: Math.round(domRect.height / viewportTransform.scale),
      }
      coordSpace = 'canvas'
    } else {
      center = { x: Math.round(cx), y: Math.round(cy) }
      size = { w: Math.round(domRect.width), h: Math.round(domRect.height) }
      coordSpace = 'viewport'
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
    center,
    size,
    coordSpace,
    sourceFile: descriptor.target.sourceFile,
    sourceLine: descriptor.target.sourceLine,
    sourceColumn: descriptor.target.sourceColumn,
  }
}

// ---------------------------------------------------------------------------
// Snapshot construction
// ---------------------------------------------------------------------------

export function makeSnapshot(
  descriptors: TargetDescriptor[],
  store: MutableSnapshotStore,
): PageSnapshot {
  const canvasSelectors = new Map<string, string>()
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-agrune-canvas]'))) {
    const groupId = el.getAttribute('data-agrune-group')?.trim()
    const selector = el.getAttribute('data-agrune-canvas')?.trim()
    if (groupId && selector) canvasSelectors.set(groupId, selector)
  }

  function parseViewportTransform(groupId: string): ViewportTransform | undefined {
    const selector = canvasSelectors.get(groupId)
    if (!selector) return undefined
    const groupEl = document.querySelector<HTMLElement>(`[data-agrune-group="${groupId}"]`)
    const transformEl = groupEl?.querySelector<HTMLElement>(selector)
    if (!transformEl) return undefined
    const style = window.getComputedStyle(transformEl)
    if (!style.transform || style.transform === 'none') return { translateX: 0, translateY: 0, scale: 1 }
    const m = new DOMMatrix(style.transform)
    return { translateX: Math.round(m.e), translateY: Math.round(m.f), scale: Math.round(m.a * 1000) / 1000 }
  }

  const groupTransforms = new Map<string, ViewportTransform>()
  for (const [groupId] of canvasSelectors) {
    const transform = parseViewportTransform(groupId)
    if (transform) groupTransforms.set(groupId, transform)
  }

  const targets = descriptors.flatMap(descriptor => {
    const elements = findElements(descriptor)
    const transform = groupTransforms.get(descriptor.groupId)
    return elements.map((element, index) =>
      captureTarget(
        descriptor,
        element,
        toRuntimeTargetId(descriptor.target.targetId, index, elements.length),
        transform,
      ),
    )
  })

  const groups = new Map<string, { groupId: string; groupName?: string; groupDesc?: string; targetIds: string[]; viewportTransform?: ViewportTransform }>()
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
      viewportTransform: parseViewportTransform(target.groupId),
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
      ...(group.viewportTransform ? { viewportTransform: group.viewportTransform } : {}),
    })),
    targets,
    title: document.title,
    url: window.location.href,
    version: store.version,
  }

  store.latest = snapshot
  return snapshot
}

// ---------------------------------------------------------------------------
// Snapshot query helpers
// ---------------------------------------------------------------------------

export function isRunnableSnapshotTarget(target: PageTarget): boolean {
  return target.actionableNow === true
}

export function isOverlayFlowLocked(snapshot: PageSnapshot): boolean {
  return snapshot.targets.some(target => target.overlay && isRunnableSnapshotTarget(target))
}

export function findSnapshotTarget(
  snapshot: PageSnapshot,
  targetId: string,
): PageTarget | undefined {
  return snapshot.targets.find(target => target.targetId === targetId)
}

// ---------------------------------------------------------------------------
// Result builders
// ---------------------------------------------------------------------------

export function buildFlowBlockedResult(
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

export function buildErrorResult(
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

export function buildSuccessResult(
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
