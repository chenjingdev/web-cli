import { describe, it, expect, vi } from 'vitest'
import { CommandQueue } from '../src/command-queue'
import type { NativeMessage, CommandRequestMessage } from '@agrune/core'
import type { CommandRequest, CommandResult } from '@agrune/core'

describe('CommandQueue', () => {
  it('enqueues a command and returns a promise that resolves on result', async () => {
    const sender = vi.fn<(msg: NativeMessage) => void>()
    const queue = new CommandQueue()
    queue.setSender(sender)

    const command: Pick<CommandRequest, 'kind'> & Record<string, unknown> = {
      kind: 'act',
      targetId: 'btn-1',
    }

    const promise = queue.enqueue(1, command)

    // Extract the commandId from the sent message
    expect(sender).toHaveBeenCalledOnce()
    const sent = sender.mock.calls[0][0] as CommandRequestMessage
    expect(sent.type).toBe('command_request')
    expect(sent.tabId).toBe(1)
    expect(sent.command.kind).toBe('act')

    const result: CommandResult = {
      commandId: sent.commandId,
      ok: true,
    }

    queue.resolve(sent.commandId, result)

    await expect(promise).resolves.toEqual(result)
  })

  it('sends command_request message via sender', () => {
    const sender = vi.fn<(msg: NativeMessage) => void>()
    const queue = new CommandQueue()
    queue.setSender(sender)

    queue.enqueue(42, { kind: 'fill', targetId: 't-1', value: 'hello' })

    expect(sender).toHaveBeenCalledOnce()
    const sent = sender.mock.calls[0][0] as CommandRequestMessage
    expect(sent.type).toBe('command_request')
    expect(sent.tabId).toBe(42)
    expect(sent.command.kind).toBe('fill')
    expect((sent.command as Record<string, unknown>).targetId).toBe('t-1')
    expect((sent.command as Record<string, unknown>).value).toBe('hello')
  })

  it('times out if no result received', async () => {
    const sender = vi.fn<(msg: NativeMessage) => void>()
    const queue = new CommandQueue()
    queue.setSender(sender)

    const promise = queue.enqueue(1, { kind: 'act', targetId: 'btn-1' }, { timeoutMs: 50 })

    await expect(promise).rejects.toThrow('Command timed out')
  })

  it('generates unique commandId per command', () => {
    const sender = vi.fn<(msg: NativeMessage) => void>()
    const queue = new CommandQueue()
    queue.setSender(sender)

    queue.enqueue(1, { kind: 'act', targetId: 'a' })
    queue.enqueue(1, { kind: 'act', targetId: 'b' })

    const id1 = (sender.mock.calls[0][0] as CommandRequestMessage).commandId
    const id2 = (sender.mock.calls[1][0] as CommandRequestMessage).commandId

    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^cmd-\d+-\d+$/)
    expect(id2).toMatch(/^cmd-\d+-\d+$/)
  })

  it('ignores resolve for unknown commandId', async () => {
    const queue = new CommandQueue()
    // Should not throw
    queue.resolve('unknown-id', { commandId: 'unknown-id', ok: true })
  })

  describe('hasSender', () => {
    it('returns false when no sender is set', () => {
      const queue = new CommandQueue()
      expect(queue.hasSender()).toBe(false)
    })

    it('returns true when a sender is set', () => {
      const queue = new CommandQueue()
      queue.setSender(vi.fn())
      expect(queue.hasSender()).toBe(true)
    })

    it('returns false after sender is cleared', () => {
      const queue = new CommandQueue()
      queue.setSender(vi.fn())
      queue.setSender(null)
      expect(queue.hasSender()).toBe(false)
    })
  })
})
