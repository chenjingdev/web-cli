import { describe, expect, it } from 'vitest'
import type { PageTarget } from '../src/types'
import {
  buildBlockedTargetDetails,
  createActionViewFrame,
  getNextDragPlacement,
  reconcileActionViewFrames,
} from '../src/tui-app'

type VisibleActionView = Parameters<typeof createActionViewFrame>[0]

function makeView(
  viewKey: string,
  presentation: 'base' | 'overlay',
  groupId: string,
): VisibleActionView {
  return {
    presentation,
    viewKey,
    groups: [
      {
        groupId,
        label: groupId,
        targets: [],
        actionableCount: 0,
      },
    ],
  }
}

function makeTarget(overrides: Partial<PageTarget> = {}): PageTarget {
  return {
    targetId: 'login',
    groupId: 'auth',
    groupName: 'Auth',
    groupDesc: '인증',
    name: '로그인',
    description: '로그인 버튼',
    actionKind: 'click',
    selector: '[data-webcli-key="login"]',
    visible: true,
    inViewport: true,
    enabled: true,
    covered: false,
    actionableNow: true,
    reason: 'ready',
    overlay: false,
    sensitive: false,
    textContent: '로그인',
    valuePreview: null,
    sourceFile: 'App.tsx',
    sourceLine: 1,
    sourceColumn: 1,
    ...overrides,
  }
}

describe('blocked target details', () => {
  it('blocked target 설명은 reason 필드를 우선 사용한다', () => {
    expect(
      buildBlockedTargetDetails(
        makeTarget({
          actionableNow: false,
          reason: 'covered',
        }),
      ),
    ).toEqual({
      targetId: 'login',
      reason: 'covered',
      actionableNow: false,
    })
  })
})

describe('drag placement helper', () => {
  it('좌우 이동 시 placement를 순환한다', () => {
    expect(getNextDragPlacement('inside', 1)).toBe('after')
    expect(getNextDragPlacement('inside', -1)).toBe('before')
    expect(getNextDragPlacement('before', -1)).toBe('after')
  })
})

describe('reconcileActionViewFrames', () => {
  it('base 화면이 이전 viewKey로 돌아오면 기존 frame 상태를 복원한다', () => {
    const baseAccount = makeView('base:account', 'base', 'account')
    const baseBilling = makeView('base:billing', 'base', 'billing')

    let frames = reconcileActionViewFrames([], baseAccount)
    frames = [
      {
        ...frames[0],
        selectedActionKey: 'target:account-save',
        actionFilter: 'save',
        collapsedGroups: { account: false },
      },
    ]

    frames = reconcileActionViewFrames(frames, baseBilling)
    expect(frames.map(frame => frame.viewKey)).toEqual(['base:account', 'base:billing'])

    frames = reconcileActionViewFrames(frames, baseAccount)
    expect(frames).toHaveLength(1)
    expect(frames[0]?.selectedActionKey).toBe('target:account-save')
    expect(frames[0]?.actionFilter).toBe('save')
    expect(frames[0]?.collapsedGroups).toEqual({ account: false })
  })

  it('overlay가 닫히면 base frame 포커스를 그대로 유지한다', () => {
    const baseDashboard = makeView('base:dashboard', 'base', 'orders')
    const overlayConfirm = makeView('overlay:confirm', 'overlay', 'confirm')
    const overlayConfirmUpdated = makeView('overlay:confirm:v2', 'overlay', 'confirm')

    let frames = reconcileActionViewFrames([], baseDashboard)
    frames = [
      {
        ...frames[0],
        selectedActionKey: 'target:orders-open',
        collapsedGroups: { orders: false },
      },
    ]

    frames = reconcileActionViewFrames(frames, overlayConfirm)
    expect(frames.map(frame => frame.presentation)).toEqual(['base', 'overlay'])

    frames = reconcileActionViewFrames(frames, overlayConfirmUpdated)
    expect(frames).toHaveLength(2)
    expect(frames[1]?.viewKey).toBe('overlay:confirm:v2')

    frames = reconcileActionViewFrames(frames, baseDashboard)
    expect(frames).toHaveLength(1)
    expect(frames[0]?.selectedActionKey).toBe('target:orders-open')
    expect(frames[0]?.collapsedGroups).toEqual({ orders: false })
  })
})
