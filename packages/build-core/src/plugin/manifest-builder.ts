import type {
  WebCliCompiledTarget,
  WebCliGroupEntry,
  WebCliManifest,
  WebCliToolEntry,
} from '../types'
import type { ResolvedWebCliDomOptions } from './options'
import { toGroupToolName, toPerElementToolName } from './helpers'

interface ToolBucket {
  groupId: string
  groupName?: string
  groupDesc?: string
  action: string
  targets: WebCliCompiledTarget['target'][]
  hasActive: boolean
}

export function buildManifest(
  entries: WebCliCompiledTarget[],
  options: ResolvedWebCliDomOptions,
): WebCliManifest {
  const buckets = new Map<string, ToolBucket>()

  for (const entry of entries) {
    const key = `${entry.groupId}::${entry.action}`
    const bucket = buckets.get(key)
    if (!bucket) {
      buckets.set(key, {
        groupId: entry.groupId,
        groupName: entry.groupName,
        groupDesc: entry.groupDesc,
        action: entry.action,
        targets: [entry.target],
        hasActive: entry.status === 'active',
      })
      continue
    }

    if (!bucket.groupName && entry.groupName) bucket.groupName = entry.groupName
    if (!bucket.groupDesc && entry.groupDesc) bucket.groupDesc = entry.groupDesc
    bucket.targets.push(entry.target)
    if (entry.status === 'active') bucket.hasActive = true
  }

  const grouped = new Map<string, WebCliGroupEntry>()

  const sortedBuckets = Array.from(buckets.values()).sort((a, b) => {
    const groupCmp = a.groupId.localeCompare(b.groupId)
    if (groupCmp !== 0) return groupCmp
    return a.action.localeCompare(b.action)
  })

  for (const bucket of sortedBuckets) {
    const groupEntry = grouped.get(bucket.groupId) ?? {
      groupId: bucket.groupId,
      groupName: bucket.groupName,
      groupDesc: bucket.groupDesc,
      tools: [],
    }

    if (!groupEntry.groupName && bucket.groupName) groupEntry.groupName = bucket.groupName
    if (!groupEntry.groupDesc && bucket.groupDesc) groupEntry.groupDesc = bucket.groupDesc

    if (options.exposureMode === 'grouped') {
      const stableSeed = bucket.targets
        .map(target => `${target.sourceFile}:${target.targetId}`)
        .sort()
        .join('|')

      const toolName = toGroupToolName(
        options.toolPrefix,
        bucket.groupId,
        bucket.action,
        `${bucket.groupId}:${bucket.action}:${stableSeed}`,
      )

      const toolDesc =
        bucket.groupDesc ??
        `${bucket.groupName ?? bucket.groupId} 그룹에서 ${bucket.action} 액션을 실행합니다.`

      const tool: WebCliToolEntry = {
        toolName,
        toolDesc,
        action: bucket.action,
        status: bucket.hasActive ? 'active' : 'skipped_unsupported_action',
        targets: bucket.targets
          .slice()
          .sort((a, b) => a.targetId.localeCompare(b.targetId)),
      }

      groupEntry.tools.push(tool)
      grouped.set(bucket.groupId, groupEntry)
      continue
    }

    const sortedTargets = bucket.targets
      .slice()
      .sort((a, b) => a.targetId.localeCompare(b.targetId))

    for (const target of sortedTargets) {
      const tool: WebCliToolEntry = {
        toolName: toPerElementToolName(
          options.toolPrefix,
          bucket.action,
          target.name,
          target.sourceFile,
          target.targetId,
        ),
        toolDesc:
          bucket.groupDesc ??
          target.desc ??
          `${target.name ?? target.targetId}에 ${bucket.action} 액션을 실행합니다.`,
        action: bucket.action,
        status: bucket.hasActive ? 'active' : 'skipped_unsupported_action',
        targets: [target],
      }
      groupEntry.tools.push(tool)
    }

    grouped.set(bucket.groupId, groupEntry)
  }

  const groups = Array.from(grouped.values())
    .map(group => ({
      ...group,
      tools: group.tools.sort((a, b) => a.toolName.localeCompare(b.toolName)),
    }))
    .sort((a, b) => a.groupId.localeCompare(b.groupId))

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    exposureMode: options.exposureMode,
    groups,
  }
}
