// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgagruneManifest } from '../src/types'

const motionModes: string[] = []

vi.mock('ai-motion', () => ({
  Motion: class Motion {
    element = document.createElement('div')
    autoResize = vi.fn()
    start = vi.fn()
    fadeIn = vi.fn()
    fadeOut = vi.fn()

    constructor(options?: { mode?: string }) {
      motionModes.push(options?.mode ?? 'dark')
    }
  },
}))

import {
  createPageAgentRuntime,
  getInstalledPageAgentRuntime,
  installPageAgentRuntime,
} from '../src/runtime/page-agent-runtime'

function mockRect() {
  return {
    x: 0,
    y: 0,
    width: 120,
    height: 40,
    top: 0,
    left: 0,
    right: 120,
    bottom: 40,
    toJSON: () => ({}),
  } as DOMRect
}

function makeManifest(): AgagruneManifest {
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    exposureMode: 'grouped',
    groups: [
      {
        groupDesc: '인증 작업',
        groupId: 'auth',
        groupName: 'Auth',
        tools: [
          {
            action: 'click',
            status: 'active',
            targets: [
              {
                desc: '로그인 버튼',
                name: '로그인',
                selector: '[data-agrune-key="login"]',
                sourceColumn: 1,
                sourceFile: 'App.tsx',
                sourceLine: 1,
                targetId: 'login',
              },
            ],
            toolDesc: '클릭',
            toolName: 'auth_click',
          },
          {
            action: 'fill',
            status: 'active',
            targets: [
              {
                desc: '이메일 입력',
                name: '이메일',
                selector: '[data-agrune-key="email"]',
                sourceColumn: 1,
                sourceFile: 'App.tsx',
                sourceLine: 2,
                targetId: 'email',
              },
            ],
            toolDesc: '입력',
            toolName: 'auth_fill',
          },
        ],
      },
    ],
  }
}

function makeRepeatedTargetManifest(): AgagruneManifest {
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    exposureMode: 'grouped',
    groups: [
      {
        groupId: 'assignee-options',
        groupName: '담당자 옵션',
        tools: [
          {
            action: 'click',
            status: 'active',
            toolDesc: '담당자 선택',
            toolName: 'assignee_click',
            targets: [
              {
                desc: null,
                name: null,
                selector: '[data-agrune-key="assignee-option"]',
                sourceColumn: 1,
                sourceFile: 'TaskWizard.tsx',
                sourceLine: 1,
                targetId: 'assignee-option',
              },
            ],
          },
        ],
      },
    ],
  }
}

function makeOverlayFlowManifest(): AgagruneManifest {
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    exposureMode: 'grouped',
    groups: [
      {
        groupDesc: '배경 인증 작업',
        groupId: 'auth',
        groupName: 'Auth',
        tools: [
          {
            action: 'click',
            status: 'active',
            targets: [
              {
                desc: '배경 로그인 버튼',
                name: '로그인',
                selector: '[data-agrune-key="login"]',
                sourceColumn: 1,
                sourceFile: 'Overlay.tsx',
                sourceLine: 1,
                targetId: 'login',
              },
            ],
            toolDesc: '클릭',
            toolName: 'auth_click',
          },
          {
            action: 'fill',
            status: 'active',
            targets: [
              {
                desc: '배경 이메일 입력',
                name: '이메일',
                selector: '[data-agrune-key="email"]',
                sourceColumn: 1,
                sourceFile: 'Overlay.tsx',
                sourceLine: 2,
                targetId: 'email',
              },
            ],
            toolDesc: '입력',
            toolName: 'auth_fill',
          },
        ],
      },
      {
        groupDesc: '활성 모달 액션',
        groupId: 'modal',
        groupName: 'Modal',
        tools: [
          {
            action: 'click',
            status: 'active',
            targets: [
              {
                desc: '모달 확인 버튼',
                name: '확인',
                selector: '[data-agrune-key="confirm"]',
                sourceColumn: 1,
                sourceFile: 'Overlay.tsx',
                sourceLine: 3,
                targetId: 'confirm',
              },
            ],
            toolDesc: '확인',
            toolName: 'modal_click',
          },
        ],
      },
    ],
  }
}

