import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionDriver } from '../src/extension-driver.js'
import type { NativeMessage, PageSnapshot } from '@agrune/core'

function makeSnapshot(overrides?: Partial<PageSnapshot>): PageSnapshot {
  return {
    version: 1,
    capturedAt: Date.now(),
    url: 'http://localhost:5173',
    title: 'Test',
    groups: [],
    targets: [],
    ...overrides,
  }
}

describe('ExtensionDriver agent activity lease', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses guard and tail blocks so agent activity stays on until the tail expires', async () => {
    const driver = new ExtensionDriver()
    const sent: NativeMessage[] = []
    driver.setNativeSender((msg) => {
      sent.push(msg)
    })

    driver.handleNativeMessage({
      type: 'session_open',
      tabId: 42,
      url: 'http://localhost:5173',
      title: 'Project Management Tool',
    } as NativeMessage)
    driver.handleNativeMessage({
      type: 'snapshot_update',
      tabId: 42,
      snapshot: makeSnapshot(),
    } as NativeMessage)

    // execute() wraps with activity blocks
    const commandPromise = driver.execute(42, { kind: 'act', targetId: 'btn' })

    // Resolve the command
    const sentCommand = sent.find((m) => m.type === 'command_request')
    expect(sentCommand).toBeDefined()
    const commandId = (sentCommand as any).commandId

    driver.handleNativeMessage({
      type: 'command_result',
      tabId: 42,
      commandId,
      result: { commandId, ok: true },
    } as NativeMessage)

    await commandPromise

    expect(sent).toContainEqual({ type: 'agent_activity', active: true })

    await vi.advanceTimersByTimeAsync(4_000)
    expect(sent).not.toContainEqual({ type: 'agent_activity', active: false })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(sent).toContainEqual({ type: 'agent_activity', active: false })
  })
})

describe('ExtensionDriver handleNativeMessage', () => {
  it('tracks sessions opened and closed via native messages', () => {
    const driver = new ExtensionDriver()
    driver.setNativeSender(vi.fn())

    driver.handleNativeMessage({
      type: 'session_open',
      tabId: 42,
      url: 'http://localhost:5173',
      title: 'Test',
    } as NativeMessage)

    const sessions = driver.listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ tabId: 42, url: 'http://localhost:5173', hasSnapshot: false })

    driver.handleNativeMessage({
      type: 'session_close',
      tabId: 42,
    } as NativeMessage)

    expect(driver.listSessions()).toHaveLength(0)
  })

  it('updates snapshot from snapshot_update message', () => {
    const driver = new ExtensionDriver()
    driver.setNativeSender(vi.fn())

    driver.handleNativeMessage({
      type: 'session_open',
      tabId: 42,
      url: 'http://localhost:5173',
      title: 'Test',
    } as NativeMessage)

    const snapshot = makeSnapshot({ version: 3 })
    driver.handleNativeMessage({
      type: 'snapshot_update',
      tabId: 42,
      snapshot,
    } as NativeMessage)

    expect(driver.getSnapshot(42)).toEqual(snapshot)
    expect(driver.listSessions()[0].hasSnapshot).toBe(true)
  })

  it('updates snapshot from command_result that includes a snapshot', () => {
    const driver = new ExtensionDriver()
    driver.setNativeSender(vi.fn())

    driver.handleNativeMessage({
      type: 'session_open',
      tabId: 42,
      url: 'http://localhost:5173',
      title: 'Test',
    } as NativeMessage)
    driver.handleNativeMessage({
      type: 'snapshot_update',
      tabId: 42,
      snapshot: makeSnapshot({ version: 1 }),
    } as NativeMessage)

    const newSnapshot = makeSnapshot({ version: 2 })
    driver.handleNativeMessage({
      type: 'command_result',
      tabId: 42,
      commandId: 'cmd-1',
      result: {
        commandId: 'cmd-1',
        ok: true,
        snapshot: newSnapshot,
      },
    } as NativeMessage)

    expect(driver.getSnapshot(42)).toEqual(newSnapshot)
  })

  it('responds to ping with pong', () => {
    const sent: NativeMessage[] = []
    const driver = new ExtensionDriver()
    driver.setNativeSender((msg) => sent.push(msg))

    driver.handleNativeMessage({ type: 'ping' } as NativeMessage)

    expect(sent).toContainEqual({ type: 'pong' })
  })

  it('responds to get_status with status_response', () => {
    const sent: NativeMessage[] = []
    const driver = new ExtensionDriver()
    driver.setNativeSender((msg) => sent.push(msg))

    driver.handleNativeMessage({
      type: 'session_open',
      tabId: 1,
      url: 'https://a.com',
      title: 'A',
    } as NativeMessage)

    driver.handleNativeMessage({ type: 'get_status' } as NativeMessage)

    const statusMsg = sent.find((m) => m.type === 'status_response')
    expect(statusMsg).toBeDefined()
    expect((statusMsg as any).status.sessionCount).toBe(1)
    expect((statusMsg as any).status.connected).toBe(true)
  })

  it('fires onSessionOpen callbacks', () => {
    const driver = new ExtensionDriver()
    driver.setNativeSender(vi.fn())

    const opened: unknown[] = []
    driver.onSessionOpen((session) => opened.push(session))

    driver.handleNativeMessage({
      type: 'session_open',
      tabId: 42,
      url: 'http://localhost:5173',
      title: 'Test',
    } as NativeMessage)

    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ tabId: 42, url: 'http://localhost:5173', hasSnapshot: false })
  })

  it('fires onSessionClose callbacks', () => {
    const driver = new ExtensionDriver()
    driver.setNativeSender(vi.fn())

    const closed: number[] = []
    driver.onSessionClose((tabId) => closed.push(tabId))

    driver.handleNativeMessage({
      type: 'session_open',
      tabId: 42,
      url: 'http://localhost:5173',
      title: 'Test',
    } as NativeMessage)
    driver.handleNativeMessage({
      type: 'session_close',
      tabId: 42,
    } as NativeMessage)

    expect(closed).toEqual([42])
  })

  it('fires onSnapshotUpdate callbacks', () => {
    const driver = new ExtensionDriver()
    driver.setNativeSender(vi.fn())

    const updates: Array<{ tabId: number; snapshot: PageSnapshot }> = []
    driver.onSnapshotUpdate((tabId, snapshot) => updates.push({ tabId, snapshot }))

    driver.handleNativeMessage({
      type: 'session_open',
      tabId: 42,
      url: 'http://localhost:5173',
      title: 'Test',
    } as NativeMessage)

    const snapshot = makeSnapshot({ version: 5 })
    driver.handleNativeMessage({
      type: 'snapshot_update',
      tabId: 42,
      snapshot,
    } as NativeMessage)

    expect(updates).toHaveLength(1)
    expect(updates[0].tabId).toBe(42)
    expect(updates[0].snapshot).toEqual(snapshot)
  })
})

