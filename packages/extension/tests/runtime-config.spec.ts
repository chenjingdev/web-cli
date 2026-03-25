import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const getConfigMock = vi.fn()

vi.mock('../src/shared/config.js', () => ({
  getConfig: getConfigMock,
}))

describe('syncStoredConfigToRuntime', () => {
  beforeEach(() => {
    getConfigMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads stored config and forwards it to the page runtime', async () => {
    const sendToBridge = vi.fn()
    getConfigMock.mockResolvedValue({
      autoScroll: true,
      auroraGlow: true,
      auroraTheme: 'light',
      clickDelayMs: 120,
      pointerDurationMs: 750,
      cursorName: 'default',
      pointerAnimation: true,
    })

    const { syncStoredConfigToRuntime } = await import('../src/content/runtime-config.js')
    await syncStoredConfigToRuntime(sendToBridge)

    expect(sendToBridge).toHaveBeenCalledWith('config_update', {
      autoScroll: true,
      auroraGlow: true,
      auroraTheme: 'light',
      clickDelayMs: 120,
      pointerDurationMs: 750,
      cursorName: 'default',
      pointerAnimation: true,
    })
  })

  it('swallows storage lookup failures and logs a warning', async () => {
    const sendToBridge = vi.fn()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = new Error('storage unavailable')
    getConfigMock.mockRejectedValue(error)

    const { syncStoredConfigToRuntime } = await import('../src/content/runtime-config.js')
    await syncStoredConfigToRuntime(sendToBridge)

    expect(sendToBridge).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      '[agrune-extension] failed to sync stored config to runtime',
      error,
    )
  })
})
