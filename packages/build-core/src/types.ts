export type AgruneExposureMode = 'grouped' | 'per-element'

export interface AgruneRuntimeOptions {
  clickAutoScroll: boolean
  clickRetryCount: number
  clickRetryDelayMs: number
  postMessage?: (type: string, data: unknown) => void
  /** Bridge callback for CDP request relay. When provided, CDP event sequences are activated. */
  cdpPostMessage?: (type: string, data: unknown) => void
}

export type AgruneSupportedAction = 'click' | 'fill' | 'dblclick' | 'contextmenu' | 'hover' | 'longpress'

export type AgruneToolStatus = 'active' | 'skipped_unsupported_action'

export interface AgruneTargetEntry {
  targetId: string
  name: string | null
  desc: string | null
  selector: string
  sourceFile: string
  sourceLine: number
  sourceColumn: number
}

export interface AgruneToolEntry {
  toolName: string
  toolDesc: string
  action: string
  status: AgruneToolStatus
  targets: AgruneTargetEntry[]
}

export interface AgruneGroupEntry {
  groupId: string
  groupName?: string
  groupDesc?: string
  tools: AgruneToolEntry[]
}

export interface AgruneManifest {
  version: 2
  generatedAt: string
  exposureMode: AgruneExposureMode
  groups: AgruneGroupEntry[]
}