describe('ExtensionDriver ensureReady', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns error when native sender is null', async () => {
    const driver = new ExtensionDriver()
    // No sender set — waitForSender will timeout
    const promise = driver.ensureReady()
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await promise
    expect(result).toContain('Native host not connected')
  })

  it('returns null immediately when session+snapshot exists', async () => {
    const driver = new ExtensionDriver()
    driver.setNativeSender(vi.fn())
    driver.handleNativeMessage({
      type: 'session_open', tabId: 1, url: 'https://a.com', title: 'A',
    } as NativeMessage)
    driver.handleNativeMessage({
      type: 'snapshot_update', tabId: 1,
      snapshot: makeSnapshot(),
    } as NativeMessage)

    const result = await driver.ensureReady()
    expect(result).toBeNull()
  })

  it('sends resync_request and waits for snapshot when no session exists', async () => {
    const sent: NativeMessage[] = []
    const driver = new ExtensionDriver()
    driver.setNativeSender((msg) => sent.push(msg))

    const promise = driver.ensureReady()

    // ensureReady should have sent resync_request
    expect(sent).toContainEqual({ type: 'resync_request' })

    // Simulate resync response
    driver.handleNativeMessage({
      type: 'session_open', tabId: 1, url: 'https://a.com', title: 'A',
    } as NativeMessage)
    driver.handleNativeMessage({
      type: 'snapshot_update', tabId: 1,
      snapshot: makeSnapshot(),
    } as NativeMessage)

    const result = await promise
    expect(result).toBeNull()
  })

  it('deduplicates concurrent resync_request messages', async () => {
    const sent: NativeMessage[] = []
    const driver = new ExtensionDriver()
    driver.setNativeSender((msg) => sent.push(msg))

    // Fire two concurrent ensureReady calls — should only send one resync_request
    const p1 = driver.ensureReady()
    const p2 = driver.ensureReady()

    const resyncCount = sent.filter((m) => m.type === 'resync_request').length
    expect(resyncCount).toBe(1)

    // Resolve both by providing session+snapshot
    driver.handleNativeMessage({
      type: 'session_open', tabId: 1, url: 'https://a.com', title: 'A',
    } as NativeMessage)
    driver.handleNativeMessage({
      type: 'snapshot_update', tabId: 1,
      snapshot: makeSnapshot(),
    } as NativeMessage)

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBeNull()
    expect(r2).toBeNull()
  })

  it('returns timeout error when no snapshot arrives within timeout', async () => {
    const driver = new ExtensionDriver()
    driver.setNativeSender(vi.fn())

    const promise = driver.ensureReady()
    await vi.advanceTimersByTimeAsync(10_000)

    const result = await promise
    expect(result).toContain('No browser sessions available')
  })
})

describe('ExtensionDriver resolveTabId', () => {
  it('returns explicit tabId when provided', () => {
    const driver = new ExtensionDriver()
    expect(driver.resolveTabId(42)).toBe(42)
  })

  it('returns first session tabId when none provided', () => {
    const driver = new ExtensionDriver()
    driver.handleNativeMessage({
      type: 'session_open', tabId: 7, url: 'https://a.com', title: 'A',
    } as NativeMessage)
    expect(driver.resolveTabId()).toBe(7)
  })

  it('returns null when no sessions and no tabId', () => {
    const driver = new ExtensionDriver()
    expect(driver.resolveTabId()).toBeNull()
  })
})

describe('ExtensionDriver BrowserDriver interface', () => {
  it('isConnected reflects sender state', () => {
    const driver = new ExtensionDriver()
    expect(driver.isConnected()).toBe(false)

    driver.setNativeSender(vi.fn())
    expect(driver.isConnected()).toBe(true)
  })

  it('disconnect clears the sender', async () => {
    const driver = new ExtensionDriver()
    driver.setNativeSender(vi.fn())
    expect(driver.isConnected()).toBe(true)

    await driver.disconnect()
    expect(driver.isConnected()).toBe(false)
  })

  it('sendRaw forwards message through sender', () => {
    const sent: NativeMessage[] = []
    const driver = new ExtensionDriver()
    driver.setNativeSender((msg) => sent.push(msg))

    driver.sendRaw({ type: 'resync_request' } as NativeMessage)
    expect(sent).toContainEqual({ type: 'resync_request' })
  })
})
