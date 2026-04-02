import type { DragPlacement, ViewportTransform } from '@agrune/core'
import type { EventSequences } from './event-sequences'

// ---------------------------------------------------------------------------
// Constants used by DOM utilities
// ---------------------------------------------------------------------------

const AGRUNE_INTERNAL_SELECTOR = '[data-agrune-aurora], [data-agrune-pointer], #agrune-cursor-style'
const CURSOR_STYLE_ID = 'agrune-cursor-style'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PointerCoords {
  clientX: number
  clientY: number
}

export interface RectBounds {
  top: number
  left: number
  right: number
  bottom: number
}

// ---------------------------------------------------------------------------
// Internal-node detection
// ---------------------------------------------------------------------------

export function isAgruneInternalNode(node: Node | null): boolean {
  if (!node) return false
  if (node.nodeType !== 1) {
    return (node.parentElement?.closest?.(AGRUNE_INTERNAL_SELECTOR) ?? null) != null
  }
  const element = node as HTMLElement
  if (element.id === CURSOR_STYLE_ID) return true
  if (
    element.hasAttribute('data-agrune-aurora') ||
    element.hasAttribute('data-agrune-pointer')
  ) {
    return true
  }
  return element.closest(AGRUNE_INTERNAL_SELECTOR) != null
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function toRectBounds(
  rect: Pick<DOMRect, 'top' | 'left' | 'right' | 'bottom'>,
): RectBounds {
  return {
    top: Math.min(rect.top, rect.bottom),
    left: Math.min(rect.left, rect.right),
    right: Math.max(rect.left, rect.right),
    bottom: Math.max(rect.top, rect.bottom),
  }
}

export function intersectRectBounds(
  rect: RectBounds,
  other: RectBounds,
): RectBounds | null {
  const top = Math.max(rect.top, other.top)
  const left = Math.max(rect.left, other.left)
  const right = Math.min(rect.right, other.right)
  const bottom = Math.min(rect.bottom, other.bottom)

  if (right - left < 1 || bottom - top < 1) {
    return null
  }

  return { top, left, right, bottom }
}

// ---------------------------------------------------------------------------
// Visibility / viewport checks
// ---------------------------------------------------------------------------

export function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false
  }
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

export function isInViewport(rect: DOMRect): boolean {
  return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth
}

function isScrollableOverflowValue(value: string): boolean {
  return value === 'auto' || value === 'scroll' || value === 'overlay'
}

export function getElementViewportRect(element: HTMLElement): RectBounds | null {
  let visibleRect = intersectRectBounds(
    toRectBounds(element.getBoundingClientRect()),
    {
      top: 0,
      left: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    },
  )

  if (!visibleRect) {
    return null
  }

  let current = element.parentElement
  while (current && current !== document.body && current !== document.documentElement) {
    const style = window.getComputedStyle(current)
    if (
      isScrollableOverflowValue(style.overflow) ||
      isScrollableOverflowValue(style.overflowX) ||
      isScrollableOverflowValue(style.overflowY)
    ) {
      visibleRect = intersectRectBounds(
        visibleRect,
        toRectBounds(current.getBoundingClientRect()),
      )
      if (!visibleRect) {
        return null
      }
    }
    current = current.parentElement
  }

  return visibleRect
}

export function isElementInViewport(element: HTMLElement): boolean {
  return getElementViewportRect(element) !== null
}

