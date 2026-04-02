export type AgruneExposureMode = 'grouped' | 'per-element'

export type AgruneSupportedAction =
  | 'click'
  | 'fill'
  | 'dblclick'
  | 'contextmenu'
  | 'hover'
  | 'longpress'

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
  action: AgruneSupportedAction
  status: AgruneToolStatus
  targets: AgruneTargetEntry[]
}

export interface AgruneGroupEntry {
  groupId: string
  groupName: string | null
  groupDesc: string | null
  tools: AgruneToolEntry[]
}

export interface AgruneManifest {
  version: 2
  generatedAt: string
  exposureMode: AgruneExposureMode
  groups: AgruneGroupEntry[]
}
