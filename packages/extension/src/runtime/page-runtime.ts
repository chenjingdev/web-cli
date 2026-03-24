/**
 * Page runtime — runs in the page's main world (no chrome APIs available).
 * Communicates with the content script via the postMessage bridge.
 *
 * On receiving an `init_runtime` message the actual runtime from
 * @runeai/build-core is installed on `window.webcliDom`.
 */

import { installPageAgentRuntime } from '@runeai/build-core/runtime'

const BRIDGE_MESSAGE_KEY = '__rune_bridge__'

function sendToContentScript(type: string, data: unknown): void {
  window.postMessage({ source: BRIDGE_MESSAGE_KEY, payload: { type, data } }, '*')
}

// Listen for commands from the content script
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (!event.data || event.data.source !== BRIDGE_MESSAGE_KEY) return

  const { type, data } = event.data.payload

  // Initialize the real runtime when the content script sends the manifest.
  // Skip re-initialization if the current runtime is active (agent working or
  // animations in progress) to avoid resetting visual state mid-operation.
  if (type === 'init_runtime') {
    const { manifest, options } = data as { manifest: any; options?: any }
    const existing = (window as any).webcliDom
    if (existing?.isActive?.()) {
      // Runtime is busy (agent active, queue processing, or idle timer pending)
      // — skip re-init to avoid resetting visual state mid-operation.
      return
    }
    installPageAgentRuntime(manifest, options ?? {})
    sendToContentScript('runtime_ready', {})
    return
  }

  if (type === 'command' && (window as any).webcliDom) {
    const { kind, commandId, ...args } = data as Record<string, unknown>
    const runtime = (window as any).webcliDom
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

  if (type === 'request_snapshot' && (window as any).webcliDom) {
    const snapshot = (window as any).webcliDom.getSnapshot()
    sendToContentScript('snapshot', snapshot)
  }

  if (type === 'config_update' && (window as any).webcliDom) {
    ;(window as any).webcliDom.applyConfig(data)
  }

  if (type === 'agent_activity' && (window as any).webcliDom) {
    const { active } = data as { active: boolean }
    if (active) {
      ;(window as any).webcliDom.beginAgentActivity()
    } else {
      ;(window as any).webcliDom.endAgentActivity()
    }
  }
})

// Signal that the bridge script is loaded (runtime not yet initialized)
sendToContentScript('bridge_loaded', {})
