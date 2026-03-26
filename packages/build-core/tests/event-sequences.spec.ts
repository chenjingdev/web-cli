// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEventSequences } from '../src/runtime/event-sequences'

function mockCdpClient() {
  return {
    sendCdpEvent: vi.fn().mockResolvedValue({}),
    getPendingDragData: vi.fn().mockReturnValue(null),
    clearPendingDragData: vi.fn(),
    dispose: vi.fn(),
  }
}

describe('EventSequences', () => {
  afterEach(() => { vi.useRealTimers() })

  it('click: sends mouseMoved + mousePressed + mouseReleased', async () => {
    const cdp = mockCdpClient()
    const seq = createEventSequences(cdp)
    await seq.click({ x: 100, y: 200 })
    expect(cdp.sendCdpEvent).toHaveBeenCalledTimes(3)
    expect(cdp.sendCdpEvent).toHaveBeenNthCalledWith(1, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 100, y: 200 })
    expect(cdp.sendCdpEvent).toHaveBeenNthCalledWith(2, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: 100, y: 200, button: 'left', clickCount: 1 })
    expect(cdp.sendCdpEvent).toHaveBeenNthCalledWith(3, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: 100, y: 200, button: 'left', clickCount: 1 })
  })

  it('dblclick: sends 4 events with clickCount 1 then 2', async () => {
    const cdp = mockCdpClient()
    const seq = createEventSequences(cdp)
    await seq.dblclick({ x: 50, y: 50 })
    expect(cdp.sendCdpEvent).toHaveBeenCalledTimes(4)
  })

  it('contextmenu: uses right button', async () => {
    const cdp = mockCdpClient()
    const seq = createEventSequences(cdp)
    await seq.contextmenu({ x: 50, y: 50 })
    expect(cdp.sendCdpEvent).toHaveBeenNthCalledWith(1, 'Input.dispatchMouseEvent', expect.objectContaining({ button: 'right' }))
  })

  it('hover: sends only mouseMoved', async () => {
    const cdp = mockCdpClient()
    const seq = createEventSequences(cdp)
    await seq.hover({ x: 50, y: 50 })
    expect(cdp.sendCdpEvent).toHaveBeenCalledTimes(1)
    expect(cdp.sendCdpEvent).toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.objectContaining({ type: 'mouseMoved' }))
  })

  it('longpress: has 500ms delay between press and release', async () => {
    vi.useFakeTimers()
    const cdp = mockCdpClient()
    const seq = createEventSequences(cdp)
    const promise = seq.longpress({ x: 50, y: 50 })
    expect(cdp.sendCdpEvent).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(500)
    await promise
    expect(cdp.sendCdpEvent).toHaveBeenCalledTimes(2)
  })

  it('pointerDrag: sends mousePressed + N mouseMoved + mouseReleased', async () => {
    const cdp = mockCdpClient()
    const seq = createEventSequences(cdp)
    const steps = [{ x: 60, y: 60 }, { x: 70, y: 70 }]
    await seq.pointerDrag({ x: 50, y: 50 }, { x: 80, y: 80 }, steps)
    expect(cdp.sendCdpEvent).toHaveBeenCalledTimes(4)
  })

  it('wheel: sends mouseMoved + mouseWheel with modifiers', async () => {
    const cdp = mockCdpClient()
    const seq = createEventSequences(cdp)
    await seq.wheel({ x: 50, y: 50 }, -120, true)
    expect(cdp.sendCdpEvent).toHaveBeenNthCalledWith(2, 'Input.dispatchMouseEvent', expect.objectContaining({ type: 'mouseWheel', modifiers: 4 }))
  })

  it('htmlDrag: uses setInterceptDrags + dispatchDragEvent', async () => {
    const cdp = mockCdpClient()
    cdp.getPendingDragData.mockReturnValue({ items: [], dragOperationsMask: 1 })
    const seq = createEventSequences(cdp)
    await seq.htmlDrag({ x: 50, y: 50 }, { x: 200, y: 200 })
    expect(cdp.sendCdpEvent).toHaveBeenCalledWith('Input.setInterceptDrags', { enabled: true })
    expect(cdp.sendCdpEvent).toHaveBeenCalledWith('Input.dispatchDragEvent', expect.objectContaining({ type: 'drop' }))
    expect(cdp.sendCdpEvent).toHaveBeenCalledWith('Input.setInterceptDrags', { enabled: false })
  })

  it('htmlDrag: skips drop when no dragData captured', async () => {
    const cdp = mockCdpClient()
    cdp.getPendingDragData.mockReturnValue(null)
    const seq = createEventSequences(cdp)
    await seq.htmlDrag({ x: 50, y: 50 }, { x: 200, y: 200 })
    expect(cdp.sendCdpEvent).not.toHaveBeenCalledWith('Input.dispatchDragEvent', expect.anything())
  })
})