export function isEnabled(element: HTMLElement): boolean {
  if ('disabled' in element) {
    return !(element as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled
  }
  return true
}

export function isPointInsideViewport(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight
}

// ---------------------------------------------------------------------------
// Sample-point generation / interactable-point detection
// ---------------------------------------------------------------------------

export function getVisibleSamplePoints(
  rect: Pick<DOMRect, 'top' | 'left' | 'right' | 'bottom'>,
): PointerCoords[] {
  const normalizedRect = toRectBounds(rect)
  if (normalizedRect.right - normalizedRect.left < 1 || normalizedRect.bottom - normalizedRect.top < 1) {
    return []
  }

  const insetX = Math.min(18, Math.max(4, (normalizedRect.right - normalizedRect.left) * 0.15))
  const insetY = Math.min(18, Math.max(4, (normalizedRect.bottom - normalizedRect.top) * 0.15))
  const left = normalizedRect.left + insetX
  const centerX = (normalizedRect.left + normalizedRect.right) / 2
  const right = normalizedRect.right - insetX
  const top = normalizedRect.top + insetY
  const centerY = (normalizedRect.top + normalizedRect.bottom) / 2
  const bottom = normalizedRect.bottom - insetY

  const orderedPoints: PointerCoords[] = [
    { clientX: centerX, clientY: centerY },
    { clientX: left, clientY: centerY },
    { clientX: right, clientY: centerY },
    { clientX: centerX, clientY: top },
    { clientX: centerX, clientY: bottom },
    { clientX: left, clientY: top },
    { clientX: right, clientY: top },
    { clientX: left, clientY: bottom },
    { clientX: right, clientY: bottom },
  ]

  const uniquePoints = new Map<string, PointerCoords>()
  for (const point of orderedPoints) {
    const key = `${Math.round(point.clientX * 100) / 100}:${Math.round(point.clientY * 100) / 100}`
    if (!uniquePoints.has(key)) {
      uniquePoints.set(key, point)
    }
  }

  return Array.from(uniquePoints.values())
}

export function findInteractablePoint(element: HTMLElement): PointerCoords | null {
  if (typeof document.elementFromPoint !== 'function') {
    return getElementCenter(element)
  }

  const viewportRect = getElementViewportRect(element)
  if (!viewportRect) {
    return null
  }

  const samplePoints = getVisibleSamplePoints(viewportRect)
  for (const point of samplePoints) {
    if (
      !Number.isFinite(point.clientX) ||
      !Number.isFinite(point.clientY) ||
      !isPointInsideViewport(point.clientX, point.clientY)
    ) {
      continue
    }
    const topmost = document.elementFromPoint(point.clientX, point.clientY)
    if (topmost && (topmost === element || element.contains(topmost))) {
      return point
    }
  }

  return null
}

export function isTopmostInteractable(element: HTMLElement): boolean {
  if (typeof document.elementFromPoint !== 'function') {
    return true
  }
  return findInteractablePoint(element) !== null
}

export function getInteractablePoint(element: HTMLElement): PointerCoords {
  return findInteractablePoint(element) ?? getElementCenter(element)
}

export function getElementCenter(element: HTMLElement): PointerCoords {
  const rect = element.getBoundingClientRect()
  return {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  }
}

/**
 * Returns the center of the visible portion of an element within the viewport.
 * When the element's true center is offscreen but an edge is visible, this
 * returns a point inside the visible area so that drag pickup can succeed.
 */
export function getVisibleCenter(element: HTMLElement): PointerCoords {
  const rect = element.getBoundingClientRect()
  const visibleLeft = Math.max(rect.left, 0)
  const visibleTop = Math.max(rect.top, 0)
  const visibleRight = Math.min(rect.right, window.innerWidth)
  const visibleBottom = Math.min(rect.bottom, window.innerHeight)

  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
    // Completely offscreen — fall back to geometric center
    return {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }
  }

  return {
    clientX: (visibleLeft + visibleRight) / 2,
    clientY: (visibleTop + visibleBottom) / 2,
  }
}

export function getDragPlacementCoords(
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

export function getEventTargetAtPoint(
  fallback: HTMLElement,
  coords: PointerCoords,
): HTMLElement {
  const hit = document.elementFromPoint(coords.clientX, coords.clientY)
  return hit instanceof HTMLElement ? hit : fallback
}

// ---------------------------------------------------------------------------
// Element property checks
// ---------------------------------------------------------------------------

export function isSensitive(element: HTMLElement): boolean {
  return element.getAttribute('data-agrune-sensitive') === 'true'
}

export function isOverlayElement(element: HTMLElement): boolean {
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

export function isFillableElement(
  element: Element,
): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  )
}

// ---------------------------------------------------------------------------
// Selector builders
// ---------------------------------------------------------------------------

export function escapeAttributeValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

export function buildDomPathSelector(element: HTMLElement): string {
  const segments: string[] = []
  let current: HTMLElement | null = element

  while (current && current !== document.body) {
    const tagName = current.tagName.toLowerCase()
    let siblingIndex = 1
    let sibling = current.previousElementSibling
    while (sibling) {
      if (sibling.tagName === current.tagName) {
        siblingIndex += 1
      }
      sibling = sibling.previousElementSibling
    }
    segments.unshift(`${tagName}:nth-of-type(${siblingIndex})`)
    current = current.parentElement
  }

  return `body > ${segments.join(' > ')}`
}

export function buildLiveSelector(element: HTMLElement): string {
  const key = element.getAttribute('data-agrune-key')?.trim()
  if (key) {
    return `[data-agrune-key="${escapeAttributeValue(key)}"]`
  }

  const name = element.getAttribute('data-agrune-name')?.trim()
  if (name) {
    const selector = `[data-agrune-name="${escapeAttributeValue(name)}"]`
    if (document.querySelectorAll(selector).length === 1) {
      return selector
    }
  }

  return buildDomPathSelector(element)
}

// ---------------------------------------------------------------------------
// Mutation relevance check
// ---------------------------------------------------------------------------

