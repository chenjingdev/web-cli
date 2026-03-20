import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startCompanionServer } from '../src/index'

const handles: Array<{ close: () => Promise<void> }> = []
const tempDirs: string[] = []

afterEach(async () => {
  while (handles.length > 0) {
    const handle = handles.pop()
    if (handle) {
      await handle.close()
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
})

function makeHomeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcli-companion-test-'))
  tempDirs.push(dir)
  return dir
}

function makeSnapshot(version = 1) {
  return {
    version,
    capturedAt: Date.now(),
    url: 'http://example.local/',
    title: 'Example',
    groups: [
      {
        groupDesc: '인증 작업',
        groupId: 'auth',
        groupName: 'Auth',
        targetIds: ['login', 'username'],
      },
    ],
    targets: [
      {
        targetId: 'login',
        groupId: 'auth',
        groupName: 'Auth',
        groupDesc: '인증 작업',
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
      },
      {
        targetId: 'username',
        groupId: 'auth',
        groupName: 'Auth',
        groupDesc: '인증 작업',
        name: '아이디',
        description: '아이디 입력',
        actionKind: 'fill',
        selector: '[data-webcli-key="username"]',
        visible: true,
        inViewport: true,
        enabled: true,
        covered: false,
        actionableNow: true,
        reason: 'ready',
        overlay: false,
        sensitive: false,
        textContent: '',
        valuePreview: 'demo-user',
        sourceFile: 'App.tsx',
        sourceLine: 2,
        sourceColumn: 1,
      },
    ],
  }
}

function makeOverlayFlowSnapshot(version = 1) {
  return {
    version,
    capturedAt: Date.now(),
    url: 'http://example.local/modal',
    title: 'Modal Example',
    groups: [
      {
        groupDesc: '배경 인증 작업',
        groupId: 'auth',
        groupName: 'Auth',
        targetIds: ['login'],
      },
      {
        groupDesc: '활성 모달 액션',
        groupId: 'modal',
        groupName: 'Modal',
        targetIds: ['confirm'],
      },
    ],
    targets: [
      {
        targetId: 'login',
        groupId: 'auth',
        groupName: 'Auth',
        groupDesc: '배경 인증 작업',
        name: '로그인',
        description: '배경 로그인 버튼',
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
        sourceFile: 'Modal.tsx',
        sourceLine: 1,
        sourceColumn: 1,
      },
      {
        targetId: 'confirm',
        groupId: 'modal',
        groupName: 'Modal',
        groupDesc: '활성 모달 액션',
        name: '확인',
        description: '모달 확인 버튼',
        actionKind: 'click',
        selector: '[data-webcli-key="confirm"]',
        visible: true,
        inViewport: true,
        enabled: true,
        covered: false,
        actionableNow: true,
        reason: 'ready',
        overlay: true,
        sensitive: false,
        textContent: '확인',
        valuePreview: null,
        sourceFile: 'Modal.tsx',
        sourceLine: 2,
        sourceColumn: 1,
      },
    ],
  }
}

function makeDragSnapshot(version = 1) {
  const snapshot = makeSnapshot(version)
  snapshot.groups[0].targetIds = ['backlog', 'login', 'username']
  snapshot.targets.push({
    targetId: 'backlog',
    groupId: 'auth',
    groupName: 'Auth',
    name: '백로그',
    description: '백로그 컬럼',
    actionKind: 'click',
    selector: '[data-webcli-key="backlog"]',
    visible: true,
    inViewport: true,
    enabled: true,
    covered: false,
    actionableNow: true,
    reason: 'ready',
    overlay: false,
    sensitive: false,
    textContent: '백로그',
    valuePreview: null,
    sourceFile: 'App.tsx',
    sourceLine: 3,
    sourceColumn: 1,
  })
  return snapshot
}

async function postJson(
  url: string,
  payload: unknown,
  headers?: Record<string, string>,
) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(headers ?? {}),
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  return {
    status: res.status,
    body: text ? JSON.parse(text) : {},
  }
}

async function getJson(url: string, headers?: Record<string, string>) {
  const res = await fetch(url, {
    method: 'GET',
    headers: headers ?? {},
  })
  const text = await res.text()
  return {
    status: res.status,
    body: text ? JSON.parse(text) : {},
  }
}

function pageHeaders(origin: string, sessionToken?: string): Record<string, string> {
  return {
    origin,
    ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
  }
}

