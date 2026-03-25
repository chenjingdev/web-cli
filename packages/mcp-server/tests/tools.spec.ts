import { describe, it, expect } from 'vitest'
import { getToolDefinitions } from '../src/tools'

describe('getToolDefinitions', () => {
  const tools = getToolDefinitions()

  it('defines all 8 required tools', () => {
    const names = tools.map((t) => t.name)
    expect(names).toEqual([
      'agrune_sessions',
      'agrune_snapshot',
      'agrune_act',
      'agrune_fill',
      'agrune_drag',
      'agrune_wait',
      'agrune_guide',
      'agrune_config',
    ])
  })

  it('every tool has name, description, and inputSchema', () => {
    for (const tool of tools) {
      expect(tool.name).toBeTypeOf('string')
      expect(tool.description).toBeTypeOf('string')
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.inputSchema).toBeDefined()
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('agrune_act requires targetId', () => {
    const act = tools.find((t) => t.name === 'agrune_act')!
    expect(act.inputSchema.required).toContain('targetId')
  })

  it('agrune_fill requires targetId and value', () => {
    const fill = tools.find((t) => t.name === 'agrune_fill')!
    expect(fill.inputSchema.required).toContain('targetId')
    expect(fill.inputSchema.required).toContain('value')
  })

  it('agrune_drag requires sourceTargetId and destinationTargetId', () => {
    const drag = tools.find((t) => t.name === 'agrune_drag')!
    expect(drag.inputSchema.required).toContain('sourceTargetId')
    expect(drag.inputSchema.required).toContain('destinationTargetId')
  })

  it('agrune_wait requires targetId and state', () => {
    const wait = tools.find((t) => t.name === 'agrune_wait')!
    expect(wait.inputSchema.required).toContain('targetId')
    expect(wait.inputSchema.required).toContain('state')
  })

  it('agrune_guide requires targetId', () => {
    const guide = tools.find((t) => t.name === 'agrune_guide')!
    expect(guide.inputSchema.required).toContain('targetId')
  })

  it('agrune_snapshot supports optional tab selection and group expansion controls', () => {
    const snapshot = tools.find((t) => t.name === 'agrune_snapshot')!
    expect(snapshot.inputSchema.properties).toHaveProperty('tabId')
    expect(snapshot.inputSchema.properties).toHaveProperty('groupId')
    expect(snapshot.inputSchema.properties).toHaveProperty('groupIds')
    expect(snapshot.inputSchema.properties).toHaveProperty('mode')
    expect(snapshot.inputSchema.properties).toHaveProperty('includeTextContent')
    expect(snapshot.inputSchema.required ?? []).not.toContain('tabId')
  })

  it('agrune_sessions has no required properties', () => {
    const sessions = tools.find((t) => t.name === 'agrune_sessions')!
    expect(sessions.inputSchema.required ?? []).toEqual([])
  })

  it('agrune_config has all optional config properties', () => {
    const config = tools.find((t) => t.name === 'agrune_config')!
    const props = config.inputSchema.properties ?? {}
    expect(props).toHaveProperty('pointerAnimation')
    expect(props).toHaveProperty('auroraGlow')
    expect(props).toHaveProperty('auroraTheme')
    expect(props).toHaveProperty('clickDelayMs')
    expect(props).toHaveProperty('pointerDurationMs')
    expect(props).toHaveProperty('autoScroll')
    expect(config.inputSchema.required ?? []).toEqual([])
  })
})
