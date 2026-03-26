import type { CdpClient } from './cdp-client'

export interface Coords { x: number; y: number }

export interface EventSequences {
  click(coords: Coords): Promise<void>
  dblclick(coords: Coords): Promise<void>
  contextmenu(coords: Coords): Promise<void>
  hover(coords: Coords): Promise<void>
  longpress(coords: Coords): Promise<void>
  mousePressed(coords: Coords, button?: 'left' | 'right'): Promise<void>
  mouseMoved(coords: Coords): Promise<void>
  mouseReleased(coords: Coords, button?: 'left' | 'right'): Promise<void>
  pointerDrag(src: Coords, dst: Coords, steps: Coords[]): Promise<void>
  wheel(coords: Coords, deltaY: number, ctrlKey?: boolean): Promise<void>
  htmlDrag(src: Coords, dst: Coords): Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export function createEventSequences(cdp: CdpClient): EventSequences {
  const send = cdp.sendCdpEvent.bind(cdp)
  const mouse = (type: string, x: number, y: number, extra?: Record<string, unknown>) =>
    send('Input.dispatchMouseEvent', { type, x, y, ...extra })

  return {
    async click(coords) {
      await mouse('mouseMoved', coords.x, coords.y)
      await mouse('mousePressed', coords.x, coords.y, { button: 'left', clickCount: 1 })
      await mouse('mouseReleased', coords.x, coords.y, { button: 'left', clickCount: 1 })
    },
    async dblclick(coords) {
      await mouse('mousePressed', coords.x, coords.y, { button: 'left', clickCount: 1 })
      await mouse('mouseReleased', coords.x, coords.y, { button: 'left', clickCount: 1 })
      await mouse('mousePressed', coords.x, coords.y, { button: 'left', clickCount: 2 })
      await mouse('mouseReleased', coords.x, coords.y, { button: 'left', clickCount: 2 })
    },
    async contextmenu(coords) {
      await mouse('mousePressed', coords.x, coords.y, { button: 'right', clickCount: 1 })
      await mouse('mouseReleased', coords.x, coords.y, { button: 'right', clickCount: 1 })
    },
    async hover(coords) {
      await mouse('mouseMoved', coords.x, coords.y)
    },
    async longpress(coords) {
      await mouse('mousePressed', coords.x, coords.y, { button: 'left', clickCount: 1 })
      await sleep(500)
      await mouse('mouseReleased', coords.x, coords.y, { button: 'left', clickCount: 1 })
    },
    async mousePressed(coords, button = 'left') {
      await mouse('mousePressed', coords.x, coords.y, { button, clickCount: 1 })
    },
    async mouseMoved(coords) {
      await mouse('mouseMoved', coords.x, coords.y)
    },
    async mouseReleased(coords, button = 'left') {
      await mouse('mouseReleased', coords.x, coords.y, { button, clickCount: 1 })
    },
    async pointerDrag(src, dst, steps) {
      await mouse('mousePressed', src.x, src.y, { button: 'left', clickCount: 1 })
      for (const step of steps) {
        await mouse('mouseMoved', step.x, step.y)
      }
      await mouse('mouseReleased', dst.x, dst.y, { button: 'left', clickCount: 1 })
    },
    async wheel(coords, deltaY, ctrlKey = false) {
      await mouse('mouseMoved', coords.x, coords.y)
      await mouse('mouseWheel', coords.x, coords.y, { deltaX: 0, deltaY, modifiers: ctrlKey ? 4 : 0 })
    },
    async htmlDrag(src, dst) {
      await send('Input.setInterceptDrags', { enabled: true })
      await mouse('mousePressed', src.x, src.y, { button: 'left', clickCount: 1 })
      await mouse('mouseMoved', dst.x, dst.y)
      await sleep(100) // wait for dragIntercepted event
      const dragData = cdp.getPendingDragData()
      if (dragData) {
        await send('Input.dispatchDragEvent', { type: 'drop', x: dst.x, y: dst.y, data: dragData })
        cdp.clearPendingDragData()
      }
      await mouse('mouseReleased', dst.x, dst.y, { button: 'left', clickCount: 1 })
      await send('Input.setInterceptDrags', { enabled: false })
    },
  }
}
