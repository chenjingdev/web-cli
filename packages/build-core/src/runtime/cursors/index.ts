// ---------------------------------------------------------------------------
// Cursor registry
// 'default' uses the page-agent style two-layer CSS approach (filling + gradient border mask).
// 'orb' uses inline SVG.
// ---------------------------------------------------------------------------

export type CursorKind = 'css-layers' | 'svg-inline'

export interface CursorMeta {
  kind: CursorKind
  width: number
  height: number
  hotspotX: number
  hotspotY: number
  /** SVG innerHTML for 'svg-inline' kind */
  svg?: string
}

const CURSOR_ORB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" fill="none">
  <g filter="url(#rune-orb-glow)">
    <circle cx="24" cy="24" r="14" fill="url(#rune-orb-bg)" fill-opacity="0.2"/>
    <circle cx="24" cy="24" r="14" stroke="url(#rune-orb-stroke)" stroke-width="2" stroke-dasharray="6 4" stroke-linecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="4s" repeatCount="indefinite"/>
    </circle>
    <circle cx="24" cy="24" r="6" fill="url(#rune-orb-stroke)">
      <animate attributeName="r" values="5;7;5" dur="2s" repeatCount="indefinite"/>
    </circle>
    <circle cx="24" cy="24" r="2" fill="#ffffff"/>
  </g>
  <defs>
    <linearGradient id="rune-orb-bg" x1="10" y1="10" x2="38" y2="38" gradientUnits="userSpaceOnUse">
      <stop stop-color="#a855f7"/>
      <stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
    <linearGradient id="rune-orb-stroke" x1="10" y1="10" x2="38" y2="38" gradientUnits="userSpaceOnUse">
      <stop stop-color="#d946ef"/>
      <stop offset="1" stop-color="#0ea5e9"/>
    </linearGradient>
    <filter id="rune-orb-glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
</svg>`

// URL-encoded SVGs for the page-agent style pointer cursor
const POINTER_FILL_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cg%3E%3Cpath d='M 15 42 L 15 36.99 Q 15 31.99 23.7 31.99 L 28.05 31.99 Q 32.41 31.99 32.41 21.99 L 32.41 17 Q 32.41 12 41.09 16.95 L 76.31 37.05 Q 85 42 76.31 46.95 L 41.09 67.05 Q 32.41 72 32.41 62.01 L 32.41 57.01 Q 32.41 52.01 23.7 52.01 L 19.35 52.01 Q 15 52.01 15 47.01 Z' fill='%23ffffff' stroke='none'/%3E%3C/g%3E%3C/svg%3E"

const POINTER_BORDER_MASK_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='none'%3E%3Cg%3E%3Cpath d='M 15 42 L 15 36.99 Q 15 31.99 23.7 31.99 L 28.05 31.99 Q 32.41 31.99 32.41 21.99 L 32.41 17 Q 32.41 12 41.09 16.95 L 76.31 37.05 Q 85 42 76.31 46.95 L 41.09 67.05 Q 32.41 72 32.41 62.01 L 32.41 57.01 Q 32.41 52.01 23.7 52.01 L 19.35 52.01 Q 15 52.01 15 47.01 Z' fill='none' stroke='%23000000' stroke-width='6' stroke-miterlimit='10'/%3E%3C/g%3E%3C/svg%3E"

export { POINTER_FILL_SVG, POINTER_BORDER_MASK_SVG }

export const CURSOR_REGISTRY: Record<string, CursorMeta> = {
  default: { kind: 'css-layers', width: 75, height: 75, hotspotX: 0, hotspotY: 0 },
  orb: { kind: 'svg-inline', width: 48, height: 48, hotspotX: 24, hotspotY: 24, svg: CURSOR_ORB_SVG },
}

export const CURSOR_NAMES = Object.keys(CURSOR_REGISTRY)
export const DEFAULT_CURSOR_NAME = 'default'

export function getCursorMeta(name: string): CursorMeta {
  return CURSOR_REGISTRY[name] ?? CURSOR_REGISTRY[DEFAULT_CURSOR_NAME]
}
