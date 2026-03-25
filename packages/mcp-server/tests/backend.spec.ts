import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { AgagruneBackend } from '../src/backend.js'
import type { NativeMessage } from '@agrune/core'

describe('AgagruneBackend agent activity lease', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses guard and tail blocks so agent activity stays on until the tail expires', async () => {
    const backend = new AgagruneBackend()
    const sent: NativeMessage[] = []
    backend.setNativeSender((msg) => {
      sent.push(msg)
    })

    backend.handleNativeMessage({
      type: 'session_open',
      tabId: 42,
      url: 'http://localhost:5173',
      title: 'Project Management Tool',
    } as NativeMessage)
    backend.handleNativeMessage({
      type: 'snapshot_update',
      tabId: 42,
      snapshot: {
        version: 1,
        capturedAt: Date.now(),
        url: 'http://localhost:5173',
        title: 'Project Management Tool',
        groups: [],
        targets: [],
      },
    } as NativeMessage)

    await backend.handleToolCall('agrune_snapshot', { tabId: 42 })

    expect(sent).toContainEqual({ type: 'agent_activity', active: true })

    await vi.advanceTimersByTimeAsync(4_000)
    expect(sent).not.toContainEqual({ type: 'agent_activity', active: false })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(sent).toContainEqual({ type: 'agent_activity', active: false })
  })

  it('returns outline snapshots by default and expands requested groups only', async () => {
    const backend = new AgagruneBackend()
    backend.setNativeSender(vi.fn())
    backend.handleNativeMessage({
      type: 'session_open',
      tabId: 42,
      url: 'http://localhost:5173',
      title: 'Project Management Tool',
    } as NativeMessage)
    backend.handleNativeMessage({
      type: 'snapshot_update',
      tabId: 42,
      snapshot: {
        version: 2,
        capturedAt: Date.now(),
        url: 'http://localhost:5173',
        title: 'Project Management Tool',
        groups: [],
        targets: [
          {
            targetId: 'tab-board',
            groupId: 'tabs',
            groupName: 'Navigation Tabs',
            groupDesc: 'Main navigation',
            name: 'Board Tab',
            description: 'Open board',
            actionKind: 'click',
            selector: '[data-agrune-key=\"tab-board\"]',
            visible: true,
            inViewport: true,
            enabled: true,
            covered: false,
            actionableNow: true,
            reason: 'ready',
            overlay: false,
            sensitive: false,
            textContent: 'Board',
            valuePreview: null,
            sourceFile: '',
            sourceLine: 0,
            sourceColumn: 0,
          },
        ],
      },
    } as NativeMessage)

    const outline = await backend.handleToolCall('agrune_snapshot', { tabId: 42 })
    expect(JSON.parse(outline.text)).toEqual({
      version: 2,
      url: 'http://localhost:5173',
      title: 'Project Management Tool',
      context: 'page',
      groups: [
        {
          groupId: 'tabs',
          groupName: 'Navigation Tabs',
          groupDesc: 'Main navigation',
          targetCount: 1,
          actionKinds: ['click'],
          sampleTargetNames: ['Board Tab'],
        },
      ],
    })

    const expanded = await backend.handleToolCall('agrune_snapshot', { tabId: 42, groupId: 'tabs' })
    expect(JSON.parse(expanded.text)).toEqual({
      version: 2,
      url: 'http://localhost:5173',
      title: 'Project Management Tool',
      context: 'page',
      targets: [
        {
          targetId: 'tab-board',
          groupId: 'tabs',
          name: 'Board Tab',
          description: 'Open board',
          actionKind: 'click',
        },
      ],
    })
  })

  it('includes textContent when includeTextContent is true', async () => {
    const backend = new AgagruneBackend()
    backend.setNativeSender(vi.fn())
    backend.handleNativeMessage({
      type: 'session_open',
      tabId: 42,
      url: 'http://localhost:5173',
      title: 'Test',
    } as NativeMessage)
    backend.handleNativeMessage({
      type: 'snapshot_update',
      tabId: 42,
      snapshot: {
        version: 1,
        capturedAt: Date.now(),
        url: 'http://localhost:5173',
        title: 'Test',
        groups: [],
        targets: [
          {
            targetId: 'btn',
            groupId: 'actions',
            name: 'Save',
            description: 'Save document',
            actionKind: 'click',
            selector: '[data-agrune-key="btn"]',
            visible: true,
            inViewport: true,
            enabled: true,
            covered: false,
            actionableNow: true,
            reason: 'ready',
            overlay: false,
            sensitive: false,
            textContent: 'Save',
            valuePreview: null,
            sourceFile: '',
            sourceLine: 0,
            sourceColumn: 0,
          },
        ],
      },
    } as NativeMessage)

    const result = await backend.handleToolCall('agrune_snapshot', {
      tabId: 42,
      groupId: 'actions',
      includeTextContent: true,
    })
    const parsed = JSON.parse(result.text)
    expect(parsed.targets[0].textContent).toBe('Save')

    const withoutText = await backend.handleToolCall('agrune_snapshot', {
      tabId: 42,
      groupId: 'actions',
    })
    const parsedWithout = JSON.parse(withoutText.text)
    expect(parsedWithout.targets[0].textContent).toBeUndefined()
  })
})

