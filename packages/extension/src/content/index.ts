import { scanAnnotations, scanGroups } from './dom-scanner'
import { buildManifest } from './manifest-builder'
import { injectRuntime } from './runtime-injector'
import { setupBridge, sendToBridge } from './bridge'
import { syncStoredConfigToRuntime } from './runtime-config'
import { showHighlight, clearHighlight } from './highlight-overlay'

const SNAPSHOT_INTERVAL_MS = 800
const MUTATION_DEBOUNCE_MS = 500

let contextValid = true
let snapshotTimer: ReturnType<typeof setInterval> | null = null
let bootstrapped = false
let annotationBootstrapObserver: MutationObserver | null = null

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
  return document.querySelector('[data-agrune-action]') !== null
}

function sendSessionOpen() {
  safeSendMessage({
    type: 'session_open',
    url: location.href,
    title: document.title,
  })
}

function sendManifestToRuntime() {
  const targets = scanAnnotations(document)
  const groups = scanGroups(document)
  const manifest = buildManifest(targets, groups)
  sendToBridge('init_runtime', { manifest, options: {} })
}

function bootstrapRuntime() {
  if (bootstrapped) return
  bootstrapped = true
  annotationBootstrapObserver?.disconnect()
  annotationBootstrapObserver = null

  // 1. Notify service worker about this tab
  sendSessionOpen()

  // 2. Register the bridge listener before injecting the runtime so we do not
  // miss the initial bridge_loaded message on fast loads.
  setupBridge((type, data) => {
    if (type === 'bridge_loaded') {
      sendManifestToRuntime()
    }

    if (type === 'runtime_ready') {
      sendToBridge('request_snapshot', {})
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

    // Relay cdp_request from page runtime to background
    if (type === 'cdp_request') {
      safeSendMessage(data)
    }
  })

  // 3. Inject runtime into main world
  injectRuntime()

  // 4. MutationObserver for dynamic DOM changes (debounced)
  // Ignore mutations from agrune-injected elements (aurora, pointer, etc.)
  const AGRUNE_SELECTOR = '[data-agrune-aurora], [data-agrune-pointer]'
  const isAgagruneNode = (node: Node): boolean => {
    // For non-element nodes (text, comment), check parent
    if (!(node instanceof HTMLElement)) {
      return node.parentElement?.closest?.(AGRUNE_SELECTOR) !== null
    }
    if (
      node.hasAttribute('data-agrune-aurora') ||
      node.hasAttribute('data-agrune-pointer') ||
      node.id === 'agrune-cursor-style'
    ) return true
    return node.closest?.(AGRUNE_SELECTOR) !== null
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const observer = new MutationObserver((mutations) => {
    if (!contextValid) return

    // Skip if all mutations are agrune-internal DOM changes
    const hasRelevantMutation = mutations.some(m => {
      for (const node of m.addedNodes) {
        if (!isAgagruneNode(node)) return true
      }
      for (const node of m.removedNodes) {
        if (!isAgagruneNode(node)) return true
      }
      return false
    })
    if (!hasRelevantMutation) return

    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      sendManifestToRuntime()
    }, MUTATION_DEBOUNCE_MS)
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

function waitForAnnotationsAndBootstrap() {
  if (bootstrapped || annotationBootstrapObserver !== null) return
  if (hasAnnotations()) {
    bootstrapRuntime()
    return
  }

  annotationBootstrapObserver = new MutationObserver(() => {
    if (!hasAnnotations()) return
    bootstrapRuntime()
  })
  annotationBootstrapObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}

function registerRuntimeMessageListener() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'highlight_target') {
      showHighlight({ selector: msg.selector, targetId: msg.targetId })
      return
    }
    if (msg.type === 'clear_highlight') {
      clearHighlight()
      return
    }

    if (!bootstrapped) {
      if (msg.type === 'resync') {
        if (hasAnnotations()) {
          bootstrapRuntime()
        } else {
          waitForAnnotationsAndBootstrap()
        }
      }
      return
    }

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
    if (msg.type === 'resync') {
      sendSessionOpen()
      sendToBridge('request_snapshot', {})
    }

    // Relay cdp_response and cdp_event from background to page runtime
    if (msg.type === 'cdp_response' || msg.type === 'cdp_event') {
      sendToBridge(msg.type, msg)
    }
  })
}

function init() {
  if (typeof chrome === 'undefined' || !chrome.runtime) return

  registerRuntimeMessageListener()

  if (hasAnnotations()) {
    bootstrapRuntime()
    return
  }

  waitForAnnotationsAndBootstrap()
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
