export type AgagruneExposureMode = 'grouped' | 'per-element'

export interface AgagruneRuntimeOptions {
  clickAutoScroll: boolean
  clickRetryCount: number
  clickRetryDelayMs: number
}

export type AgagruneSupportedAction = 'click' | 'fill' | 'dblclick' | 'contextmenu' | 'hover' | 'longpress'

export type AgagruneToolStatus = 'active' | 'skipped_unsupported_action'

export interface AgagruneTargetEntry {
  targetId: string
  name: string | null
  desc: string | null
  selector: string
  sourceFile: string
  sourceLine: number
  sourceColumn: number
}

export interface AgagruneToolEntry {
  toolName: string
  toolDesc: string
  action: string
  status: AgagruneToolStatus
  targets: AgagruneTargetEntry[]
}

export interface AgagruneGroupEntry {
  groupId: string
  groupName?: string
  groupDesc?: string
  tools: AgagruneToolEntry[]
}

export interface AgagruneManifest {
  version: 2
  generatedAt: string
  exposureMode: AgagruneExposureMode
  groups: AgagruneGroupEntry[]
}
