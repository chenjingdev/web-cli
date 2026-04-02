// Re-export manifest types from core (moved there for shared access)
export type {
  AgruneExposureMode,
  AgruneSupportedAction,
  AgruneToolStatus,
  AgruneTargetEntry,
  AgruneToolEntry,
  AgruneGroupEntry,
  AgruneManifest,
} from '@agrune/core'

// Runtime-specific types
export interface AgruneRuntimeOptions {
  clickAutoScroll: boolean
  clickRetryCount: number
  clickRetryDelayMs: number
  postMessage?: (type: string, data: unknown) => void
  /** Bridge callback for CDP request relay. When provided, CDP event sequences are activated. */
  cdpPostMessage?: (type: string, data: unknown) => void
}
