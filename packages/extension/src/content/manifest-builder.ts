import type { ScannedTarget, ScannedGroup } from './dom-scanner'
import type {
  AgruneGroupEntry,
  AgruneManifest,
  AgruneTargetEntry,
  AgruneToolEntry,
} from '@agrune/build-core'

const DEFAULT_GROUP_ID = 'default'
const DEFAULT_GROUP_NAME = 'Default'

function toTargetEntry(target: ScannedTarget): AgruneTargetEntry {
  return {
    targetId: target.targetId,
    name: target.name || null,
    desc: target.description || null,
    selector: target.selector,
    sourceFile: '',
    sourceLine: 0,
    sourceColumn: 0,
  }
}

function toToolEntry(target: ScannedTarget): AgruneToolEntry {
  return {
    toolName: target.name || target.targetId,
    toolDesc: target.description || '',
    action: target.actionKinds.join(','),
    status: 'active',
    targets: [toTargetEntry(target)],
  }
}

/**
 * Converts scanned DOM targets and groups into the runtime manifest used by
 * installPageAgentRuntime().
 */
export function buildManifest(
  targets: ScannedTarget[],
  groups: ScannedGroup[],
): AgruneManifest {
  if (targets.length === 0) {
    return {
      version: 2,
      generatedAt: new Date().toISOString(),
      exposureMode: 'per-element',
      groups: [],
    }
  }

  const groupMap = new Map<string, ScannedGroup>()
  for (const g of groups) {
    groupMap.set(g.groupId, g)
  }

  // Group targets by groupId
  const toolsByGroup = new Map<string, AgruneToolEntry[]>()
  for (const target of targets) {
    const gid = target.groupId ?? DEFAULT_GROUP_ID
    let tools = toolsByGroup.get(gid)
    if (!tools) {
      tools = []
      toolsByGroup.set(gid, tools)
    }
    tools.push(toToolEntry(target))
  }

  // Build group entries
  const groupEntries: AgruneGroupEntry[] = []
  for (const [gid, tools] of toolsByGroup) {
    const scannedGroup = groupMap.get(gid)
    groupEntries.push({
      groupId: gid,
      groupName: scannedGroup?.name || (gid === DEFAULT_GROUP_ID ? DEFAULT_GROUP_NAME : gid),
      groupDesc: scannedGroup?.description || undefined,
      tools,
    })
  }

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    exposureMode: 'per-element',
    groups: groupEntries,
  }
}
