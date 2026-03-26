import { describe, it, expect } from 'vitest'
import { buildManifest } from '../src/content/manifest-builder'
import type { ScannedTarget, ScannedGroup } from '../src/content/dom-scanner'

describe('buildManifest', () => {
  it('returns a valid manifest with version 2 for empty input', () => {
    const manifest = buildManifest([], [])
    expect(manifest.version).toBe(2)
    expect(manifest.groups).toEqual([])
    expect(manifest.exposureMode).toBe('per-element')
    expect(manifest.generatedAt).toBeTruthy()
  })

  it('converts a single target into a manifest with a default group', () => {
    const targets: ScannedTarget[] = [
      {
        targetId: 'btn1',
        selector: '[data-agrune-key="btn1"]',
        name: 'Submit',
        description: 'Submit button',
        actionKinds: ['click'],
        sensitive: false,
      },
    ]

    const manifest = buildManifest(targets, [])
    expect(manifest.version).toBe(2)
    expect(manifest.groups).toHaveLength(1)

    const group = manifest.groups[0]
    expect(group.groupId).toBe('default')
    expect(group.groupName).toBe('Default')
    expect(group.tools).toHaveLength(1)

    const tool = group.tools[0]
    expect(tool.toolName).toBe('Submit')
    expect(tool.toolDesc).toBe('Submit button')
    expect(tool.action).toBe('click')
    expect(tool.status).toBe('active')
    expect(tool.targets).toHaveLength(1)
    expect(tool.targets[0]).toMatchObject({
      targetId: 'btn1',
      selector: '[data-agrune-key="btn1"]',
      name: 'Submit',
      desc: 'Submit button',
    })
  })

  it('groups targets by groupId using scanned group metadata', () => {
    const targets: ScannedTarget[] = [
      {
        targetId: 'login-btn',
        selector: '[data-agrune-key="login-btn"]',
        name: 'Login',
        description: 'Login button',
        actionKinds: ['click'],
        groupId: 'auth',
        sensitive: false,
      },
      {
        targetId: 'email',
        selector: '[data-agrune-key="email"]',
        name: 'Email',
        description: 'Email input',
        actionKinds: ['fill'],
        groupId: 'auth',
        sensitive: false,
      },
    ]

    const groups: ScannedGroup[] = [
      {
        groupId: 'auth',
        name: 'Authentication',
        description: 'Auth section',
      },
    ]

    const manifest = buildManifest(targets, groups)
    expect(manifest.groups).toHaveLength(1)

    const group = manifest.groups[0]
    expect(group.groupId).toBe('auth')
    expect(group.groupName).toBe('Authentication')
    expect(group.groupDesc).toBe('Auth section')
    expect(group.tools).toHaveLength(2)
    expect(group.tools[0].toolName).toBe('Login')
    expect(group.tools[1].toolName).toBe('Email')
  })

  it('handles targets with and without groups', () => {
    const targets: ScannedTarget[] = [
      {
        targetId: 'btn1',
        selector: '[data-agrune-key="btn1"]',
        name: 'Grouped',
        description: 'In a group',
        actionKinds: ['click'],
        groupId: 'nav',
        sensitive: false,
      },
      {
        targetId: 'btn2',
        selector: '[data-agrune-key="btn2"]',
        name: 'Ungrouped',
        description: 'No group',
        actionKinds: ['click'],
        sensitive: false,
      },
    ]

    const groups: ScannedGroup[] = [
      { groupId: 'nav', name: 'Navigation', description: 'Nav links' },
    ]

    const manifest = buildManifest(targets, groups)
    expect(manifest.groups).toHaveLength(2)

    const navGroup = manifest.groups.find((g) => g.groupId === 'nav')
    const defaultGroup = manifest.groups.find((g) => g.groupId === 'default')

    expect(navGroup).toBeDefined()
    expect(navGroup!.tools).toHaveLength(1)
    expect(navGroup!.tools[0].toolName).toBe('Grouped')

    expect(defaultGroup).toBeDefined()
    expect(defaultGroup!.tools).toHaveLength(1)
    expect(defaultGroup!.tools[0].toolName).toBe('Ungrouped')
  })

  it('uses targetId as toolName when name is empty', () => {
    const targets: ScannedTarget[] = [
      {
        targetId: 'agrune_0',
        selector: '[data-agrune-action]',
        name: '',
        description: '',
        actionKinds: ['click'],
        sensitive: false,
      },
    ]

    const manifest = buildManifest(targets, [])
    expect(manifest.groups[0].tools[0].toolName).toBe('agrune_0')
  })

  it('sets sourceFile/sourceLine/sourceColumn to defaults for DOM-scanned targets', () => {
    const targets: ScannedTarget[] = [
      {
        targetId: 'btn1',
        selector: '[data-agrune-key="btn1"]',
        name: 'Click Me',
        description: 'A button',
        actionKinds: ['click'],
        sensitive: false,
      },
    ]

    const manifest = buildManifest(targets, [])
    const target = manifest.groups[0].tools[0].targets[0]
    expect(target.sourceFile).toBe('')
    expect(target.sourceLine).toBe(0)
    expect(target.sourceColumn).toBe(0)
  })

  it('converts multi-action target into tool with comma-joined action', () => {
    const targets: ScannedTarget[] = [
      {
        targetId: 'card1',
        selector: '[data-agrune-key="card1"]',
        name: 'Task Card',
        description: '클릭으로 선택, 더블클릭으로 상세 보기',
        actionKinds: ['click', 'dblclick'],
        sensitive: false,
      },
    ]

    const manifest = buildManifest(targets, [])
    const tool = manifest.groups[0].tools[0]
    expect(tool.action).toBe('click,dblclick')
  })
})
