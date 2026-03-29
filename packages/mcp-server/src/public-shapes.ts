import type {
  CommandErrorShape,
  CommandResult,
  PageSnapshot,
  PageSnapshotGroup,
  PageTarget,
} from '@agrune/core'
import type { Session } from './session-manager.js'

export interface PublicSession {
  tabId: number
  url: string
  title: string
  hasSnapshot: boolean
  snapshotVersion: number | null
}

export interface PublicSnapshotGroup {
  groupId: string
  groupName?: string
  groupDesc?: string
  targetCount: number
  actionKinds: PageTarget['actionKinds'][number][]
  sampleTargetNames: string[]
  meta?: unknown
}

export interface PublicSnapshotTarget {
  targetId: string
  groupId: string
  name: string
  description: string
  actionKinds: PageTarget['actionKinds']
  reason?: PageTarget['reason']
  sensitive?: boolean
  textContent?: string
  center?: { x: number; y: number }
  size?: { w: number; h: number }
  coordSpace?: 'viewport' | 'canvas'
}

export interface PublicSnapshotOptions {
  mode?: 'outline' | 'full'
  groupIds?: string[]
  includeTextContent?: boolean
  // includeRect removed — center+size always included when present
}

export interface PublicSnapshot {
  version: number
  url: string
  title: string
  context: 'page' | 'overlay'
  groups?: PublicSnapshotGroup[]
  targets?: PublicSnapshotTarget[]
}

export type PublicCommandResult =
  | {
      commandId: string
      ok: true
      result?: Record<string, unknown>
    }
  | {
      commandId: string
      ok: false
      error: CommandErrorShape
    }

export function toPublicSession(session: Session): PublicSession {
  return {
    tabId: session.tabId,
    url: session.url,
    title: session.title || session.snapshot?.title || '',
    hasSnapshot: session.snapshot !== null,
    snapshotVersion: session.snapshot?.version ?? null,
  }
}

function toPublicTarget(target: PageTarget, includeTextContent: boolean): PublicSnapshotTarget {
  return {
    targetId: target.targetId,
    groupId: target.groupId,
    name: target.name,
    description: target.description,
    actionKinds: target.actionKinds,
    ...(target.reason !== 'ready' ? { reason: target.reason } : {}),
    ...(target.sensitive ? { sensitive: true } : {}),
    ...(includeTextContent && target.textContent ? { textContent: target.textContent } : {}),
    ...(target.center ? { center: target.center } : {}),
    ...(target.size ? { size: target.size } : {}),
    ...(target.coordSpace ? { coordSpace: target.coordSpace } : {}),
  }
}

function getActiveContext(snapshot: PageSnapshot): {
  context: PublicSnapshot['context']
  targets: PageTarget[]
} {
  const actionableTargets = snapshot.targets.filter(target => target.actionableNow)
  const overlayTargets = actionableTargets.filter(target => target.overlay)

  if (overlayTargets.length > 0) {
    return {
      context: 'overlay',
      targets: overlayTargets,
    }
  }

  return {
    context: 'page',
    targets: actionableTargets,
  }
}

function toPublicGroups(targets: PageTarget[], snapshotGroups: PageSnapshotGroup[]): PublicSnapshotGroup[] {
  const metaMap = new Map(
    snapshotGroups
      .filter(g => g.meta !== undefined)
      .map(g => [g.groupId, g.meta]),
  )

  const groups = new Map<string, { groupId: string; groupName?: string; groupDesc?: string; targets: PageTarget[] }>()

  for (const target of targets) {
    const existing = groups.get(target.groupId)
    if (existing) {
      existing.targets.push(target)
      continue
    }

    groups.set(target.groupId, {
      groupId: target.groupId,
      groupName: target.groupName,
      groupDesc: target.groupDesc,
      targets: [target],
    })
  }

  return Array.from(groups.values()).map(group => ({
    groupId: group.groupId,
    groupName: group.groupName,
    groupDesc: group.groupDesc,
    targetCount: group.targets.length,
    actionKinds: [...new Set(group.targets.flatMap(target => target.actionKinds))],
    sampleTargetNames: group.targets
      .map(target => target.name)
      .filter(name => name.length > 0)
      .slice(0, 3),
    ...(metaMap.has(group.groupId) ? { meta: metaMap.get(group.groupId) } : {}),
  }))
}

export function toPublicSnapshot(
  snapshot: PageSnapshot,
  options: PublicSnapshotOptions = {},
): PublicSnapshot {
  const activeContext = getActiveContext(snapshot)
  const requestedGroupIds = new Set(options.groupIds ?? [])
  const includeTargets = requestedGroupIds.size > 0 || options.mode === 'full'
  const expandedTargets =
    requestedGroupIds.size > 0
      ? activeContext.targets.filter(target => requestedGroupIds.has(target.groupId))
      : activeContext.targets

  return {
    version: snapshot.version,
    url: snapshot.url,
    title: snapshot.title,
    context: activeContext.context,
    groups: toPublicGroups(activeContext.targets, snapshot.groups),
    ...(includeTargets ? { targets: expandedTargets.map(t => toPublicTarget(t, options.includeTextContent ?? false)) } : {}),
  }
}

export function toPublicCommandResult(result: CommandResult): PublicCommandResult {
  if (result.ok) {
    return {
      commandId: result.commandId,
      ok: true,
      ...(result.result ? { result: result.result } : {}),
    }
  }

  return {
    commandId: result.commandId,
    ok: false,
    error: result.error,
  }
}
