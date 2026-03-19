import type { WebCliCompiledTarget } from '../../types'
import type { TargetBuildParams } from './shared'

export function toCompiledTarget(params: TargetBuildParams): WebCliCompiledTarget {
  return {
    action: params.action,
    status: params.status,
    groupId: params.group.groupId,
    groupName: params.group.groupName,
    groupDesc: params.group.groupDesc,
    target: {
      targetId: params.targetId,
      name: params.targetName,
      desc: params.targetDesc,
      selector: params.selector,
      sourceFile: params.relativePath,
      sourceLine: params.sourceLine,
      sourceColumn: params.sourceColumn,
    },
  }
}