describe('page agent runtime', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    motionModes.length = 0
    const elementFromPoint = vi.fn(() => null)
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: elementFromPoint,
      writable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
      writable: true,
    })
  })

  it('getSnapshot은 visible/enabled/actionKind를 포함한다', () => {
    const button = document.createElement('button')
    button.textContent = '로그인'
    button.setAttribute('data-agrune-key', 'login')
    button.getBoundingClientRect = () => mockRect()

    const input = document.createElement('input')
    input.setAttribute('data-agrune-key', 'email')
    input.setAttribute('data-agrune-sensitive', 'true')
    input.getBoundingClientRect = () => mockRect()

    document.body.append(button, input)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => button)

    const runtime = createPageAgentRuntime(makeManifest())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.version).toBeGreaterThan(0)
    expect(snapshot.groups).toEqual([
      expect.objectContaining({
        groupId: 'auth',
        groupName: 'Auth',
        targetIds: ['email', 'login'],
      }),
    ])
    expect(snapshot.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionKind: 'click',
          enabled: true,
          reason: 'ready',
          sensitive: false,
          targetId: 'login',
          visible: true,
          actionableNow: true,
          overlay: false,
        }),
        expect.objectContaining({
          actionKind: 'fill',
          reason: 'covered',
          sensitive: true,
          targetId: 'email',
          visible: true,
          actionableNow: false,
          overlay: false,
        }),
      ]),
    )
  })

  it('getSnapshot은 비실행 가능 target도 상태와 함께 유지한다', () => {
    const button = document.createElement('button')
    button.textContent = '로그인'
    button.setAttribute('data-agrune-key', 'login')
    button.getBoundingClientRect = () => mockRect()
    button.disabled = true

    const input = document.createElement('input')
    input.setAttribute('data-agrune-key', 'email')
    input.getBoundingClientRect = () => mockRect()
    input.style.display = 'none'

    document.body.append(button, input)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => button)

    const runtime = createPageAgentRuntime(makeManifest())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: 'login',
          enabled: false,
          reason: 'disabled',
          actionableNow: false,
          overlay: false,
        }),
        expect.objectContaining({
          targetId: 'email',
          visible: false,
          inViewport: false,
          reason: 'hidden',
          actionableNow: false,
          overlay: false,
        }),
      ]),
    )
  })

  it('오버레이에 가려진 target은 snapshot에 남지만 covered 상태가 된다', async () => {
    const button = document.createElement('button')
    button.textContent = '로그인'
    button.setAttribute('data-agrune-key', 'login')
    button.getBoundingClientRect = () => mockRect()

    const overlay = document.createElement('div')
    overlay.getBoundingClientRect = () => mockRect()

    document.body.append(button, overlay)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => overlay)

    const runtime = createPageAgentRuntime(makeManifest())
    const snapshot = runtime.getSnapshot()
    expect(snapshot.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: 'login',
          covered: true,
          reason: 'covered',
          actionableNow: false,
          overlay: false,
        }),
      ]),
    )

    const result = await runtime.act({ targetId: 'login', expectedVersion: snapshot.version })
    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('expected runtime.act to fail for covered target')
    }
    expect(result.error.code).toBe('NOT_VISIBLE')
  })

  it('overlay flow가 active면 covered가 아니어도 배경 act/guide/fill을 막는다', async () => {
    const login = document.createElement('button')
    login.textContent = '로그인'
    login.setAttribute('data-agrune-key', 'login')
    login.getBoundingClientRect = () => ({
      ...mockRect(),
      bottom: 40,
      top: 0,
      y: 0,
    })

    const email = document.createElement('input')
    email.setAttribute('data-agrune-key', 'email')
    email.value = 'user@example.com'
    email.getBoundingClientRect = () => ({
      ...mockRect(),
      bottom: 120,
      top: 80,
      y: 80,
    })

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.style.position = 'fixed'
    dialog.style.zIndex = '10'
    dialog.getBoundingClientRect = () => ({
      ...mockRect(),
      bottom: 200,
      top: 160,
      y: 160,
    })

    const confirm = document.createElement('button')
    confirm.textContent = '확인'
    confirm.setAttribute('data-agrune-key', 'confirm')
    confirm.getBoundingClientRect = () => ({
      ...mockRect(),
      bottom: 200,
      top: 160,
      y: 160,
    })

    dialog.append(confirm)
    document.body.append(login, email, dialog)

    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_x: number, y: number) => {
        if (y >= 160) return confirm
        if (y >= 80) return email
        return login
      },
    )

    const runtime = createPageAgentRuntime(makeOverlayFlowManifest())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: 'login',
          actionableNow: true,
          covered: false,
          overlay: false,
          reason: 'ready',
        }),
        expect.objectContaining({
          targetId: 'confirm',
          actionableNow: true,
          covered: false,
          overlay: true,
          reason: 'ready',
        }),
      ]),
    )

    const actResult = await runtime.act({ targetId: 'login', expectedVersion: snapshot.version })
    expect(actResult.ok).toBe(false)
    if (actResult.ok) {
      throw new Error('expected runtime.act to fail for flow-blocked background target')
    }
    expect(actResult.error.code).toBe('FLOW_BLOCKED')

    const guideResult = await runtime.guide({ targetId: 'login', expectedVersion: snapshot.version })
    expect(guideResult.ok).toBe(false)
    if (guideResult.ok) {
      throw new Error('expected runtime.guide to fail for flow-blocked background target')
    }
    expect(guideResult.error.code).toBe('FLOW_BLOCKED')

    const fillResult = await runtime.fill({
      targetId: 'email',
      value: 'next@example.com',
      expectedVersion: snapshot.version,
    })
    expect(fillResult.ok).toBe(false)
    if (fillResult.ok) {
      throw new Error('expected runtime.fill to fail for flow-blocked background target')
    }
    expect(fillResult.error.code).toBe('FLOW_BLOCKED')
  })

  it('overlay flow가 active면 background drag를 막고 overlay target 실행은 허용한다', async () => {
    let confirmed = 0

    const login = document.createElement('button')
    login.textContent = '로그인'
    login.setAttribute('data-agrune-key', 'login')
    login.draggable = true
    login.getBoundingClientRect = () => ({
      ...mockRect(),
      bottom: 40,
      top: 0,
      y: 0,
    })

    const email = document.createElement('input')
    email.setAttribute('data-agrune-key', 'email')
    email.getBoundingClientRect = () => ({
      ...mockRect(),
      bottom: 120,
      top: 80,
      y: 80,
    })

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.style.position = 'fixed'
    dialog.style.zIndex = '10'
    dialog.getBoundingClientRect = () => ({
      ...mockRect(),
      bottom: 200,
      top: 160,
      y: 160,
    })

    const confirm = document.createElement('button')
    confirm.textContent = '확인'
    confirm.setAttribute('data-agrune-key', 'confirm')
    confirm.addEventListener('click', () => {
      confirmed += 1
    })
    confirm.getBoundingClientRect = () => ({
      ...mockRect(),
      bottom: 200,
      top: 160,
      y: 160,
    })

    dialog.append(confirm)
    document.body.append(login, email, dialog)

    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_x: number, y: number) => {
        if (y >= 160) return confirm
        if (y >= 80) return email
        return login
      },
    )

    const runtime = createPageAgentRuntime(makeOverlayFlowManifest())
    const snapshot = runtime.getSnapshot()

    const dragResult = await runtime.drag({
      sourceTargetId: 'login',
      destinationTargetId: 'confirm',
      expectedVersion: snapshot.version,
    })
    expect(dragResult.ok).toBe(false)
    if (dragResult.ok) {
      throw new Error('expected runtime.drag to fail for flow-blocked background source')
    }
    expect(dragResult.error.code).toBe('FLOW_BLOCKED')

    const confirmResult = await runtime.act({
      targetId: 'confirm',
      expectedVersion: snapshot.version,
    })
    expect(confirmResult.ok).toBe(true)
    expect(confirmed).toBe(1)
  })

  it('installPageAgentRuntime은 window.agruneDom 전역과 installed handle을 노출한다', () => {
    const handle = installPageAgentRuntime(makeManifest())

    expect(window.agruneDom).toBeDefined()
    expect(getInstalledPageAgentRuntime()).toBe(handle)

    handle.dispose()
    expect(window.agruneDom).toBeUndefined()
    expect(getInstalledPageAgentRuntime()).toBeNull()
  })

  it('오로라와 커서는 에이전트 배치가 끝난 뒤에만 숨겨진다', async () => {
    vi.useFakeTimers()
    const button = document.createElement('button')
    button.setAttribute('data-agrune-key', 'login')
    button.getBoundingClientRect = () => mockRect()

    let auroraVisibleDuringClick = false
    let pointerVisibleDuringClick = false
    button.addEventListener('click', () => {
      auroraVisibleDuringClick = document.querySelector('[data-agrune-aurora="true"]') !== null
      pointerVisibleDuringClick =
        (document.querySelector('[data-agrune-pointer="true"]') as HTMLElement | null)?.style.display === 'block'
    })

    document.body.appendChild(button)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => button)

    const originalRequestAnimationFrame = window.requestAnimationFrame
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(performance.now() + 1_000)
      return 1
    }) as typeof window.requestAnimationFrame

    try {
      const runtime = createPageAgentRuntime(makeManifest())
      runtime.applyConfig({ auroraGlow: true, auroraTheme: 'light', pointerAnimation: true })

      expect(document.querySelector('[data-agrune-aurora="true"]')).toBeNull()
      expect(document.querySelector('[data-agrune-pointer="true"]')).toBeNull()

      runtime.beginAgentActivity()
      const snapshot = runtime.getSnapshot()
      const actPromise = runtime.act({ expectedVersion: snapshot.version, targetId: 'login' })
      await vi.advanceTimersByTimeAsync(1_000)
      const result = await actPromise

      expect(result.ok).toBe(true)
      expect(auroraVisibleDuringClick).toBe(true)
      expect(pointerVisibleDuringClick).toBe(true)
      expect(document.querySelector('[data-agrune-aurora="true"]')).not.toBeNull()
      expect((document.querySelector('[data-agrune-pointer="true"]') as HTMLElement | null)?.style.display).toBe('block')

      await vi.advanceTimersByTimeAsync(5_000)
      expect(document.querySelector('[data-agrune-aurora="true"]')).not.toBeNull()
      expect((document.querySelector('[data-agrune-pointer="true"]') as HTMLElement | null)?.style.display).toBe('block')

      runtime.endAgentActivity()
      await vi.advanceTimersByTimeAsync(2_600)

      expect(document.querySelector('[data-agrune-aurora="true"]')).not.toBeNull()
      expect((document.querySelector('[data-agrune-pointer="true"]') as HTMLElement | null)?.style.display).toBe('block')

      await vi.advanceTimersByTimeAsync(3_000)
      await vi.advanceTimersByTimeAsync(600)

      expect(document.querySelector('[data-agrune-aurora="true"]')).toBeNull()
      expect(document.querySelector('[data-agrune-pointer="true"]')).not.toBeNull()
      expect((document.querySelector('[data-agrune-pointer="true"]') as HTMLElement | null)?.style.display).toBe('none')
      expect(motionModes).toEqual(['light'])
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame
      vi.useRealTimers()
    }
  })

  it('beginAgentActivity는 pointerAnimation이 켜져 있으면 명령 실행 전에도 idle 포인터를 표시한다', async () => {
    vi.useFakeTimers()

    try {
      const button = document.createElement('button')
      button.setAttribute('data-agrune-key', 'login')
      button.getBoundingClientRect = () => mockRect()
      document.body.appendChild(button)
      ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => button)

      const runtime = createPageAgentRuntime(makeManifest())
      runtime.applyConfig({ pointerAnimation: true })

      expect(document.querySelector('[data-agrune-pointer="true"]')).toBeNull()

      runtime.beginAgentActivity()

      const pointer = document.querySelector('[data-agrune-pointer="true"]') as HTMLElement | null
      expect(pointer).not.toBeNull()
      expect(pointer?.style.display).toBe('block')

      runtime.endAgentActivity()
      expect(pointer?.style.display).toBe('block')

      await vi.advanceTimersByTimeAsync(5_000)
      expect(pointer?.style.display).toBe('none')
    } finally {
      vi.useRealTimers()
    }
  })

  it('beginAgentActivity는 pointerAnimation이 꺼져 있으면 idle 포인터를 표시하지 않는다', async () => {
    vi.useFakeTimers()

    try {
      const runtime = createPageAgentRuntime(makeManifest())
      runtime.applyConfig({ pointerAnimation: false })

      expect(document.querySelector('[data-agrune-pointer="true"]')).toBeNull()

      runtime.beginAgentActivity()

      const pointer = document.querySelector('[data-agrune-pointer="true"]') as HTMLElement | null
      expect(pointer).toBeNull()

      runtime.endAgentActivity()
      await vi.advanceTimersByTimeAsync(5_000)

      expect(document.querySelector('[data-agrune-pointer="true"]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('isBusy는 visual idle tail 동안 false를 유지한다', async () => {
    vi.useFakeTimers()

    try {
      const runtime = createPageAgentRuntime(makeManifest())
      runtime.applyConfig({ pointerAnimation: true })

      runtime.beginAgentActivity()
      expect(runtime.isBusy()).toBe(true)
      expect(runtime.isActive()).toBe(true)

      runtime.endAgentActivity()

      expect(runtime.isBusy()).toBe(false)
      expect(runtime.isActive()).toBe(true)

      await vi.advanceTimersByTimeAsync(5_000)
      expect(runtime.isBusy()).toBe(false)
      expect(runtime.isActive()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('act는 click 실행 후 최신 snapshot을 반환한다', async () => {
    const button = document.createElement('button')
    button.setAttribute('data-agrune-key', 'login')
    button.getBoundingClientRect = () => mockRect()

    let clicked = false
    button.addEventListener('click', () => {
      clicked = true
      button.disabled = true
    })

    document.body.appendChild(button)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => button)

    const runtime = createPageAgentRuntime(makeManifest())
    const snapshot = runtime.getSnapshot()
    const result = await runtime.act({ expectedVersion: snapshot.version, targetId: 'login' })

    expect(clicked).toBe(true)
    expect(result.ok).toBe(true)
    expect(result.snapshotVersion).toBeGreaterThanOrEqual(snapshot.version)
    expect(result.snapshot?.targets.find(target => target.targetId === 'login')).toEqual(
      expect.objectContaining({
        targetId: 'login',
        enabled: false,
        reason: 'disabled',
        actionableNow: false,
        overlay: false,
      }),
    )
  })

  it('act는 mousedown 기반 상호작용도 실행한다', async () => {
    const button = document.createElement('button')
    button.setAttribute('data-agrune-key', 'login')
    button.getBoundingClientRect = () => mockRect()

    let currentTab = 'board'
    const onMouseDown = vi.fn(() => {
      currentTab = 'members'
    })
    const onClick = vi.fn()
    button.addEventListener('mousedown', onMouseDown)
    button.addEventListener('click', onClick)

    document.body.appendChild(button)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => button)

    const runtime = createPageAgentRuntime(makeManifest())
    const snapshot = runtime.getSnapshot()
    const result = await runtime.act({ expectedVersion: snapshot.version, targetId: 'login' })

    expect(result.ok).toBe(true)
    expect(onMouseDown).toHaveBeenCalled()
    expect(onClick).toHaveBeenCalled()
    expect(currentTab).toBe('members')
  })

  it('act는 스크롤 컨테이너 안에서 가려진 target도 scrollIntoView 후 실행한다', async () => {
    const button = document.createElement('button')
    button.setAttribute('data-agrune-key', 'login')
    button.getBoundingClientRect = () => mockRect()

    const cover = document.createElement('div')
    let revealed = false
    button.scrollIntoView = vi.fn(() => {
      revealed = true
    })

    const onClick = vi.fn()
    button.addEventListener('click', onClick)

    document.body.append(button, cover)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => (revealed ? button : cover),
    )

    const runtime = createPageAgentRuntime(makeManifest())
    const snapshot = runtime.getSnapshot()
    const result = await runtime.act({ expectedVersion: snapshot.version, targetId: 'login' })

    expect(button.scrollIntoView).toHaveBeenCalled()
    expect(onClick).toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })

  it('act는 가운데가 열려 있으면 중심 좌표를 우선 클릭한다', async () => {
    const button = document.createElement('button')
    button.setAttribute('data-agrune-key', 'login')
    button.getBoundingClientRect = () =>
      ({
        x: 100,
        y: 100,
        width: 120,
        height: 40,
        top: 100,
        left: 100,
        right: 220,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect

    let releasedAt: { clientX: number; clientY: number } | null = null
    button.addEventListener('pointerup', event => {
      releasedAt = {
        clientX: event.clientX,
        clientY: event.clientY,
      }
    })

    document.body.appendChild(button)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => button)

    const runtime = createPageAgentRuntime(makeManifest())
    const snapshot = runtime.getSnapshot()
    const result = await runtime.act({ expectedVersion: snapshot.version, targetId: 'login' })

    expect(result.ok).toBe(true)
    expect(releasedAt).not.toBeNull()
    const releasePoint = releasedAt ?? { clientX: Number.NaN, clientY: Number.NaN }
    expect(releasePoint.clientX).toBe(160)
    expect(releasePoint.clientY).toBe(120)
  })

  it('act는 가운데가 가려진 select item도 노출된 좌표로 pointerup을 보낸다', async () => {
    const item = document.createElement('div')
    item.setAttribute('data-agrune-key', 'login')
    item.getBoundingClientRect = () =>
      ({
        x: 100,
        y: 100,
        width: 120,
        height: 40,
        top: 100,
        left: 100,
        right: 220,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect

    const cover = document.createElement('div')
    let selected = false
    item.addEventListener('pointerup', () => {
      selected = true
    })

    document.body.append(item, cover)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (x: number, y: number) => {
        const isCenterBand = x >= 140 && x <= 180 && y >= 110 && y <= 130
        return isCenterBand ? cover : item
      },
    )

    const runtime = createPageAgentRuntime(makeManifest())
    const snapshot = runtime.getSnapshot()
    const result = await runtime.act({ expectedVersion: snapshot.version, targetId: 'login' })

    expect(selected).toBe(true)
    expect(result.ok).toBe(true)
  })

  it('fixed overlay 안의 target은 overlay=true로 표시된다', () => {
    const overlay = document.createElement('div')
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '100',
    })

    const button = document.createElement('button')
    button.textContent = '로그인'
    button.setAttribute('data-agrune-key', 'login')
    button.getBoundingClientRect = () => mockRect()
    overlay.appendChild(button)
    document.body.appendChild(overlay)

    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => button)

    const runtime = createPageAgentRuntime(makeManifest())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: 'login',
          reason: 'ready',
          overlay: true,
          actionableNow: true,
        }),
      ]),
    )
  })

  it('viewport 밖 target은 offscreen reason으로 표시된다', () => {
    const button = document.createElement('button')
    button.textContent = '로그인'
    button.setAttribute('data-agrune-key', 'login')
    button.getBoundingClientRect = () =>
      ({
        ...mockRect(),
        top: window.innerHeight + 20,
        bottom: window.innerHeight + 60,
      }) as DOMRect

    document.body.appendChild(button)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => button)

    const runtime = createPageAgentRuntime(makeManifest())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: 'login',
          inViewport: false,
          reason: 'offscreen',
          actionableNow: true,
        }),
      ]),
    )
  })

  it('민감한 fill target은 sensitive reason으로 표시된다', () => {
    const input = document.createElement('input')
    input.setAttribute('data-agrune-key', 'email')
    input.setAttribute('data-agrune-sensitive', 'true')
    input.getBoundingClientRect = () => mockRect()

    document.body.appendChild(input)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => input)

    const runtime = createPageAgentRuntime(makeManifest())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: 'email',
          sensitive: true,
          reason: 'sensitive',
          actionableNow: true,
        }),
      ]),
    )
  })

  it('fill은 input/change 이벤트를 발생시키고 값이 반영된다', async () => {
    const input = document.createElement('input')
    input.setAttribute('data-agrune-key', 'email')
    input.getBoundingClientRect = () => mockRect()

    const onInput = vi.fn()
    const onChange = vi.fn()
    input.addEventListener('input', onInput)
    input.addEventListener('change', onChange)

    document.body.appendChild(input)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => input)

    const runtime = createPageAgentRuntime(makeManifest())
    const snapshot = runtime.getSnapshot()
    const result = await runtime.fill({
      expectedVersion: snapshot.version,
      targetId: 'email',
      value: 'hello@example.com',
    })

    expect(result.ok).toBe(true)
    expect(input.value).toBe('hello@example.com')
    expect(onInput).toHaveBeenCalled()
    expect(onChange).toHaveBeenCalled()
    expect(result.snapshot?.targets.find(target => target.targetId === 'email')).toEqual(
      expect.objectContaining({
        targetId: 'email',
        reason: 'ready',
      }),
    )
  })

  it('반복 렌더된 동일 selector target은 snapshot에서 개별 항목으로 확장된다', async () => {
    const labels = ['Alice Chen', 'Bob Kim', 'Charlie Park']
    const buttons = labels.map((label, index) => {
      const button = document.createElement('button')
      button.textContent = label
      button.setAttribute('data-agrune-key', 'assignee-option')
      button.getBoundingClientRect = () =>
        ({
          ...mockRect(),
          top: index * 50,
          bottom: index * 50 + 40,
        }) as DOMRect
      return button
    })

    const clicked: string[] = []
    for (const button of buttons) {
      button.addEventListener('click', () => {
        clicked.push(button.textContent ?? '')
      })
    }

    document.body.append(...buttons)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_x: number, y: number) => buttons.find((button, index) => y >= index * 50 && y < index * 50 + 40) ?? null,
    )

    const runtime = createPageAgentRuntime(makeRepeatedTargetManifest())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.targets.map(target => target.targetId)).toEqual([
      'assignee-option__agrune_idx_0',
      'assignee-option__agrune_idx_1',
      'assignee-option__agrune_idx_2',
    ])
    expect(snapshot.targets.map(target => target.name)).toEqual(labels)
    expect(snapshot.groups).toEqual([
      expect.objectContaining({
        groupId: 'assignee-options',
        targetIds: [
          'assignee-option__agrune_idx_0',
          'assignee-option__agrune_idx_1',
          'assignee-option__agrune_idx_2',
        ],
      }),
    ])

    const result = await runtime.act({
      expectedVersion: snapshot.version,
      targetId: 'assignee-option__agrune_idx_1',
    })

    expect(result.ok).toBe(true)
    expect(clicked).toEqual(['Bob Kim'])
    if (!result.ok) {
      throw new Error('expected click command to succeed')
    }
    expect(result.result).toEqual(
      expect.objectContaining({
        actionKind: 'click',
        targetId: 'assignee-option__agrune_idx_1',
      }),
    )
  })

  it('drag는 click target을 source/destination으로 사용해 pointer 기반 이동을 실행한다', async () => {
    const source = document.createElement('div')
    source.setAttribute('data-agrune-key', 'card-1')
    source.getBoundingClientRect = () =>
      ({
        ...mockRect(),
        left: 0,
        right: 120,
      }) as DOMRect

    const destination = document.createElement('div')
    destination.setAttribute('data-agrune-key', 'column-done')
    destination.getBoundingClientRect = () =>
      ({
        ...mockRect(),
        left: 240,
        right: 360,
      }) as DOMRect

    const events: string[] = []
    let releaseClientY = 0
    source.addEventListener('mousedown', () => events.push('source:mousedown'))
    source.addEventListener('mousemove', () => events.push('source:mousemove'))
    destination.addEventListener('mouseover', () => events.push('destination:mouseover'))
    destination.addEventListener('mouseup', event => {
      events.push('destination:mouseup')
      releaseClientY = event.clientY
    })

    document.body.append(source, destination)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (x: number) => (x >= 180 ? destination : source),
    )

    const runtime = createPageAgentRuntime({
      version: 2,
      generatedAt: new Date().toISOString(),
      exposureMode: 'grouped',
      groups: [
        {
          groupId: 'board',
          groupName: 'Board',
          tools: [
            {
              action: 'click',
              status: 'active',
              toolDesc: 'board click',
              toolName: 'board_click',
              targets: [
                {
                  desc: '첫 번째 카드',
                  name: 'card-1',
                  selector: '[data-agrune-key="card-1"]',
                  sourceColumn: 1,
                  sourceFile: 'Board.tsx',
                  sourceLine: 1,
                  targetId: 'card-1',
                },
                {
                  desc: 'Done 컬럼',
                  name: 'column-done',
                  selector: '[data-agrune-key="column-done"]',
                  sourceColumn: 1,
                  sourceFile: 'Board.tsx',
                  sourceLine: 2,
                  targetId: 'column-done',
                },
              ],
            },
          ],
        },
      ],
    })

    const snapshot = runtime.getSnapshot()
    const result = await runtime.drag({
      expectedVersion: snapshot.version,
      sourceTargetId: 'card-1',
      destinationTargetId: 'column-done',
      placement: 'after',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected runtime.drag to succeed')
    }
    expect(events).toContain('source:mousedown')
    expect(events).toContain('source:mousemove')
    expect(events).toContain('destination:mouseover')
    expect(events).toContain('destination:mouseup')
    expect(releaseClientY).toBeGreaterThan(20)
    expect(result.result).toEqual(
      expect.objectContaining({
        actionKind: 'drag',
        sourceTargetId: 'card-1',
        destinationTargetId: 'column-done',
        placement: 'after',
      }),
    )
  })

  it('drag는 pointerAnimation 설정 시 커서 오버레이를 표시한다', async () => {
    vi.useFakeTimers()
    const source = document.createElement('div')
    source.setAttribute('data-agrune-key', 'card-1')
    source.getBoundingClientRect = () =>
      ({
        ...mockRect(),
        left: 0,
        right: 120,
      }) as DOMRect

    const destination = document.createElement('div')
    destination.setAttribute('data-agrune-key', 'column-done')
    destination.getBoundingClientRect = () =>
      ({
        ...mockRect(),
        left: 240,
        right: 360,
      }) as DOMRect
    let pointerVisibleDuringDrag = false
    destination.addEventListener('mouseover', () => {
      pointerVisibleDuringDrag =
        (document.querySelector('[data-agrune-pointer="true"]') as HTMLElement | null)?.style.display ===
        'block'
    })

    document.body.append(source, destination)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (x: number) => (x >= 180 ? destination : source),
    )

    const originalRequestAnimationFrame = window.requestAnimationFrame
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(performance.now() + 1_000)
      return 1
    }) as typeof window.requestAnimationFrame

    try {
      const runtime = createPageAgentRuntime({
        version: 2,
        generatedAt: new Date().toISOString(),
        exposureMode: 'grouped',
        groups: [
          {
            groupId: 'board',
            groupName: 'Board',
            tools: [
              {
                action: 'click',
                status: 'active',
                toolDesc: 'board click',
                toolName: 'board_click',
                targets: [
                  {
                    desc: '첫 번째 카드',
                    name: 'card-1',
                    selector: '[data-agrune-key="card-1"]',
                    sourceColumn: 1,
                    sourceFile: 'Board.tsx',
                    sourceLine: 1,
                    targetId: 'card-1',
                  },
                  {
                    desc: 'Done 컬럼',
                    name: 'column-done',
                    selector: '[data-agrune-key="column-done"]',
                    sourceColumn: 1,
                    sourceFile: 'Board.tsx',
                    sourceLine: 2,
                    targetId: 'column-done',
                  },
                ],
              },
            ],
          },
        ],
      })

      const snapshot = runtime.getSnapshot()
      const dragPromise = runtime.drag({
        expectedVersion: snapshot.version,
        sourceTargetId: 'card-1',
        destinationTargetId: 'column-done',
        placement: 'inside',
        config: {
          pointerAnimation: true,
        },
      })
      await vi.advanceTimersByTimeAsync(1_000)
      const result = await dragPromise

      expect(result.ok).toBe(true)
      expect(pointerVisibleDuringDrag).toBe(true)
      expect(document.querySelector('[data-agrune-pointer="true"]')).not.toBeNull()
      expect((document.querySelector('[data-agrune-pointer="true"]') as HTMLElement | null)?.style.display).toBe('block')

      // Queue idle timer (5s) fires, then schedules activity idle timer (5s)
      await vi.advanceTimersByTimeAsync(5_000)
      expect((document.querySelector('[data-agrune-pointer="true"]') as HTMLElement | null)?.style.display).toBe('block')
      await vi.advanceTimersByTimeAsync(5_000)
      expect((document.querySelector('[data-agrune-pointer="true"]') as HTMLElement | null)?.style.display).toBe('none')
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame
      vi.useRealTimers()
    }
  })

  it('draggable element는 HTML5 drag/drop 이벤트로 이동을 실행한다', async () => {
    const source = document.createElement('div')
    source.draggable = true
    source.setAttribute('data-agrune-key', 'card-1')
    source.getBoundingClientRect = () =>
      ({
        ...mockRect(),
        left: 0,
        right: 120,
      }) as DOMRect

    const destination = document.createElement('div')
    destination.setAttribute('data-agrune-key', 'column-done')
    destination.getBoundingClientRect = () =>
      ({
        ...mockRect(),
        left: 240,
        right: 360,
      }) as DOMRect

    const events: string[] = []
    let droppedData = ''
    source.addEventListener('dragstart', event => {
      events.push('source:dragstart')
      event.dataTransfer?.setData('text/plain', 'card-1')
    })
    source.addEventListener('dragend', () => {
      events.push('source:dragend')
    })
    destination.addEventListener('dragenter', () => {
      events.push('destination:dragenter')
    })
    destination.addEventListener('dragover', event => {
      events.push('destination:dragover')
      event.preventDefault()
    })
    destination.addEventListener('drop', event => {
      events.push('destination:drop')
      droppedData = event.dataTransfer?.getData('text/plain') ?? ''
    })

    document.body.append(source, destination)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (x: number) => (x >= 180 ? destination : source),
    )

    const runtime = createPageAgentRuntime({
      version: 2,
      generatedAt: new Date().toISOString(),
      exposureMode: 'grouped',
      groups: [
        {
          groupId: 'board',
          groupName: 'Board',
          tools: [
            {
              action: 'click',
              status: 'active',
              toolDesc: 'board click',
              toolName: 'board_click',
              targets: [
                {
                  desc: '첫 번째 카드',
                  name: 'card-1',
                  selector: '[data-agrune-key="card-1"]',
                  sourceColumn: 1,
                  sourceFile: 'Board.tsx',
                  sourceLine: 1,
                  targetId: 'card-1',
                },
                {
                  desc: 'Done 컬럼',
                  name: 'column-done',
                  selector: '[data-agrune-key="column-done"]',
                  sourceColumn: 1,
                  sourceFile: 'Board.tsx',
                  sourceLine: 2,
                  targetId: 'column-done',
                },
              ],
            },
          ],
        },
      ],
    })

    const snapshot = runtime.getSnapshot()
    const result = await runtime.drag({
      expectedVersion: snapshot.version,
      sourceTargetId: 'card-1',
      destinationTargetId: 'column-done',
      placement: 'inside',
    })

    expect(result.ok).toBe(true)
    expect(events).toEqual([
      'source:dragstart',
      'destination:dragenter',
      'destination:dragover',
      'destination:drop',
      'source:dragend',
    ])
    expect(droppedData).toBe('card-1')
  })

  it('expectedVersion이 다르면 STALE_SNAPSHOT 오류를 반환한다', async () => {
    const button = document.createElement('button')
    button.setAttribute('data-agrune-key', 'login')
    button.getBoundingClientRect = () => mockRect()
    document.body.appendChild(button)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => button)

    const runtime = createPageAgentRuntime(makeManifest())
    const snapshot = runtime.getSnapshot()
    button.disabled = true

    const result = await runtime.act({
      expectedVersion: snapshot.version,
      targetId: 'login',
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('expected runtime.act to fail')
    }
    expect(result.error.code).toBe('STALE_SNAPSHOT')
  })

  it('wait는 target 상태가 바뀌면 성공한다', async () => {
    const button = document.createElement('button')
    button.setAttribute('data-agrune-key', 'login')
    button.getBoundingClientRect = () => mockRect()
    document.body.appendChild(button)
    ;(document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => button)

    const runtime = createPageAgentRuntime(makeManifest())

    setTimeout(() => {
      button.disabled = true
    }, 25)

    const result = await runtime.wait({
      state: 'disabled',
      targetId: 'login',
      timeoutMs: 300,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected runtime.wait to succeed')
    }
    expect(result.result).toEqual(
      expect.objectContaining({
        state: 'disabled',
        targetId: 'login',
      }),
    )
  })
})
