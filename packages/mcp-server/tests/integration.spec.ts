import { describe, it, expect } from 'vitest'
import { createMcpServer } from '../src/index'
import { Readable, Writable } from 'stream'
import { encodeMessage, decodeMessages } from '../src/native-messaging'

describe('Integration: MCP server end-to-end', () => {
  it('receives session_open and creates session', async () => {
    const { sessions, connectNativeMessaging } = createMcpServer()
    const fakeInput = new Readable({ read() {} })
    const outputChunks: Buffer[] = []
    const fakeOutput = new Writable({
      write(chunk, _enc, cb) { outputChunks.push(chunk); cb() },
    })
    connectNativeMessaging(fakeInput, fakeOutput)

    fakeInput.push(encodeMessage({ type: 'session_open', tabId: 42, url: 'http://test.com', title: 'Test' }))
    await new Promise(r => setTimeout(r, 50))

    expect(sessions.getSessions()).toHaveLength(1)
    expect(sessions.getSession(42)?.url).toBe('http://test.com')
  })

  it('receives snapshot_update and caches it', async () => {
    const { sessions, connectNativeMessaging } = createMcpServer()
    const fakeInput = new Readable({ read() {} })
    const fakeOutput = new Writable({ write(_c, _e, cb) { cb() } })
    connectNativeMessaging(fakeInput, fakeOutput)

    fakeInput.push(encodeMessage({ type: 'session_open', tabId: 42, url: 'http://test.com', title: 'Test' }))
    await new Promise(r => setTimeout(r, 50))

    const snapshot = { version: 1, capturedAt: Date.now(), url: 'http://test.com', title: 'Test', groups: [], targets: [] }
    fakeInput.push(encodeMessage({ type: 'snapshot_update', tabId: 42, snapshot }))
    await new Promise(r => setTimeout(r, 50))

    expect(sessions.getSnapshot(42)).toEqual(snapshot)
  })

  it('sends command_request and resolves on result', async () => {
    const { sessions, commands, connectNativeMessaging } = createMcpServer()
    const fakeInput = new Readable({ read() {} })
    const outputChunks: Buffer[] = []
    const fakeOutput = new Writable({
      write(chunk, _enc, cb) { outputChunks.push(chunk); cb() },
    })
    connectNativeMessaging(fakeInput, fakeOutput)

    // Open session first
    fakeInput.push(encodeMessage({ type: 'session_open', tabId: 42, url: 'http://test.com', title: 'Test' }))
    await new Promise(r => setTimeout(r, 50))

    // Enqueue a command
    const resultPromise = commands.enqueue(42, { kind: 'act', targetId: 'btn-1' })
    await new Promise(r => setTimeout(r, 50))

    // Check command was sent to output
    const combined = Buffer.concat(outputChunks)
    const { messages } = decodeMessages(combined)
    const cmdMsg = messages.find((m: any) => m.type === 'command_request')
    expect(cmdMsg).toBeDefined()
    expect((cmdMsg as any).command.kind).toBe('act')

    // Simulate result from Extension
    fakeInput.push(encodeMessage({
      type: 'command_result',
      tabId: 42,
      commandId: (cmdMsg as any).commandId,
      result: { commandId: (cmdMsg as any).commandId, ok: true },
    }))

    const result = await resultPromise
    expect(result.ok).toBe(true)
  })

  it('closes session on session_close', async () => {
    const { sessions, connectNativeMessaging } = createMcpServer()
    const fakeInput = new Readable({ read() {} })
    const fakeOutput = new Writable({ write(_c, _e, cb) { cb() } })
    connectNativeMessaging(fakeInput, fakeOutput)

    fakeInput.push(encodeMessage({ type: 'session_open', tabId: 42, url: 'http://test.com', title: 'Test' }))
    await new Promise(r => setTimeout(r, 50))
    expect(sessions.getSessions()).toHaveLength(1)

    fakeInput.push(encodeMessage({ type: 'session_close', tabId: 42 }))
    await new Promise(r => setTimeout(r, 50))
    expect(sessions.getSessions()).toHaveLength(0)
  })

  it('responds to ping with pong', async () => {
    const { connectNativeMessaging } = createMcpServer()
    const fakeInput = new Readable({ read() {} })
    const outputChunks: Buffer[] = []
    const fakeOutput = new Writable({
      write(chunk, _enc, cb) { outputChunks.push(chunk); cb() },
    })
    connectNativeMessaging(fakeInput, fakeOutput)

    fakeInput.push(encodeMessage({ type: 'ping' } as any))
    await new Promise(r => setTimeout(r, 50))

    const { messages } = decodeMessages(Buffer.concat(outputChunks))
    expect(messages).toContainEqual({ type: 'pong' })
  })

  it('responds to get_status with current session and recent agent activity state', async () => {
    const { sessions, connectNativeMessaging, backend } = createMcpServer()
    const fakeInput = new Readable({ read() {} })
    const outputChunks: Buffer[] = []
    const fakeOutput = new Writable({
      write(chunk, _enc, cb) { outputChunks.push(chunk); cb() },
    })
    connectNativeMessaging(fakeInput, fakeOutput)

    fakeInput.push(encodeMessage({ type: 'session_open', tabId: 42, url: 'http://test.com', title: 'Test' }))
    await new Promise(r => setTimeout(r, 50))
    expect(sessions.getSessions()).toHaveLength(1)

    fakeInput.push(encodeMessage({ type: 'snapshot_update', tabId: 42, snapshot: { version: 1, capturedAt: Date.now(), url: 'http://test.com', title: 'Test', groups: [], targets: [] } }))
    await new Promise(r => setTimeout(r, 50))

    await backend.handleToolCall('rune_sessions', {})

    fakeInput.push(encodeMessage({ type: 'get_status' } as any))
    await new Promise(r => setTimeout(r, 50))

    const { messages } = decodeMessages(Buffer.concat(outputChunks))
    expect(messages).toContainEqual({
      type: 'status_response',
      status: {
        hostName: 'com.runeai.rune',
        phase: 'connected',
        connected: true,
        lastError: null,
        sessionCount: 1,
        mcpConnected: true,
      },
    })
  })
})
