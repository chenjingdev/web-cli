/**
 * Page runtime — runs in the page's main world (no chrome APIs available).
 * Communicates with the content script via the postMessage bridge.
 *
 * On receiving an `init_runtime` message the actual runtime from
 * @agrune/build-core is installed on `window.agruneDom`.
 */

import { installPageAgentRuntime } from '@agrune/build-core/runtime'

const BRIDGE_MESSAGE_KEY = '__agrune_bridge__'
const INIT_RETRY_MS = 50

type InitRuntimePayload = {
  manifest: unknown
  options?: unknown
}

let pendingInitRuntime: InitRuntimePayload | null = null
let initRetryTimer: ReturnType<typeof setTimeout> | null = null

function sendToContentScript(type: string, data: unknown): void {
  window.postMessage({ source: BRIDGE_MESSAGE_KEY, payload: { type, data } }, '*')
}

function clearInitRetryTimer(): void {
  if (initRetryTimer === null) return
  clearTimeout(initRetryTimer)
  initRetryTimer = null
}

function getRuntime(): {
  isBusy?: () => boolean
  isActive?: () => boolean
} | null {
  return ((window as any).agruneDom ?? null) as {
    isBusy?: () => boolean
    isActive?: () => boolean
  } | null
}

function isRuntimeBusy(): boolean {
  const runtime = getRuntime()
  if (!runtime) return false
  if (typeof runtime.isBusy === 'function') {
    return runtime.isBusy()
  }
  if (typeof runtime.isActive === 'function') {
    return runtime.isActive()
  }
  return false
}

function installRuntime(payload: InitRuntimePayload): void {
  installPageAgentRuntime(payload.manifest as any, (payload.options ?? {}) as any)
  sendToContentScript('runtime_ready', {})
}

function schedulePendingInitRetry(): void {
  if (initRetryTimer !== null) return
  initRetryTimer = setTimeout(() => {
    initRetryTimer = null
    flushPendingInitRuntime()
  }, INIT_RETRY_MS)
}

function flushPendingInitRuntime(): void {
  if (!pendingInitRuntime) return
  if (isRuntimeBusy()) {
    schedulePendingInitRetry()
    return
  }

  const payload = pendingInitRuntime
  pendingInitRuntime = null
  clearInitRetryTimer()
  installRuntime(payload)
}

// Listen for commands from the content script
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (!event.data || event.data.source !== BRIDGE_MESSAGE_KEY) return

  const { type, data } = event.data.payload

  // Initialize the real runtime when the content script sends the manifest.
  // Re-initialization is deferred only while a command/agent activity is still
  // in flight. Visual idle tails should not block manifest refreshes.
  if (type === 'init_runtime') {
    pendingInitRuntime = data as InitRuntimePayload
    flushPendingInitRuntime()
    return
  }

  if (type === 'command' && (window as any).agruneDom) {
    const { kind, commandId, ...args } = data as Record<string, unknown>
    const runtime = (window as any).agruneDom
    const fn = runtime[kind as string]
    if (typeof fn === 'function') {
      fn.call(runtime, args)
        .then((result: unknown) => {
          sendToContentScript('command_result', { commandId, result })
        })
        .catch((err: Error) => {
          sendToContentScript('command_result', {
            commandId,
            result: { commandId, ok: false, error: { code: 'RUNTIME_ERROR', message: err.message } },
          })
        })
    } else {
      sendToContentScript('command_result', {
        commandId,
        result: { commandId, ok: false, error: { code: 'UNKNOWN_COMMAND', message: `Unknown command: ${kind}` } },
      })
    }
  }

  if (type === 'request_snapshot' && (window as any).agruneDom) {
    const snapshot = (window as any).agruneDom.getSnapshot()
    sendToContentScript('snapshot', snapshot)
  }

  if (type === 'config_update' && (window as any).agruneDom) {
    ;(window as any).agruneDom.applyConfig(data)
  }

  if (type === 'agent_activity' && (window as any).agruneDom) {
    const { active } = data as { active: boolean }
    if (active) {
      ;(window as any).agruneDom.beginAgentActivity()
    } else {
      ;(window as any).agruneDom.endAgentActivity()
    }
  }
})

// Signal that the bridge script is loaded (runtime not yet initialized)
sendToContentScript('bridge_loaded', {})
