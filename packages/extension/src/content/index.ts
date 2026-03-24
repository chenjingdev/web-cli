import { scanAnnotations, scanGroups } from './dom-scanner'
import { buildManifest } from './manifest-builder'
import { injectRuntime } from './runtime-injector'
import { setupBridge, sendToBridge } from './bridge'
import { syncStoredConfigToRuntime } from './runtime-config'

const SNAPSHOT_INTERVAL_MS = 800
const MUTATION_DEBOUNCE_MS = 500

let contextValid = true
let snapshotTimer: ReturnType<typeof setInterval> | null = null

function safeSendMessage(msg: unknown) {
  if (!contextValid) return
  try {
    chrome.runtime.sendMessage(msg)
  } catch {
    // Extension context invalidated (extension reloaded/removed)
    contextValid = false
    if (snapshotTimer) {
      clearInterval(snapshotTimer)
      snapshotTimer = null
    }
  }
}

function hasAnnotations(): boolean {
  return document.querySelector('[data-rune-action]') !== null
}

function init() {
  if (!hasAnnotations()) return
  if (typeof chrome === 'undefined' || !chrome.runtime) return

  // 1. Notify service worker about this tab
  safeSendMessage({
    type: 'session_open',
    url: location.href,
    title: document.title,
  })

  // 2. Register the bridge listener before injecting the runtime so we do not
  // miss the initial bridge_loaded message on fast loads.
  setupBridge((type, data) => {
    if (type === 'bridge_loaded') {
      const targets = scanAnnotations(document)
      const groups = scanGroups(document)
      const manifest = buildManifest(targets, groups)
      sendToBridge('init_runtime', { manifest, options: {} })
    }

    if (type === 'runtime_ready') {
      startSnapshotLoop()
      void syncStoredConfigToRuntime(sendToBridge)
    }

    if (type === 'snapshot') {
      safeSendMessage({ type: 'snapshot', snapshot: data })
    }

    if (type === 'command_result') {
      const { commandId, result } = data as { commandId: string; result: unknown }
      safeSendMessage({ type: 'command_result', commandId, result })
    }
  })

  // 3. Inject runtime into main world
  injectRuntime()

  // 4. Listen for commands from service worker
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'command_request') {
      sendToBridge('command', {
        kind: msg.command.kind,
        commandId: msg.commandId,
        ...msg.command,
      })
    }
    if (msg.type === 'config_update') {
      sendToBridge('config_update', msg.config)
    }
    if (msg.type === 'agent_activity') {
      sendToBridge('agent_activity', { active: msg.active })
    }
  })

  // 5. MutationObserver for dynamic DOM changes (debounced)
  // Ignore mutations from webcli-injected elements (aurora, pointer, etc.)
  const WEBCLI_SELECTOR = '[data-rune-aurora], [data-rune-pointer]'
  const isWebcliNode = (node: Node): boolean => {
    // For non-element nodes (text, comment), check parent
    if (!(node instanceof HTMLElement)) {
      return node.parentElement?.closest?.(WEBCLI_SELECTOR) !== null
    }
    if (
      node.hasAttribute('data-rune-aurora') ||
      node.hasAttribute('data-rune-pointer') ||
      node.id === 'rune-cursor-style'
    ) return true
    return node.closest?.(WEBCLI_SELECTOR) !== null
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const observer = new MutationObserver((mutations) => {
    if (!contextValid) return

    // Skip if all mutations are webcli-internal DOM changes
    const hasRelevantMutation = mutations.some(m => {
      for (const node of m.addedNodes) {
        if (!isWebcliNode(node)) return true
      }
      for (const node of m.removedNodes) {
        if (!isWebcliNode(node)) return true
      }
      return false
    })
    if (!hasRelevantMutation) return

    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      const targets = scanAnnotations(document)
      const groups = scanGroups(document)
      const manifest = buildManifest(targets, groups)
      sendToBridge('init_runtime', { manifest, options: {} })
    }, MUTATION_DEBOUNCE_MS)
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

function startSnapshotLoop() {
  if (snapshotTimer) return
  snapshotTimer = setInterval(() => {
    if (!contextValid) {
      clearInterval(snapshotTimer!)
      snapshotTimer = null
      return
    }
    sendToBridge('request_snapshot', {})
  }, SNAPSHOT_INTERVAL_MS)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
