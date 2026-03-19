import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import type {
  CommandResult,
  DragPlacement,
  PageSnapshot,
  PageTarget,
  SessionSnapshot,
} from './types.js'

type TuiAppProps = {
  baseUrl: string
  token: string
  onExit: () => Promise<void> | void
}

type StatusPayload = {
  activeSessionId: string | null
  config: {
    clickDelayMs: number
    pointerAnimation: boolean
    autoScroll: boolean
    cursorName: string
    auroraGlow: boolean
  }
  sessionCount: number
}

const CURSOR_NAMES = ['default', 'orb']

type TuiData = {
  status: StatusPayload | null
  sessions: SessionSnapshot[]
  snapshot: PageSnapshot | null
  logs: Array<{ at: number; message: string; kind: string }>
}

type ActionGroupModel = {
  groupId: string
  label: string
  description?: string
  targets: PageTarget[]
  actionableCount: number
}

type ActionRow =
  | { type: 'group'; group: ActionGroupModel }
  | { type: 'target'; group: ActionGroupModel; target: PageTarget }

type ViewPresentation = 'base' | 'overlay'

type VisibleActionView = {
  presentation: ViewPresentation
  viewKey: string
  groups: ActionGroupModel[]
}

type ActionViewFrame = {
  presentation: ViewPresentation
  viewKey: string
  selectedActionKey: string | null
  actionFilter: string
  collapsedGroups: Record<string, boolean>
}

type DragDraft = {
  sourceTargetId: string
  sourceTargetName: string
  destinationTargetId?: string
  destinationTargetName?: string
  placement: DragPlacement
}

export const DRAG_PLACEMENTS: DragPlacement[] = ['before', 'inside', 'after']

export function getNextDragPlacement(
  current: DragPlacement,
  delta: number,
): DragPlacement {
  const currentIndex = DRAG_PLACEMENTS.indexOf(current)
  const nextIndex =
    (currentIndex + delta + DRAG_PLACEMENTS.length) % DRAG_PLACEMENTS.length
  return DRAG_PLACEMENTS[nextIndex] ?? 'inside'
}

function getActionRowKey(row: ActionRow): string {
  return row.type === 'group' ? `group:${row.group.groupId}` : `target:${row.target.targetId}`
}

function buildActionGroupModels(
  snapshot: PageSnapshot,
  sourceTargets: PageTarget[],
): ActionGroupModel[] {
  const byGroup = new Map<string, PageTarget[]>()
  for (const target of sourceTargets) {
    const items = byGroup.get(target.groupId) ?? []
    items.push(target)
    byGroup.set(target.groupId, items)
  }

  const seenGroupIds = new Set<string>()
  return snapshot.groups
    .filter(group => {
      if (seenGroupIds.has(group.groupId)) {
        return false
      }
      seenGroupIds.add(group.groupId)
      return true
    })
    .map(group => {
      const seenTargetIds = new Set<string>()
      const targets = (byGroup.get(group.groupId) ?? [])
        .slice()
        .filter(target => {
          if (seenTargetIds.has(target.targetId)) {
            return false
          }
          seenTargetIds.add(target.targetId)
          return true
        })
        .sort((left, right) => left.name.localeCompare(right.name))
      return {
        groupId: group.groupId,
        label: group.groupName ?? group.groupId,
        description: group.groupDesc,
        targets,
        actionableCount: targets.filter(canExecuteTarget).length,
      }
    })
    .filter(group => group.targets.length > 0)
}

function buildActionGroups(
  snapshot: PageSnapshot | null,
  presentation: ViewPresentation,
): ActionGroupModel[] {
  if (!snapshot) {
    return []
  }

  if (presentation === 'overlay') {
    const overlayTargets = snapshot.targets.filter(
      target => isOverlayLikeTarget(target) && canExecuteTarget(target),
    )
    if (overlayTargets.length === 0) {
      return []
    }

    const overlayGroupIds = new Set(overlayTargets.map(target => target.groupId))
    return buildActionGroupModels(
      snapshot,
      snapshot.targets.filter(target => overlayGroupIds.has(target.groupId)),
    )
  }

  return buildActionGroupModels(snapshot, snapshot.targets)
}

function buildActionViewKey(
  snapshot: PageSnapshot,
  presentation: ViewPresentation,
  groups: ActionGroupModel[],
): string {
  return JSON.stringify({
    presentation,
    title: snapshot.title,
    url: snapshot.url,
    groups: groups
      .map(group => ({
        groupId: group.groupId,
        targetIds: group.targets.map(target => target.targetId).sort(),
      }))
      .sort((left, right) => left.groupId.localeCompare(right.groupId)),
  })
}

function mergeCollapsedGroups(
  current: Record<string, boolean>,
  groups: ActionGroupModel[],
): Record<string, boolean> {
  const next: Record<string, boolean> = {}
  for (const group of groups) {
    next[group.groupId] = current[group.groupId] ?? true
  }
  return next
}

export function createActionViewFrame(view: VisibleActionView): ActionViewFrame {
  return {
    presentation: view.presentation,
    viewKey: view.viewKey,
    selectedActionKey: view.groups[0] ? `group:${view.groups[0].groupId}` : null,
    actionFilter: '',
    collapsedGroups: mergeCollapsedGroups({}, view.groups),
  }
}