export function isRelevantSnapshotMutation(mutation: MutationRecord): boolean {
  if (mutation.type === 'attributes') {
    return !isAgruneInternalNode(mutation.target)
  }

  for (const node of Array.from(mutation.addedNodes)) {
    if (!isAgruneInternalNode(node)) return true
  }
  for (const node of Array.from(mutation.removedNodes)) {
    if (!isAgruneInternalNode(node)) return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Scroll / animation-frame helpers
// ---------------------------------------------------------------------------

export function waitForNextFrame(): Promise<void> {
  return new Promise(resolve => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve())
      return
    }
    window.setTimeout(resolve, 16)
  })
}

export async function smoothScrollIntoView(element: HTMLElement): Promise<void> {
  const isReadyForInteraction = () => {
    return isElementInViewport(element) && isTopmostInteractable(element)
  }

  if (isReadyForInteraction()) {
    return
  }

  element.scrollIntoView({ block: 'center', inline: 'center' })
  const deadline = performance.now() + 400
  let lastRect = element.getBoundingClientRect()
  let stableFrames = 0
  while (performance.now() < deadline) {
    await waitForNextFrame()

    const nextRect = element.getBoundingClientRect()
    const moved =
      Math.abs(nextRect.top - lastRect.top) > 0.5 ||
      Math.abs(nextRect.left - lastRect.left) > 0.5 ||
      Math.abs(nextRect.bottom - lastRect.bottom) > 0.5 ||
      Math.abs(nextRect.right - lastRect.right) > 0.5

    if (!moved) {
      stableFrames++
    } else {
      stableFrames = 0
      lastRect = nextRect
    }

    if (isReadyForInteraction()) {
      if (stableFrames >= 1) {
        break
      }
      continue
    }

    if (stableFrames >= 3) {
      break
    }
  }
}

export function viewportToCanvas(
  viewportX: number,
  viewportY: number,
  transform: ViewportTransform,
): { x: number; y: number } {
  return {
    x: Math.round((viewportX - transform.translateX) / transform.scale),
    y: Math.round((viewportY - transform.translateY) / transform.scale),
  }
}

export function canvasToViewport(
  canvasX: number,
  canvasY: number,
  transform: ViewportTransform,
): { x: number; y: number } {
  return {
    x: Math.round(canvasX * transform.scale + transform.translateX),
    y: Math.round(canvasY * transform.scale + transform.translateY),
  }
}

export function parseTransform(element: HTMLElement): ViewportTransform {
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  if (!style.transform || style.transform === 'none') {
    return { translateX: Math.round(rect.left), translateY: Math.round(rect.top), scale: 1 }
  }
  const m = new DOMMatrix(style.transform)
  return {
    translateX: Math.round(rect.left),
    translateY: Math.round(rect.top),
    scale: Math.round(m.a * 1000) / 1000,
  }
}

/**
 * Auto-pan canvas so the given canvas coordinate is inside the viewport.
 * Fires wheel events and verifies transform changed. Returns final transform or null on failure.
 */
export async function autoPanToCanvasPoint(
  canvasX: number,
  canvasY: number,
  groupEl: HTMLElement,
  canvasSelector: string,
  eventSequences: EventSequences,
  maxAttempts = 3,
): Promise<ViewportTransform | null> {
  const MARGIN = 50

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const transformEl = groupEl.querySelector<HTMLElement>(canvasSelector)
    if (!transformEl) return null

    const transform = parseTransform(transformEl)
    const vp = canvasToViewport(canvasX, canvasY, transform)

    if (
      vp.x >= MARGIN &&
      vp.y >= MARGIN &&
      vp.x <= window.innerWidth - MARGIN &&
      vp.y <= window.innerHeight - MARGIN
    ) {
      return transform
    }

    const centerX = window.innerWidth / 2
    const centerY = window.innerHeight / 2
    const deltaX = vp.x - centerX
    const deltaY = vp.y - centerY

    await eventSequences.wheel({ x: centerX, y: centerY }, deltaY, false)
    await new Promise(r => setTimeout(r, 100))

    const newTransform = parseTransform(transformEl)
    if (
      newTransform.translateX === transform.translateX &&
      newTransform.translateY === transform.translateY &&
      newTransform.scale === transform.scale
    ) {
      return null // wheel didn't change transform — library doesn't support this
    }
  }

  const transformEl = groupEl.querySelector<HTMLElement>(canvasSelector)
  if (!transformEl) return null
  const finalTransform = parseTransform(transformEl)
  const finalVp = canvasToViewport(canvasX, canvasY, finalTransform)
  if (isPointInsideViewport(finalVp.x, finalVp.y)) {
    return finalTransform
  }
  return null
}
