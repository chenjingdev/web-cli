import { describe, expect, it } from 'vitest'
import type { CommandResult } from '@webcli-dom/core'
import { createCompletedCommandBuffer, processPendingCommands } from '../src/pending-call-runner'
import type { PageRuntimeLike } from '../src/types'
import { toCompanionWsUrl } from '../src/ws-transport'

describe('browser client', () => {
  it('pending command를 runtime 호출로 처리한다', async () => {
    const calls: string[] = []
    const success = (commandId: string): CommandResult => ({
      commandId,
      ok: true,
      snapshotVersion: 2,
      result: { message: 'ok' },
    })

    const runtime: PageRuntimeLike = {
      getSnapshot() {
        return {
          version: 1,
          capturedAt: Date.now(),
          url: 'http://example.local',
          title: 'Example',
          groups: [],
          targets: [],
        }
      },
      async act(input) {
        calls.push(`act:${input.targetId}`)
        return success(input.commandId ?? input.targetId)
      },
      async drag(input) {
        calls.push(
          `drag:${input.sourceTargetId}:${input.destinationTargetId}:${input.placement ?? 'inside'}`,
        )
        return success(input.commandId ?? input.sourceTargetId)
      },
      async fill(input) {
        calls.push(`fill:${input.targetId}:${input.value}`)
        return success(input.commandId ?? input.targetId)
      },
      async wait(input) {
        calls.push(`wait:${input.targetId}:${input.state}`)
        return success(input.commandId ?? input.targetId)
      },
    }

    const completed = createCompletedCommandBuffer()
    await processPendingCommands(
      [
        { commandId: 'cmd-1', kind: 'act', targetId: 'login' },
        {
          commandId: 'cmd-2',
          kind: 'drag',
          sourceTargetId: 'card-1',
          destinationTargetId: 'column-done',
          placement: 'after',
        },
        { commandId: 'cmd-3', kind: 'fill', targetId: 'email', value: 'a@b.c' },
        { commandId: 'cmd-4', kind: 'wait', targetId: 'submit', state: 'enabled' },
      ],
      runtime,
      completed,
    )

    expect(calls).toEqual([
      'act:login',
      'drag:card-1:column-done:after',
      'fill:email:a@b.c',
      'wait:submit:enabled',
    ])
    expect(completed.snapshot()).toHaveLength(4)
    expect(completed.snapshot().every(item => item.ok)).toBe(true)
  })

  it('companion ws url에 token query를 포함한다', () => {
    expect(toCompanionWsUrl('http://127.0.0.1:9444', 'session-1', 'token-1')).toBe(
      'ws://127.0.0.1:9444/page/ws?sessionId=session-1&token=token-1',
    )
  })
})