function hydrateActionViewFrame(
  frame: ActionViewFrame,
  view: VisibleActionView,
): ActionViewFrame {
  return {
    ...frame,
    presentation: view.presentation,
    viewKey: view.viewKey,
    collapsedGroups: mergeCollapsedGroups(frame.collapsedGroups, view.groups),
  }
}

function trimTrailingOverlayFrames(frames: ActionViewFrame[]): ActionViewFrame[] {
  let end = frames.length
  while (end > 0 && frames[end - 1]?.presentation === 'overlay') {
    end -= 1
  }
  return frames.slice(0, end)
}

export function reconcileActionViewFrames(
  frames: ActionViewFrame[],
  nextView: VisibleActionView | null,
): ActionViewFrame[] {
  if (!nextView) {
    return []
  }

  if (frames.length === 0) {
    return [createActionViewFrame(nextView)]
  }

  if (nextView.presentation === 'overlay') {
    const top = frames[frames.length - 1]
    if (top?.presentation === 'overlay') {
      return [...frames.slice(0, -1), hydrateActionViewFrame(top, nextView)]
    }
    return [...frames, createActionViewFrame(nextView)]
  }

  const baseFrames = trimTrailingOverlayFrames(frames)
  let existingIndex = -1
  for (let index = baseFrames.length - 1; index >= 0; index -= 1) {
    if (baseFrames[index]?.viewKey === nextView.viewKey) {
      existingIndex = index
      break
    }
  }
  if (existingIndex >= 0) {
    const nextFrames = baseFrames.slice(0, existingIndex + 1)
    nextFrames[existingIndex] = hydrateActionViewFrame(nextFrames[existingIndex], nextView)
    return nextFrames
  }

  return [...baseFrames, createActionViewFrame(nextView)]
}

function normalizeSearchTerm(value: string): string {
  return value.trim().toLowerCase()
}

function matchesSearch(parts: Array<string | null | undefined>, searchTerm: string): boolean {
  if (!searchTerm) {
    return true
  }

  return parts
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
    .toLowerCase()
    .includes(searchTerm)
}

function isOverlayLikeTarget(target: PageTarget): boolean {
  const text = `${target.groupId} ${target.groupName ?? ''} ${target.groupDesc ?? ''}`.toLowerCase()
  return (
    target.overlay ||
    text.includes('modal') ||
    text.includes('drawer') ||
    text.includes('dialog') ||
    text.includes('launchpad')
  )
}

function sliceWindow<T>(items: T[], selectedIndex: number, windowSize: number): T[] {
  if (items.length <= windowSize) {
    return items
  }

  const safeIndex = Math.max(0, Math.min(selectedIndex, items.length - 1))
  const half = Math.floor(windowSize / 2)
  const start = Math.max(0, Math.min(safeIndex - half, items.length - windowSize))
  return items.slice(start, start + windowSize)
}

function toPreviewLines(value: string, maxLines = 6, maxWidth = 62): string[] {
  const normalized = value.replace(/\s+$/g, '')
  const rawLines = normalized.split('\n').flatMap(line => {
    if (line.length <= maxWidth) {
      return [line]
    }

    const chunks: string[] = []
    for (let index = 0; index < line.length; index += maxWidth) {
      chunks.push(line.slice(index, index + maxWidth))
    }
    return chunks
  })

  if (rawLines.length <= maxLines) {
    return rawLines
  }

  return [...rawLines.slice(0, maxLines - 1), '...']
}

export function getTargetStatus(target: PageTarget): string {
  if (typeof target.reason === 'string' && target.reason.length > 0) {
    return target.reason
  }
  if (!target.visible) return 'hidden'
  if ((target.inViewport ?? target.visible) === false) return 'offscreen'
  if ((target.covered ?? false) === true) return 'covered'
  if (!target.enabled) return 'disabled'
  return 'ready'
}

function canExecuteTarget(target: PageTarget): boolean {
  return (
    target.actionableNow ??
    (target.visible &&
      target.enabled &&
      !(target.covered ?? false))
  )
}

export function buildBlockedTargetDetails(target: PageTarget): {
  targetId: string
  reason: string
  actionableNow: boolean
} {
  return {
    targetId: target.targetId,
    reason: getTargetStatus(target),
    actionableNow: canExecuteTarget(target),
  }
}

async function apiRequest<T>(
  baseUrl: string,
  token: string,
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(new URL(pathname, baseUrl), {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as T) : ({} as T)
  if (!response.ok) {
    throw new Error(`${response.status} ${text}`)
  }
  return payload
}

async function apiRequestOrNull<T>(
  baseUrl: string,
  token: string,
  pathname: string,
  init?: RequestInit,
): Promise<T | null> {
  try {
    return await apiRequest<T>(baseUrl, token, pathname, init)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('404 ')) {
      return null
    }
    throw error
  }
}

