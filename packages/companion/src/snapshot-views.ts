import type {
  ApprovalStatus,
  PageSnapshot,
  PageSnapshotGroup,
  PageTarget,
  SnapshotSummaryGroup,
  SnapshotSummaryPayload,
  SnapshotTargetsPayload,
  SnapshotViewMode,
} from './types.js'

interface SummaryOptions {
  includeBackground?: boolean
}

interface TargetOptions {
  includeBackground?: boolean
  includeBlocked?: boolean
  query?: string
}

function isRunnableTarget(target: PageTarget): boolean {
  return target.actionableNow === true
}

export function getSnapshotViewMode(snapshot: PageSnapshot): SnapshotViewMode {
  return snapshot.targets.some(target => target.overlay && isRunnableTarget(target))
    ? 'overlay'
    : 'base'
}

function normalizeQuery(query: string | undefined): string {
  return typeof query === 'string' ? query.trim().toLowerCase() : ''
}

function matchesTargetQuery(target: PageTarget, query: string): boolean {
  if (!query) return true
  const haystack = [
    target.groupId,
    target.groupName ?? '',
    target.groupDesc ?? '',
    target.name,
    target.description,
    target.textContent ?? '',
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(query)
}

function isFlowBlockedBackgroundTarget(
  target: PageTarget,
  mode: SnapshotViewMode,
  includeBackground: boolean,
): boolean {
  return mode === 'overlay' && !includeBackground && !target.overlay
}

function filterTargets(
  snapshot: PageSnapshot,
  options: Required<TargetOptions>,
): PageTarget[] {
  const mode = getSnapshotViewMode(snapshot)
  return snapshot.targets.filter(target => {
    if (isFlowBlockedBackgroundTarget(target, mode, options.includeBackground)) {
      return false
    }
    if (!options.includeBlocked && !isRunnableTarget(target)) {
      return false
    }
    if (!matchesTargetQuery(target, options.query)) {
      return false
    }
    return true
  })
}

function describeGroup(group: Pick<PageSnapshotGroup, 'groupId' | 'groupName' | 'groupDesc'>): string {
  return group.groupDesc ?? group.groupName ?? group.groupId
}

function findGroupMeta(
  snapshot: PageSnapshot,
  groupId: string,
): Pick<PageSnapshotGroup, 'groupId' | 'groupName' | 'groupDesc'> {
  const group = snapshot.groups.find(item => item.groupId === groupId)
  if (group) {
    return group
  }

  const fallback = snapshot.targets.find(target => target.groupId === groupId)
  return {
    groupDesc: fallback?.groupDesc,
    groupId,
    groupName: fallback?.groupName,
  }
}

export function buildSnapshotSummaryPayload(params: {
  sessionId: string
  approvalStatus: ApprovalStatus
  snapshot: PageSnapshot | null
  options?: SummaryOptions
}): SnapshotSummaryPayload {
  const { approvalStatus, sessionId, snapshot } = params
  const includeBackground = params.options?.includeBackground === true

  if (!snapshot) {
    return {
      approvalStatus,
      capturedAt: null,
      groups: [],
      mode: null,
      sessionId,
      title: null,
      url: null,
      version: null,
    }
  }

  const mode = getSnapshotViewMode(snapshot)
  const runnableTargets = filterTargets(snapshot, {
    includeBackground,
    includeBlocked: false,
    query: '',
  })

  const actionableCounts = new Map<string, number>()
  for (const target of runnableTargets) {
    actionableCounts.set(target.groupId, (actionableCounts.get(target.groupId) ?? 0) + 1)
  }

  const groups: SnapshotSummaryGroup[] = Array.from(actionableCounts.entries())
    .map(([groupId, actionableCount]) => {
      const group = findGroupMeta(snapshot, groupId)
      return {
        actionableCount,
        description: describeGroup(group),
        groupDesc: group.groupDesc,
        groupId: group.groupId,
        groupName: group.groupName,
      }
    })
    .sort((left, right) => left.groupId.localeCompare(right.groupId))

  return {
    approvalStatus,
    capturedAt: snapshot.capturedAt,
    groups,
    mode,
    sessionId,
    title: snapshot.title,
    url: snapshot.url,
    version: snapshot.version,
  }
}

export function buildSnapshotTargetsPayload(params: {
  sessionId: string
  approvalStatus: ApprovalStatus
  snapshot: PageSnapshot | null
  groupId: string
  options?: TargetOptions
}): SnapshotTargetsPayload {
  const { approvalStatus, groupId, sessionId, snapshot } = params
  const includeBackground = params.options?.includeBackground === true
  const includeBlocked = params.options?.includeBlocked === true
  const query = normalizeQuery(params.options?.query)

  if (!snapshot) {
    return {
      approvalStatus,
      capturedAt: null,
      description: groupId,
      groupId,
      mode: null,
      sessionId,
      targets: [],
      title: null,
      url: null,
      version: null,
    }
  }

  const mode = getSnapshotViewMode(snapshot)
  const group = findGroupMeta(snapshot, groupId)
  const targets = filterTargets(snapshot, {
    includeBackground,
    includeBlocked,
    query,
  })
    .filter(target => target.groupId === groupId)
    .sort((left, right) => left.name.localeCompare(right.name))

  return {
    approvalStatus,
    capturedAt: snapshot.capturedAt,
    description: describeGroup(group),
    groupDesc: group.groupDesc,
    groupId,
    groupName: group.groupName,
    mode,
    sessionId,
    targets,
    title: snapshot.title,
    url: snapshot.url,
    version: snapshot.version,
  }
}