describe('ensureReady', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns error when native sender is null', async () => {
    const backend = new AgagruneBackend()
    // No sender set — waitForSender will timeout after 3s
    const promise = backend.handleToolCall('agrune_snapshot', {})
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await promise
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Native host not connected')
  })

  it('passes through immediately when session+snapshot exists', async () => {
    const backend = new AgagruneBackend()
    backend.setNativeSender(vi.fn())
    backend.handleNativeMessage({
      type: 'session_open', tabId: 1, url: 'https://a.com', title: 'A',
    } as NativeMessage)
    backend.handleNativeMessage({
      type: 'snapshot_update', tabId: 1,
      snapshot: { version: 1, capturedAt: Date.now(), url: 'https://a.com', title: 'A', groups: [], targets: [] },
    } as NativeMessage)

    const result = await backend.handleToolCall('agrune_sessions', {})
    expect(result.isError).toBeFalsy()
  })

  it('sends resync_request and waits for snapshot when no session exists', async () => {
    const sent: NativeMessage[] = []
    const backend = new AgagruneBackend()
    backend.setNativeSender((msg) => sent.push(msg))

    const promise = backend.handleToolCall('agrune_snapshot', {})

    // ensureReady should have sent resync_request
    expect(sent).toContainEqual({ type: 'resync_request' })

    // Simulate resync response
    backend.handleNativeMessage({
      type: 'session_open', tabId: 1, url: 'https://a.com', title: 'A',
    } as NativeMessage)
    backend.handleNativeMessage({
      type: 'snapshot_update', tabId: 1,
      snapshot: { version: 1, capturedAt: Date.now(), url: 'https://a.com', title: 'A', groups: [], targets: [] },
    } as NativeMessage)

    const result = await promise
    expect(result.isError).toBeFalsy()
  })

  it('deduplicates concurrent resync_request messages', async () => {
    const sent: NativeMessage[] = []
    const backend = new AgagruneBackend()
    backend.setNativeSender((msg) => sent.push(msg))

    // Fire two concurrent tool calls — should only send one resync_request
    const p1 = backend.handleToolCall('agrune_sessions', {})
    const p2 = backend.handleToolCall('agrune_snapshot', {})

    const resyncCount = sent.filter(m => m.type === 'resync_request').length
    expect(resyncCount).toBe(1)

    // Resolve both by providing session+snapshot
    backend.handleNativeMessage({
      type: 'session_open', tabId: 1, url: 'https://a.com', title: 'A',
    } as NativeMessage)
    backend.handleNativeMessage({
      type: 'snapshot_update', tabId: 1,
      snapshot: { version: 1, capturedAt: Date.now(), url: 'https://a.com', title: 'A', groups: [], targets: [] },
    } as NativeMessage)

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.isError).toBeFalsy()
    expect(r2.isError).toBeFalsy()
  })

  it('returns timeout error when no snapshot arrives within 3s', async () => {
    const backend = new AgagruneBackend()
    backend.setNativeSender(vi.fn())

    const promise = backend.handleToolCall('agrune_snapshot', {})
    await vi.advanceTimersByTimeAsync(10_000)

    const result = await promise
    expect(result.isError).toBe(true)
    expect(result.text).toContain('No browser sessions available')
  })

  it('skips ensureReady for agrune_config even without a native sender', async () => {
    const backend = new AgagruneBackend()
    // No sender set — ensureReady would return "Native host not connected" error,
    // but agrune_config should skip ensureReady entirely
    const result = await backend.handleToolCall('agrune_config', { autoScroll: true })
    expect(result.isError).toBeFalsy()
    expect(result.text).toBe('Configuration updated.')
  })
})

describe('onActivity callback', () => {
  it('calls onActivity on each handleToolCall', async () => {
    const backend = new AgagruneBackend()
    const onActivity = vi.fn()
    backend.onActivity = onActivity
    backend.setNativeSender(vi.fn())
    backend.handleNativeMessage({
      type: 'session_open', tabId: 1, url: 'https://a.com', title: 'A',
    } as NativeMessage)
    backend.handleNativeMessage({
      type: 'snapshot_update', tabId: 1,
      snapshot: { version: 1, capturedAt: Date.now(), url: 'https://a.com', title: 'A', groups: [], targets: [] },
    } as NativeMessage)

    await backend.handleToolCall('agrune_sessions', {})
    expect(onActivity).toHaveBeenCalledTimes(1)
  })
})