export function CompanionTuiApp({ baseUrl, token, onExit }: TuiAppProps) {
  const { exit } = useApp()
  const [data, setData] = useState<TuiData>({
    status: null,
    sessions: [],
    snapshot: null,
    logs: [],
  })
  const [activePanel, setActivePanel] = useState(1)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [selectedSetting, setSelectedSetting] = useState(0)
  const [lastResult, setLastResult] = useState<string>('아직 실행 결과가 없습니다.')
  const [fillDraft, setFillDraft] = useState<{ targetId: string; value: string } | null>(null)
  const [dragDraft, setDragDraft] = useState<DragDraft | null>(null)
  const [editingActionFilter, setEditingActionFilter] = useState(false)
  const [actionViewFrames, setActionViewFrames] = useState<ActionViewFrame[]>([])
  const selectedSessionIdRef = useRef<string | null>(selectedSessionId)
  const commandInFlightRef = useRef(false)
  const lastDataSignatureRef = useRef<string>('')
  const panelLabels = ['Sessions', 'Live Actions', 'Details', 'Settings'] as const

  const selectedSessionIndex = Math.max(
    0,
    data.sessions.findIndex(session => session.id === selectedSessionId),
  )
  const selectedSessionItem =
    (selectedSessionId
      ? data.sessions.find(session => session.id === selectedSessionId)
      : null) ??
    data.sessions[0] ??
    null

  const baseActionGroups = useMemo(
    () => buildActionGroups(data.snapshot, 'base'),
    [data.snapshot],
  )
  const overlayActionGroups = useMemo(
    () => buildActionGroups(data.snapshot, 'overlay'),
    [data.snapshot],
  )
  const visibleActionView = useMemo<VisibleActionView | null>(() => {
    if (!data.snapshot) {
      return null
    }

    const presentation: ViewPresentation =
      overlayActionGroups.length > 0 ? 'overlay' : 'base'
    const groups = presentation === 'overlay' ? overlayActionGroups : baseActionGroups
    return {
      presentation,
      groups,
      viewKey: buildActionViewKey(data.snapshot, presentation, groups),
    }
  }, [baseActionGroups, data.snapshot, overlayActionGroups])
  const currentActionFrame =
    actionViewFrames[actionViewFrames.length - 1] ??
    (visibleActionView ? createActionViewFrame(visibleActionView) : null)
  const currentActionFilter = currentActionFrame?.actionFilter ?? ''
  const normalizedActionFilter = normalizeSearchTerm(currentActionFilter)
  const currentActionGroups = visibleActionView?.groups ?? []
  const filteredActionGroups = useMemo<ActionGroupModel[]>(() => {
    if (!normalizedActionFilter) {
      return currentActionGroups
    }

    return currentActionGroups.flatMap(group => {
      const groupMatches = matchesSearch(
        [group.groupId, group.label, group.description],
        normalizedActionFilter,
      )
      const matchedTargets = groupMatches
        ? group.targets
        : group.targets.filter(target =>
            matchesSearch(
              [
                target.targetId,
                target.name,
                target.description,
                target.groupName,
                target.groupDesc,
                target.actionKind,
                target.selector,
                target.textContent,
                target.valuePreview ?? undefined,
              ],
              normalizedActionFilter,
            ),
          )

      if (matchedTargets.length === 0) {
        return []
      }

      return [
        {
          ...group,
          targets: matchedTargets,
          actionableCount: matchedTargets.filter(canExecuteTarget).length,
        },
      ]
    })
  }, [currentActionGroups, normalizedActionFilter])
  const actionRows = useMemo<ActionRow[]>(() => {
    const collapsedGroups = currentActionFrame?.collapsedGroups ?? {}
    return filteredActionGroups.flatMap(group => {
      const header: ActionRow = { type: 'group', group }
      if (normalizedActionFilter) {
        return [header, ...group.targets.map(target => ({ type: 'target' as const, group, target }))]
      }
      if (collapsedGroups[group.groupId] ?? true) {
        return [header]
      }
      return [header, ...group.targets.map(target => ({ type: 'target' as const, group, target }))]
    })
  }, [currentActionFrame?.collapsedGroups, filteredActionGroups, normalizedActionFilter])
  const selectedActionRow = Math.max(
    0,
    actionRows.findIndex(row => getActionRowKey(row) === currentActionFrame?.selectedActionKey),
  )
  const selectedActionItem = actionRows[selectedActionRow] ?? null
  const selectedTarget = selectedActionItem?.type === 'target' ? selectedActionItem.target : null
  const visibleClickTargets = useMemo(
    () =>
      filteredActionGroups.flatMap(group =>
        group.targets.filter(target => target.actionKind === 'click' && canExecuteTarget(target)),
      ),
    [filteredActionGroups],
  )

  const sessionRows = useMemo(
    () => sliceWindow(data.sessions, selectedSessionIndex, 8),
    [data.sessions, selectedSessionIndex],
  )
  const actionWindow = useMemo(
    () => sliceWindow(actionRows, selectedActionRow, 14),
    [actionRows, selectedActionRow],
  )
  const logRows = useMemo(() => data.logs.slice(0, 8), [data.logs])
  const detailRows = useMemo(() => toPreviewLines(lastResult), [lastResult])

  const formatError = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

  const currentCollapsedGroups = currentActionFrame?.collapsedGroups ?? {}

  const updateCurrentActionFrame = (updater: (frame: ActionViewFrame) => ActionViewFrame) => {
    setActionViewFrames(current => {
      const seededFrames =
        current.length > 0
          ? current
          : visibleActionView
            ? [createActionViewFrame(visibleActionView)]
            : []

      if (seededFrames.length === 0) {
        return seededFrames
      }

      const nextFrames = seededFrames.slice()
      nextFrames[nextFrames.length - 1] = updater(nextFrames[nextFrames.length - 1])
      return nextFrames
    })
  }

  const setSelectedActionKey = (selectedActionKey: string | null) => {
    updateCurrentActionFrame(frame => ({
      ...frame,
      selectedActionKey,
    }))
  }

  const moveActionSelection = (delta: number) => {
    if (actionRows.length === 0) {
      return
    }

    const nextIndex = Math.max(
      0,
      Math.min(actionRows.length - 1, selectedActionRow + delta),
    )
    const nextRow = actionRows[nextIndex]
    if (!nextRow) {
      return
    }

    setSelectedActionKey(getActionRowKey(nextRow))
  }

  const clearActionSearch = () => {
    updateCurrentActionFrame(frame => ({
      ...frame,
      actionFilter: '',
    }))
    setEditingActionFilter(false)
  }

  const toggleGroup = (groupId: string) => {
    updateCurrentActionFrame(frame => ({
      ...frame,
      collapsedGroups: {
        ...frame.collapsedGroups,
        [groupId]: !(frame.collapsedGroups[groupId] ?? true),
      },
    }))
  }

  const collapseGroup = (groupId: string) => {
    updateCurrentActionFrame(frame => ({
      ...frame,
      collapsedGroups: {
        ...frame.collapsedGroups,
        [groupId]: true,
      },
    }))
  }

  const expandGroup = (groupId: string) => {
    updateCurrentActionFrame(frame => ({
      ...frame,
      collapsedGroups: {
        ...frame.collapsedGroups,
        [groupId]: false,
      },
    }))
  }

  const refresh = async () => {
    const status = await apiRequest<StatusPayload>(baseUrl, token, '/api/status')
    const sessionsPayload = await apiRequest<{ sessions: SessionSnapshot[] }>(
      baseUrl,
      token,
      '/api/sessions',
    )
    const nextSelectedSession =
      (selectedSessionIdRef.current
        ? sessionsPayload.sessions.find(session => session.id === selectedSessionIdRef.current)
        : null) ??
      null
    const activeSession =
      sessionsPayload.sessions.find(session => session.id === status.activeSessionId) ?? null
    const sessionId = nextSelectedSession?.id ?? activeSession?.id ?? null
    const snapshotPayload =
      sessionId === null
        ? { snapshot: null }
        : ((await apiRequestOrNull<{ snapshot: PageSnapshot | null }>(
            baseUrl,
            token,
            `/api/snapshot?sessionId=${encodeURIComponent(sessionId)}`,
          )) ?? { snapshot: null })
    const logsPayload = await apiRequest<{ logs: Array<{ at: number; message: string; kind: string }> }>(
      baseUrl,
      token,
      '/api/logs?limit=20',
    )

    const nextData: TuiData = {
      status,
      sessions: sessionsPayload.sessions,
      snapshot: snapshotPayload.snapshot,
      logs: logsPayload.logs,
    }
    const signature = JSON.stringify(nextData)
    if (signature !== lastDataSignatureRef.current) {
      lastDataSignatureRef.current = signature
      setData(nextData)
    }
  }

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId
  }, [selectedSessionId])

  useEffect(() => {
    void refresh().catch(error => {
      setLastResult(error instanceof Error ? error.message : String(error))
    })
    const timer = setInterval(() => {
      void refresh().catch(error => {
        setLastResult(error instanceof Error ? error.message : String(error))
      })
    }, 750)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!selectedSessionId) {
      return
    }

    void refresh().catch(error => {
      setLastResult(error instanceof Error ? error.message : String(error))
    })
  }, [selectedSessionId])

  useEffect(() => {
    if (data.sessions.length === 0) {
      if (selectedSessionId !== null) {
        setSelectedSessionId(null)
      }
      return
    }

    const hasSelected =
      selectedSessionId !== null &&
      data.sessions.some(session => session.id === selectedSessionId)
    if (hasSelected) {
      return
    }

    const activeSession =
      (data.status?.activeSessionId
        ? data.sessions.find(session => session.id === data.status?.activeSessionId)
        : null) ?? data.sessions[0]

    if (activeSession) {
      setSelectedSessionId(activeSession.id)
    }
  }, [data.sessions, data.status?.activeSessionId, selectedSessionId])

  useEffect(() => {
    setActionViewFrames(current => reconcileActionViewFrames(current, visibleActionView))
  }, [visibleActionView])

  useEffect(() => {
    if (!currentActionFrame) {
      return
    }

    const nextSelectedActionKey =
      actionRows.length === 0
        ? null
        : currentActionFrame.selectedActionKey &&
            actionRows.some(row => getActionRowKey(row) === currentActionFrame.selectedActionKey)
          ? currentActionFrame.selectedActionKey
          : getActionRowKey(actionRows[0])

    if (nextSelectedActionKey === currentActionFrame.selectedActionKey) {
      return
    }

    setActionViewFrames(current => {
      if (current.length === 0) {
        return current
      }

      const nextFrames = current.slice()
      const topFrame = nextFrames[nextFrames.length - 1]
      if (!topFrame || topFrame.viewKey !== currentActionFrame.viewKey) {
        return current
      }

      nextFrames[nextFrames.length - 1] = {
        ...topFrame,
        selectedActionKey: nextSelectedActionKey,
      }
      return nextFrames
    })
  }, [actionRows, currentActionFrame?.selectedActionKey, currentActionFrame?.viewKey])

  useEffect(() => {
    if (!selectedSessionItem || !data.snapshot) {
      return
    }
    if (selectedSessionItem.active && activePanel === 0) {
      setActivePanel(1)
    }
  }, [activePanel, data.snapshot, selectedSessionItem])

  useEffect(() => {
    if (!dragDraft) {
      return
    }

    if (!data.snapshot) {
      setDragDraft(null)
      return
    }

    const sourceStillExists = data.snapshot.targets.some(
      target => target.targetId === dragDraft.sourceTargetId,
    )
    if (!sourceStillExists) {
      setDragDraft(null)
      setLastResult(`drag source가 snapshot에서 사라졌습니다: ${dragDraft.sourceTargetId}`)
      return
    }

    if (dragDraft.destinationTargetId) {
      const destinationStillExists = data.snapshot.targets.some(
        target => target.targetId === dragDraft.destinationTargetId,
      )
      if (!destinationStillExists) {
        setDragDraft(null)
        setLastResult(
          `drag destination이 snapshot에서 사라졌습니다: ${dragDraft.destinationTargetId}`,
        )
      }
    }
  }, [data.snapshot, dragDraft])

  const ensureSelectedSessionReadyForCommands = async (): Promise<boolean> => {
    if (!selectedSessionItem) {
      setLastResult('선택된 세션이 없습니다.')
      return false
    }

    if (selectedSessionItem.approvalStatus !== 'approved') {
      setLastResult(
        `선택한 세션 origin이 아직 승인되지 않았습니다. Sessions 패널에서 a로 승인한 뒤 다시 실행하세요.`,
      )
      return false
    }

    if (!selectedSessionItem.active) {
      await apiRequest(baseUrl, token, '/api/sessions/activate', {
        method: 'POST',
        body: JSON.stringify({ sessionId: selectedSessionItem.id }),
      })
    }

    return true
  }

  const executeCommand = async (pathname: string, payload: Record<string, unknown>) => {
    const isActionCommand = pathname.startsWith('/api/commands/')

    if (isActionCommand) {
      if (commandInFlightRef.current) {
        return
      }
      commandInFlightRef.current = true
    }

    try {
      if (isActionCommand) {
        const ready = await ensureSelectedSessionReadyForCommands()
        if (!ready) {
          return
        }
      }

      const result = await apiRequest<CommandResult>(baseUrl, token, pathname, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setLastResult(JSON.stringify(result, null, 2))
      await refresh()
    } catch (error) {
      setLastResult(formatError(error))
    } finally {
      if (isActionCommand) {
        commandInFlightRef.current = false
      }
    }
  }

  const approveSelectedOrigin = async () => {
    if (!selectedSessionItem) return
    try {
      await apiRequest(baseUrl, token, '/api/origins/approve', {
        method: 'POST',
        body: JSON.stringify({ origin: selectedSessionItem.origin }),
      })
      setLastResult(`approved origin: ${selectedSessionItem.origin}`)
      await refresh()
    } catch (error) {
      setLastResult(formatError(error))
    }
  }

  const activateSelectedSession = async () => {
    if (!selectedSessionItem) return
    if (selectedSessionItem.approvalStatus !== 'approved') {
      setLastResult('선택한 세션 origin이 아직 승인되지 않았습니다. 먼저 a로 승인하세요.')
      return
    }
    try {
      await apiRequest(baseUrl, token, '/api/sessions/activate', {
        method: 'POST',
        body: JSON.stringify({ sessionId: selectedSessionItem.id }),
      })
      setLastResult(`active session: ${selectedSessionItem.id}`)
      await refresh()
    } catch (error) {
      setLastResult(formatError(error))
    }
  }

  const updateConfig = async (patch: Record<string, unknown>) => {
    try {
      const result = await apiRequest(baseUrl, token, '/api/config', {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      setLastResult(JSON.stringify(result, null, 2))
      await refresh()
    } catch (error) {
      setLastResult(formatError(error))
    }
  }

  const describeBlockedTarget = (target: PageTarget) => {
    setLastResult(
      JSON.stringify(buildBlockedTargetDetails(target), null, 2),
    )
  }

  const beginDragDraft = (target: PageTarget) => {
    setDragDraft({
      sourceTargetId: target.targetId,
      sourceTargetName: target.name,
      placement: 'inside',
    })
    setLastResult(`drag source 선택: ${target.name} (${target.targetId})`)
  }

  const cancelDragDraft = () => {
    if (!dragDraft) {
      return
    }
    setLastResult(`drag 취소: ${dragDraft.sourceTargetName} (${dragDraft.sourceTargetId})`)
    setDragDraft(null)
  }

  const selectDragDestination = (destinationTarget: PageTarget) => {
    if (!dragDraft) {
      return
    }

    if (destinationTarget.targetId === dragDraft.sourceTargetId) {
      setLastResult('drag source와 destination은 달라야 합니다.')
      return
    }

    setDragDraft(current =>
      current
        ? {
            ...current,
            destinationTargetId: destinationTarget.targetId,
            destinationTargetName: destinationTarget.name,
            placement: 'inside',
          }
        : current,
    )
    setLastResult(
      `drag destination 선택: ${destinationTarget.name} (${destinationTarget.targetId}) | 좌우로 placement 선택 후 Enter`,
    )
  }

  const cycleDragPlacement = (delta: number) => {
    setDragDraft(current =>
      current?.destinationTargetId
        ? {
            ...current,
            placement: getNextDragPlacement(current.placement, delta),
          }
        : current,
    )
  }

  const executeDragDraft = () => {
    if (!dragDraft?.destinationTargetId || !dragDraft.destinationTargetName) {
      return
    }

    const sourceTargetId = dragDraft.sourceTargetId
    const sourceTargetName = dragDraft.sourceTargetName
    const destinationTargetId = dragDraft.destinationTargetId
    const destinationTargetName = dragDraft.destinationTargetName
    const placement = dragDraft.placement
    setDragDraft(null)
    clearActionSearch()
    setLastResult(
      `drag 실행: ${sourceTargetName} -> ${destinationTargetName} (${destinationTargetId}) [${placement}]`,
    )
    void executeCommand('/api/commands/drag', {
      sourceTargetId,
      destinationTargetId,
      placement,
      expectedVersion: data.snapshot?.version,
    })
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      Promise.resolve(onExit()).finally(() => exit())
      return
    }
    if (input === 'q') {
      Promise.resolve(onExit()).finally(() => exit())
      return
    }

    if (fillDraft) {
      if (key.escape) {
        setFillDraft(null)
        return
      }
      if (key.return) {
        void executeCommand('/api/commands/fill', {
          targetId: fillDraft.targetId,
          value: fillDraft.value,
          expectedVersion: data.snapshot?.version,
        })
        setFillDraft(null)
        return
      }
      if (key.backspace || key.delete) {
        setFillDraft(current =>
          current ? { ...current, value: current.value.slice(0, -1) } : current,
        )
        return
      }
      if (input) {
        setFillDraft(current => (current ? { ...current, value: current.value + input } : current))
      }
      return
    }

    if (dragDraft && key.escape) {
      cancelDragDraft()
      return
    }

    if (editingActionFilter) {
      if (key.escape) {
        clearActionSearch()
        return
      }
      if (key.return) {
        setEditingActionFilter(false)
        return
      }
      if (key.backspace || key.delete) {
        updateCurrentActionFrame(frame => ({
          ...frame,
          actionFilter: frame.actionFilter.slice(0, -1),
        }))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        updateCurrentActionFrame(frame => ({
          ...frame,
          actionFilter: frame.actionFilter + input,
        }))
      }
      return
    }

    if (key.tab || input === '\t') {
      setActivePanel(current => (current + 1) % 4)
      return
    }

    if (input === 'r') {
      void refresh()
      return
    }

    if (!dragDraft && /^[1-9]$/.test(input)) {
      const index = Number(input) - 1
      const target = visibleClickTargets[index]
      if (target) {
        clearActionSearch()
        void executeCommand('/api/commands/act', {
          targetId: target.targetId,
          expectedVersion: data.snapshot?.version,
        })
      }
      return
    }

    if (activePanel === 0) {
      if (key.upArrow) {
        const nextIndex = Math.max(0, selectedSessionIndex - 1)
        const nextSession = data.sessions[nextIndex]
        if (nextSession) {
          setSelectedSessionId(nextSession.id)
        }
      } else if (key.downArrow) {
        const nextIndex = Math.min(data.sessions.length - 1, selectedSessionIndex + 1)
        const nextSession = data.sessions[nextIndex]
        if (nextSession) {
          setSelectedSessionId(nextSession.id)
        }
      } else if (input === 'a') {
        void approveSelectedOrigin()
      } else if (key.return) {
        void activateSelectedSession()
      }
      return
    }

    if (activePanel === 1) {
      if (dragDraft?.destinationTargetId) {
        if (key.leftArrow) {
          cycleDragPlacement(-1)
        } else if (key.rightArrow) {
          cycleDragPlacement(1)
        } else if (key.return) {
          executeDragDraft()
        }
        return
      }

      if (input === '/') {
        setEditingActionFilter(true)
      } else if (key.escape && currentActionFilter) {
        clearActionSearch()
      } else if (key.upArrow) {
        moveActionSelection(-1)
      } else if (key.downArrow) {
        moveActionSelection(1)
      } else if (!normalizedActionFilter && key.leftArrow && selectedActionItem?.type === 'target') {
        collapseGroup(selectedActionItem.group.groupId)
        setSelectedActionKey(`group:${selectedActionItem.group.groupId}`)
      } else if (!normalizedActionFilter && key.leftArrow && selectedActionItem?.type === 'group') {
        collapseGroup(selectedActionItem.group.groupId)
        setSelectedActionKey(`group:${selectedActionItem.group.groupId}`)
      } else if (!normalizedActionFilter && key.rightArrow && selectedActionItem?.type === 'group') {
        const wasCollapsed = currentCollapsedGroups[selectedActionItem.group.groupId] ?? true
        expandGroup(selectedActionItem.group.groupId)
        const firstTarget = selectedActionItem.group.targets[0]
        if (wasCollapsed && firstTarget) {
          setSelectedActionKey(`target:${firstTarget.targetId}`)
        } else {
          setSelectedActionKey(`group:${selectedActionItem.group.groupId}`)
        }
      } else if (!normalizedActionFilter && key.return && selectedActionItem?.type === 'group') {
        const wasCollapsed = currentCollapsedGroups[selectedActionItem.group.groupId] ?? true
        toggleGroup(selectedActionItem.group.groupId)
        const firstTarget = selectedActionItem.group.targets[0]
        if (wasCollapsed && firstTarget) {
          setSelectedActionKey(`target:${firstTarget.targetId}`)
        } else {
          setSelectedActionKey(`group:${selectedActionItem.group.groupId}`)
        }
      } else if (input === 'd' && selectedTarget) {
        if (!canExecuteTarget(selectedTarget)) {
          describeBlockedTarget(selectedTarget)
          return
        }
        beginDragDraft(selectedTarget)
      } else if (dragDraft && key.return && selectedTarget) {
        selectDragDestination(selectedTarget)
      } else if (key.return && selectedTarget?.actionKind === 'click') {
        if (!canExecuteTarget(selectedTarget)) {
          describeBlockedTarget(selectedTarget)
          return
        }
        clearActionSearch()
        void executeCommand('/api/commands/act', {
          targetId: selectedTarget.targetId,
          expectedVersion: data.snapshot?.version,
        })
      } else if (key.return && selectedTarget?.actionKind === 'fill') {
        if (!canExecuteTarget(selectedTarget)) {
          describeBlockedTarget(selectedTarget)
          return
        }
        clearActionSearch()
        setFillDraft({ targetId: selectedTarget.targetId, value: '' })
      } else if (input === 'g' && selectedTarget?.actionKind === 'click') {
        if (!canExecuteTarget(selectedTarget)) {
          describeBlockedTarget(selectedTarget)
          return
        }
        clearActionSearch()
        void executeCommand('/api/commands/guide', {
          targetId: selectedTarget.targetId,
          expectedVersion: data.snapshot?.version,
        })
      } else if (input === 'e' && selectedTarget?.actionKind === 'fill') {
        if (!canExecuteTarget(selectedTarget)) {
          describeBlockedTarget(selectedTarget)
          return
        }
        clearActionSearch()
        setFillDraft({ targetId: selectedTarget.targetId, value: '' })
      }
      return
    }

    if (activePanel === 3) {
      if (key.upArrow) {
        setSelectedSetting(current => Math.max(0, current - 1))
      } else if (key.downArrow) {
        setSelectedSetting(current => Math.min(3, current + 1))
      } else if (selectedSetting === 0 && (key.leftArrow || key.rightArrow)) {
        const delta = key.rightArrow ? 50 : -50
        void updateConfig({
          clickDelayMs: Math.max(0, (data.status?.config.clickDelayMs ?? 0) + delta),
        })
      } else if (selectedSetting === 1 && (key.return || key.leftArrow || key.rightArrow)) {
        void updateConfig({
          pointerAnimation: !(data.status?.config.pointerAnimation ?? false),
        })
      } else if (selectedSetting === 2 && (key.return || key.leftArrow || key.rightArrow)) {
        void updateConfig({
          autoScroll: !(data.status?.config.autoScroll ?? true),
        })
      } else if (selectedSetting === 3 && (key.leftArrow || key.rightArrow)) {
        const current = data.status?.config.cursorName ?? 'default'
        const idx = CURSOR_NAMES.indexOf(current)
        const next = key.rightArrow
          ? CURSOR_NAMES[(idx + 1) % CURSOR_NAMES.length]
          : CURSOR_NAMES[(idx - 1 + CURSOR_NAMES.length) % CURSOR_NAMES.length]
        void updateConfig({ cursorName: next })
      }
    }
  })

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="cyanBright">webcli-dom companion</Text>
        <Text>  Tab 전환  Enter 실행/토글  d drag  ←→ placement  g guide  좌우 접기  / 검색  Esc 검색해제  a 승인  e fill  r 새로고침  q 종료</Text>
      </Box>
      <Box marginBottom={1}>
        <Text color="yellow">focus: {panelLabels[activePanel]}</Text>
        {dragDraft ? (
          <Text color="yellow">
            {' '}| drag: {dragDraft.sourceTargetName}
            {dragDraft.destinationTargetName
              ? ` -> ${dragDraft.destinationTargetName} [${dragDraft.placement}] Enter로 실행`
              : ' 선택됨, 목적지로 이동 후 Enter'}
          </Text>
        ) : null}
      </Box>

      <Box>
        <Box flexDirection="column" width="25%" marginRight={1} borderStyle="round" borderColor={activePanel === 0 ? 'cyan' : 'gray'}>
          <Text>Sessions</Text>
          {data.sessions.length === 0 ? <Text color="gray">연결된 세션 없음</Text> : null}
          {sessionRows.map(session => {
            const isSelected = session.id === selectedSessionItem?.id
            return (
              <Text key={session.id} color={isSelected ? 'green' : undefined} wrap="truncate-end">
                {isSelected ? '>' : ' '} {session.title || session.appId} [{session.approvalStatus}]
              </Text>
            )
          })}
          {data.sessions.length > sessionRows.length ? <Text color="gray">... {data.sessions.length} sessions</Text> : null}
        </Box>

        <Box flexDirection="column" width="35%" marginRight={1} borderStyle="round" borderColor={activePanel === 1 ? 'cyan' : 'gray'}>
          <Text>Live Actions</Text>
          <Text color={editingActionFilter ? 'yellow' : currentActionFilter ? 'cyan' : 'gray'} wrap="truncate-end">
            {editingActionFilter
              ? `search: ${currentActionFilter}_`
              : currentActionFilter
                ? `search: ${currentActionFilter}`
                : 'search: /로 필터'}
          </Text>
          {currentActionGroups.length === 0 ? <Text color="gray">snapshot 없음</Text> : null}
          {currentActionGroups.length > 0 && normalizedActionFilter && filteredActionGroups.length === 0 ? (
            <Text color="gray">검색 결과 없음</Text>
          ) : null}
          {actionWindow.map(row => {
            const rowKey = getActionRowKey(row)
            const isSelected = rowKey === currentActionFrame?.selectedActionKey

            if (row.type === 'group') {
              const collapsed = currentCollapsedGroups[row.group.groupId] ?? true
              return (
                <Text key={`group:${row.group.groupId}`} color={isSelected ? 'green' : 'cyan'}>
                  {isSelected ? '>' : ' '} {collapsed ? '▸' : '▾'} {row.group.label} [{row.group.actionableCount}/{row.group.targets.length}]
                </Text>
              )
            }

            return (
              <Text
                key={`target:${row.target.targetId}`}
                color={
                  isSelected
                    ? 'green'
                    : dragDraft?.destinationTargetId === row.target.targetId
                      ? 'cyan'
                    : dragDraft?.sourceTargetId === row.target.targetId
                      ? 'yellow'
                      : undefined
                }
                wrap="truncate-end"
              >
                {isSelected ? '>' : ' '}   {row.target.name} ({row.target.actionKind}) [{getTargetStatus(row.target)}]
                {dragDraft?.sourceTargetId === row.target.targetId ? ' <source>' : ''}
                {dragDraft?.destinationTargetId === row.target.targetId
                  ? ` <destination:${dragDraft.placement}>`
                  : ''}
              </Text>
            )
          })}
          {actionRows.length > actionWindow.length ? <Text color="gray">... {actionRows.length} rows</Text> : null}
        </Box>

        <Box flexDirection="column" width="40%" borderStyle="round" borderColor={activePanel === 2 ? 'cyan' : 'gray'}>
          <Text>Details / Result</Text>
          <Text wrap="truncate-end">session: {selectedSessionItem?.id ?? '-'}</Text>
          <Text>snapshot: {data.snapshot?.version ?? '-'}</Text>
          <Text wrap="truncate-end">
            selected: {selectedTarget?.targetId ?? (selectedActionItem?.type === 'group' ? selectedActionItem.group.groupId : '-')}
          </Text>
          {selectedTarget ? (
            <Text wrap="truncate-end">
              reason: {getTargetStatus(selectedTarget)} | actionable: {String(selectedTarget.actionableNow)}
            </Text>
          ) : null}
          {selectedTarget ? (
            <Text wrap="truncate-end">
              derived actionable: {String(canExecuteTarget(selectedTarget))}
            </Text>
          ) : null}
          {dragDraft ? (
            <Text color="yellow" wrap="truncate-end">
              drag source: {dragDraft.sourceTargetName} ({dragDraft.sourceTargetId})
            </Text>
          ) : null}
          {dragDraft?.destinationTargetName ? (
            <Text color="yellow" wrap="truncate-end">
              drag destination: {dragDraft.destinationTargetName} ({dragDraft.destinationTargetId}) [{dragDraft.placement}]
            </Text>
          ) : null}
          {fillDraft ? <Text color="yellow" wrap="truncate-end">fill value: {fillDraft.value}</Text> : null}
          {detailRows.map((line, index) => (
            <Text key={`${index}:${line}`} wrap="truncate-end">{line || ' '}</Text>
          ))}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Box flexDirection="column" width="50%" marginRight={1} borderStyle="round" borderColor={activePanel === 3 ? 'cyan' : 'gray'}>
          <Text>Settings</Text>
          <Text color={selectedSetting === 0 ? 'green' : undefined}>
            {selectedSetting === 0 ? '>' : ' '} clickDelayMs: {data.status?.config.clickDelayMs ?? 0}
          </Text>
          <Text color={selectedSetting === 1 ? 'green' : undefined}>
            {selectedSetting === 1 ? '>' : ' '} pointerAnimation: {String(data.status?.config.pointerAnimation ?? false)}
          </Text>
          <Text color={selectedSetting === 2 ? 'green' : undefined}>
            {selectedSetting === 2 ? '>' : ' '} autoScroll: {String(data.status?.config.autoScroll ?? true)}
          </Text>
          <Text color={selectedSetting === 3 ? 'green' : undefined}>
            {selectedSetting === 3 ? '>' : ' '} cursorName: {data.status?.config.cursorName ?? 'default'} {'</>'}
          </Text>
        </Box>

        <Box flexDirection="column" width="50%" borderStyle="round" borderColor="gray">
          <Text>Logs</Text>
          {logRows.map(log => (
            <Text key={`${log.at}:${log.message}`} wrap="truncate-end">
              [{log.kind}] {log.message}
            </Text>
          ))}
          {data.logs.length > logRows.length ? <Text color="gray">... {data.logs.length} logs</Text> : null}
        </Box>
      </Box>
    </Box>
  )
}
