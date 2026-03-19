export type UnsupportedActionHandling = 'warn-skip' | 'error'

export type WebCliExposureMode = 'grouped' | 'per-element'

export type WebCliEmitTrackingAttr = 'none' | 'debug' | 'always'

export type WebCliDeclarativeCompat = 'off' | 'webcli-form-draft-2025-10'

export interface WebCliDomPluginOptions {
  include?: string[]
  exclude?: string[]
  manifestFile?: string
  toolPrefix?: string
  preserveSourceAttrs?: boolean
  strict?: boolean
  unsupportedActionHandling?: UnsupportedActionHandling
  exposureMode?: WebCliExposureMode
  groupAttr?: string
  emitTrackingAttr?: WebCliEmitTrackingAttr
  declarativeCompat?: WebCliDeclarativeCompat
  click?: {
    autoScroll?: boolean
    retryCount?: number
    retryDelayMs?: number
  }
}

export interface WebCliRuntimeOptions {
  clickAutoScroll: boolean
  clickRetryCount: number
  clickRetryDelayMs: number
}

export type WebCliSupportedAction = 'click' | 'fill'

export type WebCliToolStatus = 'active' | 'skipped_unsupported_action'

export interface WebCliTargetEntry {
  targetId: string
  name: string | null
  desc: string | null
  selector: string
  sourceFile: string
  sourceLine: number
  sourceColumn: number
}

export interface WebCliToolEntry {
  toolName: string
  toolDesc: string
  action: string
  status: WebCliToolStatus
  targets: WebCliTargetEntry[]
}

export interface WebCliGroupEntry {
  groupId: string
  groupName?: string
  groupDesc?: string
  tools: WebCliToolEntry[]
}

export interface WebCliManifest {
  version: 2
  generatedAt: string
  exposureMode: WebCliExposureMode
  groups: WebCliGroupEntry[]
}

export interface WebCliCompiledTarget {
  action: string
  status: WebCliToolStatus
  groupId: string
  groupName?: string
  groupDesc?: string
  target: WebCliTargetEntry
}

export interface WebCliDiagnostic {
  level: 'warning' | 'error'
  code:
    | 'WCLI_COMPILE_MISSING_ATTR'
    | 'WCLI_COMPILE_EMPTY_ATTR'
    | 'WCLI_COMPILE_DYNAMIC_ATTR'
    | 'WCLI_COMPILE_UNSUPPORTED_ACTION'
    | 'WCLI_COMPILE_DUPLICATE_TOOL'
    | 'WCLI_COMPILE_PARSE_ERROR'
  message: string
  file: string
  line: number
  column: number
}
