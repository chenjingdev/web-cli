import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { RuneBackend } from '../src/backend.js'
import type { NativeMessage } from '@runeai/core'

describe('RuneBackend agent activity lease', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses guard and tail blocks so agent activity stays on until the tail expires', async () => {
    const backend = new RuneBackend()
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

    await backend.handleToolCall('rune_snapshot', { tabId: 42 })

    expect(sent).toContainEqual({ type: 'agent_activity', active: true })

    await vi.advanceTimersByTimeAsync(4_000)
    expect(sent).not.toContainEqual({ type: 'agent_activity', active: false })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(sent).toContainEqual({ type: 'agent_activity', active: false })
  })

  it('returns outline snapshots by default and expands requested groups only', async () => {
    const backend = new RuneBackend()
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
            selector: '[data-rune-key=\"tab-board\"]',
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

    const outline = await backend.handleToolCall('rune_snapshot', { tabId: 42 })
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

    const expanded = await backend.handleToolCall('rune_snapshot', { tabId: 42, groupId: 'tabs' })
    expect(JSON.parse(expanded.text)).toEqual({
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
      targets: [
        {
          targetId: 'tab-board',
          groupId: 'tabs',
          name: 'Board Tab',
          description: 'Open board',
          actionKind: 'click',
          reason: 'ready',
          sensitive: false,
        },
      ],
    })
  })
})
