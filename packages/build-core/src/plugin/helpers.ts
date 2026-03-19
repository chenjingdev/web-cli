import { createHash } from 'node:crypto'

export function shortHash(input: string, len = 8): string {
  return createHash('sha256').update(input).digest('hex').slice(0, len)
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')

  return slug || 'tool'
}

export function isLikelyDynamicExpression(value: string): boolean {
  const trimmed = value.trim()
  return /^\{[\s\S]*\}$/.test(trimmed) || /^\{\{[\s\S]*\}\}$/.test(trimmed)
}

export function toGroupToolName(
  toolPrefix: string,
  groupId: string,
  action: string,
  seed: string,
): string {
  return `${toolPrefix}_${slugify(groupId)}_${action}__${shortHash(seed)}`
}

export function toPerElementToolName(
  toolPrefix: string,
  action: string,
  displayName: string | null,
  relativePath: string,
  targetId: string,
): string {
  return `${toolPrefix}_${action}_${slugify(displayName ?? targetId)}__${shortHash(
    `${relativePath}:${targetId}`,
  )}`
}