function agentHeaders(handle: { tokenPath: string }): Record<string, string> {
  const token = fs.readFileSync(handle.tokenPath, 'utf8').trim()
  return {
    authorization: `Bearer ${token}`,
  }
}

describe('companion', () => {
  it('같은 clientId로 새로고침하면 기존 세션을 재사용한다', async () => {
    const handle = await startCompanionServer({
      host: '127.0.0.1',
      port: 19439,
      homeDir: makeHomeDir(),
    })
    handles.push(handle)

    const origin = 'http://example.local'
    const firstConnect = await postJson(
      'http://127.0.0.1:19439/page/connect',
      {
        appId: 'test-app',
        clientId: 'client-refresh-1',
        url: 'http://example.local/',
        title: 'Example',
        clientVersion: '0.0.1',
      },
      { origin },
    )
    expect(firstConnect.status).toBe(200)

    const secondConnect = await postJson(
      'http://127.0.0.1:19439/page/connect',
      {
        appId: 'test-app',
        clientId: 'client-refresh-1',
        url: 'http://example.local/dashboard',
        title: 'Dashboard',
        clientVersion: '0.0.2',
      },
      { origin },
    )
    expect(secondConnect.status).toBe(200)
    expect(secondConnect.body.sessionId).toBe(firstConnect.body.sessionId)

    const authHeaders = agentHeaders(handle)
    const sessionsRes = await getJson('http://127.0.0.1:19439/api/sessions', authHeaders)
    expect(sessionsRes.body.sessions).toHaveLength(1)
    expect(sessionsRes.body.sessions[0].title).toBe('Dashboard')
  })

  it('page sync snapshot을 저장하고 api act command를 왕복 처리한다', async () => {
    const handle = await startCompanionServer({
      host: '127.0.0.1',
      port: 19440,
      homeDir: makeHomeDir(),
      callTimeoutMs: 5_000,
    })
    handles.push(handle)

    const origin = 'http://example.local'
    const connectRes = await postJson(
      'http://127.0.0.1:19440/page/connect',
      {
        appId: 'test-app',
        clientId: 'client-1',
        url: 'http://example.local/',
        title: 'Example',
        clientVersion: '0.0.1',
      },
      { origin },
    )
    expect(connectRes.status).toBe(200)

    const sessionId = connectRes.body.sessionId as string
    const sessionToken = connectRes.body.sessionToken as string

    const syncRes = await postJson(
      'http://127.0.0.1:19440/page/sync',
      {
        sessionId,
        snapshot: makeSnapshot(1),
        completedCommands: [],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )
    expect(syncRes.status).toBe(200)
    expect(syncRes.body.status).toBe('pending')

    const authHeaders = agentHeaders(handle)
    await postJson(
      'http://127.0.0.1:19440/api/origins/approve',
      { origin },
      authHeaders,
    )
    await postJson(
      'http://127.0.0.1:19440/api/sessions/activate',
      { sessionId },
      authHeaders,
    )

    const snapshotRes = await getJson(
      `http://127.0.0.1:19440/api/snapshot?sessionId=${encodeURIComponent(sessionId)}`,
      authHeaders,
    )
    expect(snapshotRes.status).toBe(200)
    expect(snapshotRes.body.snapshot.version).toBe(1)
    expect(snapshotRes.body.snapshot.targets[0].reason).toBe('ready')

    const commandPromise = postJson(
      'http://127.0.0.1:19440/api/commands/act',
      { targetId: 'login', expectedVersion: 1 },
      authHeaders,
    )

    const syncPull = await postJson(
      'http://127.0.0.1:19440/page/sync',
      {
        sessionId,
        snapshot: makeSnapshot(1),
        completedCommands: [],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )
    expect(syncPull.body.pendingCommands).toHaveLength(1)
    expect(syncPull.body.agentActive).toBe(false)

    const commandId = syncPull.body.pendingCommands[0].commandId as string
    await postJson(
      'http://127.0.0.1:19440/page/sync',
      {
        sessionId,
        snapshot: makeSnapshot(2),
        completedCommands: [
          {
            commandId,
            ok: true,
            result: { message: 'clicked' },
            snapshotVersion: 2,
          },
        ],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )

    const commandRes = await commandPromise
    expect(commandRes.status).toBe(200)
    expect(commandRes.body.ok).toBe(true)

    const idleSync = await postJson(
      'http://127.0.0.1:19440/page/sync',
      {
        sessionId,
        snapshot: makeSnapshot(3),
        completedCommands: [],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )
    expect(idleSync.status).toBe(200)
    expect(idleSync.body.agentActive).toBe(false)
  })

  it('blocked target reason도 snapshot api에서 그대로 보존한다', async () => {
    const handle = await startCompanionServer({
      host: '127.0.0.1',
      port: 19442,
      homeDir: makeHomeDir(),
    })
    handles.push(handle)

    const origin = 'http://example.local'
    const connectRes = await postJson(
      'http://127.0.0.1:19442/page/connect',
      {
        appId: 'test-app',
        clientId: 'client-2',
        url: 'http://example.local/',
        title: 'Example',
        clientVersion: '0.0.1',
      },
      { origin },
    )
    expect(connectRes.status).toBe(200)

    const sessionId = connectRes.body.sessionId as string
    const sessionToken = connectRes.body.sessionToken as string
    const blockedSnapshot = makeSnapshot(3)
    blockedSnapshot.targets[0] = {
      ...blockedSnapshot.targets[0],
      covered: true,
      actionableNow: false,
      reason: 'covered',
    }

    const syncRes = await postJson(
      'http://127.0.0.1:19442/page/sync',
      {
        sessionId,
        snapshot: blockedSnapshot,
        completedCommands: [],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )
    expect(syncRes.status).toBe(200)

    const authHeaders = agentHeaders(handle)
    const snapshotRes = await getJson(
      `http://127.0.0.1:19442/api/snapshot?sessionId=${encodeURIComponent(sessionId)}`,
      authHeaders,
    )

    expect(snapshotRes.status).toBe(200)
    expect(snapshotRes.body.snapshot.targets[0]).toEqual(
      expect.objectContaining({
        targetId: 'login',
        covered: true,
        actionableNow: false,
        reason: 'covered',
      }),
    )
  })

  it('snapshot summary는 실행 가능한 그룹과 설명만 반환한다', async () => {
    const handle = await startCompanionServer({
      host: '127.0.0.1',
      port: 19447,
      homeDir: makeHomeDir(),
    })
    handles.push(handle)

    const origin = 'http://example.local'
    const connectRes = await postJson(
      'http://127.0.0.1:19447/page/connect',
      {
        appId: 'test-app',
        clientId: 'client-summary-1',
        url: 'http://example.local/',
        title: 'Example',
        clientVersion: '0.0.1',
      },
      { origin },
    )
    expect(connectRes.status).toBe(200)

    const sessionId = connectRes.body.sessionId as string
    const sessionToken = connectRes.body.sessionToken as string
    const snapshot = makeSnapshot(5)
    snapshot.groups.push({
      groupDesc: '숨겨진 보조 그룹',
      groupId: 'inactive',
      groupName: 'Inactive',
      targetIds: ['inactive-link'],
    })
    snapshot.targets.push({
      targetId: 'inactive-link',
      groupId: 'inactive',
      groupName: 'Inactive',
      groupDesc: '숨겨진 보조 그룹',
      name: '보조 링크',
      description: '숨겨진 링크',
      actionKind: 'click',
      selector: '[data-webcli-key="inactive-link"]',
      visible: false,
      inViewport: false,
      enabled: true,
      covered: false,
      actionableNow: false,
      reason: 'hidden',
      overlay: false,
      sensitive: false,
      textContent: '보조 링크',
      valuePreview: null,
      sourceFile: 'Hidden.tsx',
      sourceLine: 1,
      sourceColumn: 1,
    })

    await postJson(
      'http://127.0.0.1:19447/page/sync',
      {
        sessionId,
        snapshot,
        completedCommands: [],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )

    const authHeaders = agentHeaders(handle)
    const summaryRes = await getJson(
      `http://127.0.0.1:19447/api/snapshot/summary?sessionId=${encodeURIComponent(sessionId)}`,
      authHeaders,
    )

    expect(summaryRes.status).toBe(200)
    expect(summaryRes.body.mode).toBe('base')
    expect(summaryRes.body.groups).toEqual([
      expect.objectContaining({
        groupId: 'auth',
        description: '인증 작업',
        actionableCount: 2,
      }),
    ])

    const rawSnapshotRes = await getJson(
      `http://127.0.0.1:19447/api/snapshot?sessionId=${encodeURIComponent(sessionId)}`,
      authHeaders,
    )
    expect(rawSnapshotRes.status).toBe(200)
    expect(rawSnapshotRes.body.snapshot.targets.map((target: { targetId: string }) => target.targetId)).toContain('inactive-link')
  })

  it('overlay flow active면 summary와 targets 기본 조회에서 배경 그룹을 숨긴다', async () => {
    const handle = await startCompanionServer({
      host: '127.0.0.1',
      port: 19448,
      homeDir: makeHomeDir(),
    })
    handles.push(handle)

    const origin = 'http://example.local'
    const connectRes = await postJson(
      'http://127.0.0.1:19448/page/connect',
      {
        appId: 'test-app',
        clientId: 'client-summary-2',
        url: 'http://example.local/modal',
        title: 'Modal Example',
        clientVersion: '0.0.1',
      },
      { origin },
    )
    expect(connectRes.status).toBe(200)

    const sessionId = connectRes.body.sessionId as string
    const sessionToken = connectRes.body.sessionToken as string

    await postJson(
      'http://127.0.0.1:19448/page/sync',
      {
        sessionId,
        snapshot: makeOverlayFlowSnapshot(7),
        completedCommands: [],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )

    const authHeaders = agentHeaders(handle)
    const summaryRes = await getJson(
      `http://127.0.0.1:19448/api/snapshot/summary?sessionId=${encodeURIComponent(sessionId)}`,
      authHeaders,
    )
    expect(summaryRes.status).toBe(200)
    expect(summaryRes.body.mode).toBe('overlay')
    expect(summaryRes.body.groups).toEqual([
      expect.objectContaining({
        groupId: 'modal',
        description: '활성 모달 액션',
        actionableCount: 1,
      }),
    ])

    const targetsRes = await getJson(
      `http://127.0.0.1:19448/api/snapshot/targets?sessionId=${encodeURIComponent(sessionId)}&groupId=auth`,
      authHeaders,
    )
    expect(targetsRes.status).toBe(200)
    expect(targetsRes.body.mode).toBe('overlay')
    expect(targetsRes.body.targets).toEqual([])

    const backgroundTargetsRes = await getJson(
      `http://127.0.0.1:19448/api/snapshot/targets?sessionId=${encodeURIComponent(sessionId)}&groupId=auth&includeBackground=true`,
      authHeaders,
    )
    expect(backgroundTargetsRes.status).toBe(200)
    expect(backgroundTargetsRes.body.targets).toEqual([
      expect.objectContaining({
        targetId: 'login',
        overlay: false,
      }),
    ])
  })

  it('api drag command를 페이지와 왕복 처리한다', async () => {
    const handle = await startCompanionServer({
      host: '127.0.0.1',
      port: 19443,
      homeDir: makeHomeDir(),
      callTimeoutMs: 5_000,
    })
    handles.push(handle)

    const origin = 'http://example.local'
    const connectRes = await postJson(
      'http://127.0.0.1:19443/page/connect',
      {
        appId: 'test-app',
        clientId: 'client-drag-1',
        url: 'http://example.local/board',
        title: 'Board',
        clientVersion: '0.0.1',
      },
      { origin },
    )
    expect(connectRes.status).toBe(200)

    const sessionId = connectRes.body.sessionId as string
    const sessionToken = connectRes.body.sessionToken as string

    await postJson(
      'http://127.0.0.1:19443/page/sync',
      {
        sessionId,
        snapshot: makeDragSnapshot(1),
        completedCommands: [],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )

    const authHeaders = agentHeaders(handle)
    await postJson(
      'http://127.0.0.1:19443/api/origins/approve',
      { origin },
      authHeaders,
    )
    await postJson(
      'http://127.0.0.1:19443/api/sessions/activate',
      { sessionId },
      authHeaders,
    )

    const commandPromise = postJson(
      'http://127.0.0.1:19443/api/commands/drag',
      {
        sourceTargetId: 'login',
        destinationTargetId: 'backlog',
        placement: 'after',
        expectedVersion: 1,
      },
      authHeaders,
    )

    const syncPull = await postJson(
      'http://127.0.0.1:19443/page/sync',
      {
        sessionId,
        snapshot: makeDragSnapshot(1),
        completedCommands: [],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )
    expect(syncPull.body.pendingCommands).toHaveLength(1)
    expect(syncPull.body.pendingCommands[0]).toEqual(
      expect.objectContaining({
        kind: 'drag',
        sourceTargetId: 'login',
        destinationTargetId: 'backlog',
        placement: 'after',
      }),
    )

    const commandId = syncPull.body.pendingCommands[0].commandId as string
    await postJson(
      'http://127.0.0.1:19443/page/sync',
      {
        sessionId,
        snapshot: makeDragSnapshot(2),
        completedCommands: [
          {
            commandId,
            ok: true,
            result: { message: 'dragged' },
            snapshotVersion: 2,
          },
        ],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )

    const commandRes = await commandPromise
    expect(commandRes.status).toBe(200)
    expect(commandRes.body.ok).toBe(true)
  })

  it('config api가 clickDelayMs와 auroraTheme를 저장한다', async () => {
    const handle = await startCompanionServer({
      host: '127.0.0.1',
      port: 19441,
      homeDir: makeHomeDir(),
    })
    handles.push(handle)

    const authHeaders = agentHeaders(handle)
    const setRes = await fetch('http://127.0.0.1:19441/api/config', {
      method: 'PUT',
      headers: {
        ...authHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        clickDelayMs: 180,
        pointerAnimation: true,
        auroraTheme: 'light',
      }),
    })
    expect(setRes.status).toBe(200)

    const getRes = await getJson('http://127.0.0.1:19441/api/config', authHeaders)
    expect(getRes.body.clickDelayMs).toBe(180)
    expect(getRes.body.pointerAnimation).toBe(true)
    expect(getRes.body.autoScroll).toBe(true)
    expect(getRes.body.auroraTheme).toBe('light')
  })

  it('agent activity begin/end api가 제어 상태를 명시적으로 토글한다', async () => {
    const handle = await startCompanionServer({
      host: '127.0.0.1',
      port: 19444,
      homeDir: makeHomeDir(),
    })
    handles.push(handle)

    const origin = 'http://example.local'
    const connectRes = await postJson(
      'http://127.0.0.1:19444/page/connect',
      {
        appId: 'test-app',
        clientId: 'client-agent-1',
        url: 'http://example.local/',
        title: 'Example',
        clientVersion: '0.0.1',
      },
      { origin },
    )
    expect(connectRes.status).toBe(200)

    const sessionId = connectRes.body.sessionId as string
    const sessionToken = connectRes.body.sessionToken as string

    await postJson(
      'http://127.0.0.1:19444/page/sync',
      {
        sessionId,
        snapshot: makeSnapshot(1),
        completedCommands: [],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )

    const authHeaders = agentHeaders(handle)
    await postJson(
      'http://127.0.0.1:19444/api/origins/approve',
      { origin },
      authHeaders,
    )
    await postJson(
      'http://127.0.0.1:19444/api/sessions/activate',
      { sessionId },
      authHeaders,
    )

    const startRes = await postJson(
      'http://127.0.0.1:19444/api/agent-activity/start',
      {},
      authHeaders,
    )
    expect(startRes.status).toBe(200)
    expect(startRes.body.agentActive).toBe(true)

    const activeSync = await postJson(
      'http://127.0.0.1:19444/page/sync',
      {
        sessionId,
        snapshot: makeSnapshot(2),
        completedCommands: [],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )
    expect(activeSync.status).toBe(200)
    expect(activeSync.body.agentActive).toBe(true)

    const endRes = await postJson(
      'http://127.0.0.1:19444/api/agent-activity/end',
      {},
      authHeaders,
    )
    expect(endRes.status).toBe(200)
    expect(endRes.body.agentActive).toBe(false)

    const idleSync = await postJson(
      'http://127.0.0.1:19444/page/sync',
      {
        sessionId,
        snapshot: makeSnapshot(3),
        completedCommands: [],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )
    expect(idleSync.status).toBe(200)
    expect(idleSync.body.agentActive).toBe(false)
  })

  it('agent activity stop api가 명령을 차단하고 start로 재개된다', async () => {
    const handle = await startCompanionServer({
      host: '127.0.0.1',
      port: 19445,
      homeDir: makeHomeDir(),
    })
    handles.push(handle)

    const origin = 'http://example.local'
    const connectRes = await postJson(
      'http://127.0.0.1:19445/page/connect',
      {
        appId: 'test-app',
        clientId: 'client-agent-stop-1',
        url: 'http://example.local/',
        title: 'Example',
        clientVersion: '0.0.1',
      },
      { origin },
    )
    expect(connectRes.status).toBe(200)

    const sessionId = connectRes.body.sessionId as string
    const sessionToken = connectRes.body.sessionToken as string

    await postJson(
      'http://127.0.0.1:19445/page/sync',
      {
        sessionId,
        snapshot: makeSnapshot(1),
        completedCommands: [],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )

    const authHeaders = agentHeaders(handle)
    await postJson(
      'http://127.0.0.1:19445/api/origins/approve',
      { origin },
      authHeaders,
    )
    await postJson(
      'http://127.0.0.1:19445/api/sessions/activate',
      { sessionId },
      authHeaders,
    )

    const stopRes = await postJson(
      'http://127.0.0.1:19445/api/agent-activity/stop',
      {},
      authHeaders,
    )
    expect(stopRes.status).toBe(200)
    expect(stopRes.body.agentActive).toBe(false)
    expect(stopRes.body.agentStopped).toBe(true)

    const stoppedSync = await postJson(
      'http://127.0.0.1:19445/page/sync',
      {
        sessionId,
        snapshot: makeSnapshot(2),
        completedCommands: [],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )
    expect(stoppedSync.status).toBe(200)
    expect(stoppedSync.body.agentActive).toBe(false)
    expect(stoppedSync.body.agentStopped).toBe(true)
    expect(stoppedSync.body.pendingCommands).toEqual([])

    const blockedAct = await postJson(
      'http://127.0.0.1:19445/api/commands/act',
      { targetId: 'login', expectedVersion: 2 },
      authHeaders,
    )
    expect(blockedAct.status).toBe(409)
    expect(blockedAct.body.code).toBe('AGENT_STOPPED')

    const startRes = await postJson(
      'http://127.0.0.1:19445/api/agent-activity/start',
      {},
      authHeaders,
    )
    expect(startRes.status).toBe(200)
    expect(startRes.body.agentActive).toBe(true)

    const resumedSync = await postJson(
      'http://127.0.0.1:19445/page/sync',
      {
        sessionId,
        snapshot: makeSnapshot(3),
        completedCommands: [],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )
    expect(resumedSync.status).toBe(200)
    expect(resumedSync.body.agentActive).toBe(true)
    expect(resumedSync.body.agentStopped).toBe(false)
  })

  it('page agent activity stop/start route가 세션 토큰으로 정지와 재개를 제어한다', async () => {
    const handle = await startCompanionServer({
      host: '127.0.0.1',
      port: 19446,
      homeDir: makeHomeDir(),
    })
    handles.push(handle)

    const origin = 'http://example.local'
    const connectRes = await postJson(
      'http://127.0.0.1:19446/page/connect',
      {
        appId: 'test-app',
        clientId: 'client-page-agent-1',
        url: 'http://example.local/',
        title: 'Example',
        clientVersion: '0.0.1',
      },
      { origin },
    )
    expect(connectRes.status).toBe(200)

    const sessionId = connectRes.body.sessionId as string
    const sessionToken = connectRes.body.sessionToken as string

    await postJson(
      'http://127.0.0.1:19446/page/sync',
      {
        sessionId,
        snapshot: makeSnapshot(1),
        completedCommands: [],
        timestamp: Date.now(),
      },
      pageHeaders(origin, sessionToken),
    )

    const authHeaders = agentHeaders(handle)
    await postJson(
      'http://127.0.0.1:19446/api/origins/approve',
      { origin },
      authHeaders,
    )
    await postJson(
      'http://127.0.0.1:19446/api/sessions/activate',
      { sessionId },
      authHeaders,
    )

    const stopRes = await postJson(
      'http://127.0.0.1:19446/page/agent-activity/stop',
      { sessionId },
      pageHeaders(origin, sessionToken),
    )
    expect(stopRes.status).toBe(200)
    expect(stopRes.body.agentActive).toBe(false)
    expect(stopRes.body.agentStopped).toBe(true)

    const startRes = await postJson(
      'http://127.0.0.1:19446/page/agent-activity/start',
      { sessionId },
      pageHeaders(origin, sessionToken),
    )
    expect(startRes.status).toBe(200)
    expect(startRes.body.agentActive).toBe(true)
    expect(startRes.body.agentStopped).toBe(false)
  })
})
