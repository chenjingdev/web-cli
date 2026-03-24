import type {
  CommandErrorShape,
  CommandResult,
  PageSnapshot,
  PageTarget,
} from '@webcli-dom/core'
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
  targetIds: string[]
}

export interface PublicSnapshotTarget {
  targetId: string
  groupId: string
  groupName?: string
  groupDesc?: string
  name: string
  description: string
  actionKind: PageTarget['actionKind']
  visible: boolean
  enabled: boolean
  reason: PageTarget['reason']
  sensitive: boolean
  textContent?: string
}

export interface PublicSnapshot {
  version: number
  url: string
  title: string
  groups: PublicSnapshotGroup[]
  targets: PublicSnapshotTarget[]
}

export type PublicCommandResult =
  | {
      commandId: string
      ok: true
      result?: Record<string, unknown>
      snapshotVersion?: number
    }
  | {
      commandId: string
      ok: false
      error: CommandErrorShape
      snapshotVersion?: number
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

export function toPublicSnapshot(snapshot: PageSnapshot): PublicSnapshot {
  return {
    version: snapshot.version,
    url: snapshot.url,
    title: snapshot.title,
    groups: snapshot.groups.map(group => ({
      groupId: group.groupId,
      groupName: group.groupName,
      groupDesc: group.groupDesc,
      targetIds: group.targetIds,
    })),
    targets: snapshot.targets.map(target => ({
      targetId: target.targetId,
      groupId: target.groupId,
      groupName: target.groupName,
      groupDesc: target.groupDesc,
      name: target.name,
      description: target.description,
      actionKind: target.actionKind,
      visible: target.visible,
      enabled: target.enabled,
      reason: target.reason,
      sensitive: target.sensitive,
      ...(target.textContent ? { textContent: target.textContent } : {}),
    })),
  }
}

export function toPublicCommandResult(result: CommandResult): PublicCommandResult {
  if (result.ok) {
    return {
      commandId: result.commandId,
      ok: true,
      ...(result.result ? { result: result.result } : {}),
      ...(typeof result.snapshotVersion === 'number'
        ? { snapshotVersion: result.snapshotVersion }
        : {}),
    }
  }

  return {
    commandId: result.commandId,
    ok: false,
    error: result.error,
    ...(typeof result.snapshotVersion === 'number'
      ? { snapshotVersion: result.snapshotVersion }
      : {}),
  }
}
