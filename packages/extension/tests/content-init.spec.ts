import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  let bridgeHandler: ((type: string, data: unknown) => void) | null = null
  const order: string[] = []

  return {
    order,
    getBridgeHandler: () => bridgeHandler,
    setBridgeHandler: (handler: ((type: string, data: unknown) => void) | null) => {
      bridgeHandler = handler
    },
    scanAnnotations: vi.fn(() => [{ id: 'login' }]),
    scanGroups: vi.fn(() => []),
    buildManifest: vi.fn(() => ({ targets: [], groups: [] })),
    sendToBridge: vi.fn(),
    syncStoredConfigToRuntime: vi.fn(),
    injectRuntime: vi.fn(() => {
      mocks.order.push('inject')
      mocks.getBridgeHandler()?.('bridge_loaded', {})
    }),
    setupBridge: vi.fn((handler: (type: string, data: unknown) => void) => {
      mocks.order.push('setup')
      mocks.setBridgeHandler(handler)
      return () => {
        mocks.setBridgeHandler(null)
      }
    }),
  }
})

vi.mock('../src/content/dom-scanner', () => ({
  scanAnnotations: mocks.scanAnnotations,
  scanGroups: mocks.scanGroups,
}))

vi.mock('../src/content/manifest-builder', () => ({
  buildManifest: mocks.buildManifest,
}))

vi.mock('../src/content/bridge', () => ({
  setupBridge: mocks.setupBridge,
  sendToBridge: mocks.sendToBridge,
}))

vi.mock('../src/content/runtime-injector', () => ({
  injectRuntime: mocks.injectRuntime,
}))

vi.mock('../src/content/runtime-config', () => ({
  syncStoredConfigToRuntime: mocks.syncStoredConfigToRuntime,
}))

describe('content bootstrap', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.order.length = 0
    mocks.setBridgeHandler(null)

    document.body.innerHTML = '<button data-rune-action="click">Login</button>'
    ;(globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: vi.fn(),
        onMessage: {
          addListener: vi.fn(),
        },
      },
    }
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('registers the bridge listener before injecting the runtime', async () => {
    await import('../src/content/index')

    expect(mocks.order).toEqual(['setup', 'inject'])
    expect(mocks.sendToBridge).toHaveBeenCalledWith(
      'init_runtime',
      expect.objectContaining({
        manifest: expect.any(Object),
        options: {},
      }),
    )
  })
})
