/**
 * CDP bridge relay tests — exercises the content/index.ts wiring that relays
 * CDP messages between page runtime (bridge) and background (chrome.runtime).
 */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  let bridgeHandler: ((type: string, data: unknown) => void) | null = null
  let runtimeListener: ((msg: unknown) => void) | null = null

  return {
    getBridgeHandler: () => bridgeHandler,
    setBridgeHandler: (h: ((type: string, data: unknown) => void) | null) => {
      bridgeHandler = h
    },
    getRuntimeListener: () => runtimeListener,
    setRuntimeListener: (h: ((msg: unknown) => void) | null) => {
      runtimeListener = h
    },
    sendToBridge: vi.fn(),
    setupBridge: vi.fn((handler: (type: string, data: unknown) => void) => {
      bridgeHandler = handler
      return () => {
        bridgeHandler = null
      }
    }),
    sendMessage: vi.fn(),
    addListener: vi.fn((listener: (msg: unknown) => void) => {
      runtimeListener = listener
    }),
    scanAnnotations: vi.fn(() => [{ id: 'btn' }]),
    scanGroups: vi.fn(() => []),
    buildManifest: vi.fn(() => ({ targets: [], groups: [] })),
    injectRuntime: vi.fn(),
    syncStoredConfigToRuntime: vi.fn(),
    showHighlight: vi.fn(),
    clearHighlight: vi.fn(),
  }
})

vi.mock('../src/content/bridge', () => ({
  setupBridge: mocks.setupBridge,
  sendToBridge: mocks.sendToBridge,
  BRIDGE_MESSAGE_KEY: '__agrune_bridge__',
  createBridgeMessage: vi.fn(),
  isBridgeMessage: vi.fn(),
}))

vi.mock('../src/content/dom-scanner', () => ({
  scanAnnotations: mocks.scanAnnotations,
  scanGroups: mocks.scanGroups,
}))

vi.mock('../src/content/manifest-builder', () => ({
  buildManifest: mocks.buildManifest,
}))

vi.mock('../src/content/runtime-injector', () => ({
  injectRuntime: mocks.injectRuntime,
}))

vi.mock('../src/content/runtime-config', () => ({
  syncStoredConfigToRuntime: mocks.syncStoredConfigToRuntime,
}))

vi.mock('../src/content/highlight-overlay', () => ({
  showHighlight: mocks.showHighlight,
  clearHighlight: mocks.clearHighlight,
}))

describe('CDP bridge relay (content/index.ts)', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.setBridgeHandler(null)
    mocks.setRuntimeListener(null)

    document.body.innerHTML = '<button data-agrune-action="click">Login</button>'
    ;(globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: mocks.sendMessage,
        onMessage: {
          addListener: mocks.addListener,
        },
      },
    }

    await import('../src/content/index')
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('relays cdp_request from page to background', () => {
    const cdpRequest = { type: 'cdp_request', method: 'DOM.getDocument', id: 1 }
    // Simulate page runtime posting a cdp_request via the bridge
    mocks.getBridgeHandler()?.('cdp_request', cdpRequest)

    expect(mocks.sendMessage).toHaveBeenCalledWith(cdpRequest)
  })

  it('relays cdp_response from background to page', () => {
    const cdpResponse = { type: 'cdp_response', id: 1, result: { root: {} } }
    // Simulate background sending cdp_response via chrome.runtime.onMessage
    mocks.getRuntimeListener()?.({ type: 'cdp_response', id: 1, result: { root: {} } })

    expect(mocks.sendToBridge).toHaveBeenCalledWith('cdp_response', cdpResponse)
  })

  it('relays cdp_event from background to page', () => {
    const cdpEvent = { type: 'cdp_event', method: 'DOM.documentUpdated', params: {} }
    // Simulate background sending cdp_event via chrome.runtime.onMessage
    mocks.getRuntimeListener()?.({ type: 'cdp_event', method: 'DOM.documentUpdated', params: {} })

    expect(mocks.sendToBridge).toHaveBeenCalledWith('cdp_event', cdpEvent)
  })
})
