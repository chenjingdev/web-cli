import { describe, expect, it } from 'vitest'
import type { CommandResult, PageSnapshot } from '@webcli-dom/core'
import {
  toPublicCommandResult,
  toPublicSession,
  toPublicSnapshot,
} from '../src/public-shapes.js'

describe('public MCP shapes', () => {
  it('sessions omit embedded snapshots and expose summary fields only', () => {
    const session = {
      tabId: 42,
      url: 'http://localhost:5173',
      title: '',
      openedAt: 1,
      snapshot: {
        version: 3,
        capturedAt: 1,
        url: 'http://localhost:5173',
        title: 'Project Management Tool',
        groups: [],
        targets: [],
      },
    }

    expect(toPublicSession(session)).toEqual({
      tabId: 42,
      url: 'http://localhost:5173',
      title: 'Project Management Tool',
      hasSnapshot: true,
      snapshotVersion: 3,
    })
  })

  it('snapshots keep descriptions but omit runtime-only fields', () => {
    const snapshot: PageSnapshot = {
      version: 7,
      capturedAt: 123,
      url: 'http://localhost:5173',
      title: 'Project Management Tool',
      groups: [
        {
          groupId: 'tabs',
          groupName: 'Navigation Tabs',
          groupDesc: 'Main navigation',
          targetIds: ['tab-board'],
        },
      ],
      targets: [
        {
          targetId: 'tab-board',
          groupId: 'tabs',
          groupName: 'Navigation Tabs',
          groupDesc: 'Main navigation',
          name: 'Board Tab',
          description: 'Open the board view',
          actionKind: 'click',
          selector: '[data-webcli-key="tab-board"]',
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
          sourceFile: 'App.tsx',
          sourceLine: 10,
          sourceColumn: 4,
        },
      ],
    }

    expect(toPublicSnapshot(snapshot)).toEqual({
      version: 7,
      url: 'http://localhost:5173',
      title: 'Project Management Tool',
      groups: [
        {
          groupId: 'tabs',
          groupName: 'Navigation Tabs',
          groupDesc: 'Main navigation',
          targetIds: ['tab-board'],
        },
      ],
      targets: [
        {
          targetId: 'tab-board',
          groupId: 'tabs',
          groupName: 'Navigation Tabs',
          groupDesc: 'Main navigation',
          name: 'Board Tab',
          description: 'Open the board view',
          actionKind: 'click',
          visible: true,
          enabled: true,
          reason: 'ready',
          sensitive: false,
          textContent: 'Board',
        },
      ],
    })
  })

  it('command results omit embedded snapshots', () => {
    const result: CommandResult = {
      commandId: 'tab-board',
      ok: true,
      result: { actionKind: 'click', targetId: 'tab-board' },
      snapshotVersion: 9,
      snapshot: {
        version: 9,
        capturedAt: 1,
        url: 'http://localhost:5173',
        title: 'Project Management Tool',
        groups: [],
        targets: [],
      },
    }

    expect(toPublicCommandResult(result)).toEqual({
      commandId: 'tab-board',
      ok: true,
      result: { actionKind: 'click', targetId: 'tab-board' },
      snapshotVersion: 9,
    })
  })
})
