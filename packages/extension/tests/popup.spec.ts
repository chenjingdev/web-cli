import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const getConfigMock = vi.fn()
const setConfigMock = vi.fn()

vi.mock('../src/shared/config.js', () => ({
  getConfig: getConfigMock,
  setConfig: setConfigMock,
}))

type NativeHostStatus = {
  connected: boolean
  phase: 'disconnected' | 'connecting' | 'connected' | 'error'
  hostName: string
  lastError?: string
}

let messageListener: ((msg: { type: string; [key: string]: unknown }) => void) | null = null
let sendMessageMock: ReturnType<typeof vi.fn>

function setupDom(): void {
  document.body.innerHTML = `
    <h1>rune Options</h1>
    <section class="status-card" aria-label="Native host status">
      <div class="status-header">
        <span class="status-label">Native host</span>
        <span id="hostStatusBadge" class="status-pill" data-phase="connecting">Connecting</span>
      </div>
      <p id="hostStatusDetail" class="status-detail">Waiting for com.runeai.rune</p>
      <div class="status-actions">
        <button type="button" id="reconnectNativeHost">Reconnect</button>
      </div>
    </section>

    <label>
      <input type="checkbox" id="pointerAnimation" />
      <span>Pointer Animation</span>
    </label>

    <label>
      <input type="checkbox" id="auroraGlow" />
      <span>Aurora Glow</span>
    </label>

    <label>
      <span>Theme</span>
      <select id="auroraTheme">
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
    </label>

    <hr class="divider" />

    <label class="number-label">
      <span>Click Delay (ms)</span>
      <input type="number" id="clickDelayMs" min="0" max="2000" step="50" />
    </label>

    <label>
      <input type="checkbox" id="autoScroll" />
      <span>Auto Scroll</span>
    </label>
  `
}

function createChromeMock(initialStatus: NativeHostStatus) {
  sendMessageMock = vi.fn((message: { type: string }, callback?: (response?: unknown) => void) => {
    if (message.type === 'get_native_host_status') {
      callback?.({ status: initialStatus })
      return
    }

    callback?.({})
  })

  return {
    runtime: {
      sendMessage: sendMessageMock,
      onMessage: {
        addListener: vi.fn((listener: typeof messageListener) => {
          messageListener = listener
        }),
      },
      lastError: undefined,
    },
  }
}

async function loadPopup(): Promise<void> {
  await import('../src/popup/popup.js')
}

describe('popup', () => {
  beforeEach(() => {
    vi.resetModules()
    setupDom()
    getConfigMock.mockReset()
    setConfigMock.mockReset()
    messageListener = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads config, queries host status, and wires reconnect', async () => {
    getConfigMock.mockResolvedValue({
      autoScroll: true,
      auroraGlow: false,
      auroraTheme: 'dark',
      clickDelayMs: 50,
      cursorName: 'default',
      pointerAnimation: true,
    })
    setConfigMock.mockResolvedValue({
      autoScroll: true,
      auroraGlow: false,
      auroraTheme: 'dark',
      clickDelayMs: 50,
      cursorName: 'default',
      pointerAnimation: true,
    })

    vi.stubGlobal(
      'chrome',
      createChromeMock({
        connected: true,
        phase: 'connected',
        hostName: 'com.runeai.rune',
      }) as never,
    )

    await loadPopup()
    document.dispatchEvent(new Event('DOMContentLoaded'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sendMessageMock).toHaveBeenCalledWith(
      { type: 'get_native_host_status' },
      expect.any(Function),
    )
    expect(document.getElementById('hostStatusBadge')?.textContent).toBe('Connected')
    expect(document.getElementById('hostStatusDetail')?.textContent).toBe('Connected to com.runeai.rune')

    document.getElementById('reconnectNativeHost')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sendMessageMock).toHaveBeenCalledWith(
      { type: 'reconnect_native_host' },
      expect.any(Function),
    )
  })

  it('renders native host status broadcasts and continues to broadcast config changes', async () => {
    const initialConfig = {
      autoScroll: false,
      auroraGlow: true,
      auroraTheme: 'light',
      clickDelayMs: 120,
      cursorName: 'default',
      pointerAnimation: false,
    } as const

    getConfigMock.mockResolvedValue(initialConfig)
    setConfigMock.mockImplementation(async (partial: Record<string, unknown>) => ({
      ...initialConfig,
      ...partial,
    }))

    vi.stubGlobal(
      'chrome',
      createChromeMock({
        connected: false,
        phase: 'disconnected',
        hostName: 'com.runeai.rune',
      }) as never,
    )

    await loadPopup()
    document.dispatchEvent(new Event('DOMContentLoaded'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    messageListener?.({
      type: 'native_host_status_changed',
      status: {
        connected: false,
        phase: 'error',
        hostName: 'com.runeai.rune',
        lastError: 'native host not found',
      },
    })

    expect(document.getElementById('hostStatusBadge')?.textContent).toBe('Error')
    expect(document.getElementById('hostStatusBadge')?.getAttribute('data-phase')).toBe('error')
    expect(document.getElementById('hostStatusDetail')?.textContent).toBe(
      'com.runeai.rune: native host not found',
    )

    const pointerAnimation = document.getElementById('pointerAnimation') as HTMLInputElement
    pointerAnimation.checked = true
    pointerAnimation.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sendMessageMock).toHaveBeenCalledWith({
      type: 'config_broadcast',
      config: expect.objectContaining({
        pointerAnimation: true,
      }),
    })
  })
})
