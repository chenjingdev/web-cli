export interface ScannedTarget {
  targetId: string
  selector: string
  name: string
  description: string
  actionKind: 'click' | 'fill'
  groupId?: string
  sensitive: boolean
}

export interface ScannedGroup {
  groupId: string
  name: string
  description: string
}

/**
 * Scans the document for elements annotated with `data-agrune-action`
 * and extracts target metadata for each.
 */
export function scanAnnotations(doc: Document): ScannedTarget[] {
  const elements = doc.querySelectorAll<HTMLElement>('[data-agrune-action]')
  const targets: ScannedTarget[] = []

  elements.forEach((el, index) => {
    const action = el.getAttribute('data-agrune-action') as 'click' | 'fill'
    const name = el.getAttribute('data-agrune-name') ?? ''
    const description = el.getAttribute('data-agrune-desc') ?? ''
    const key = el.getAttribute('data-agrune-key')
    const sensitive = el.hasAttribute('data-agrune-sensitive')

    const targetId = key ?? `agrune_${index}`
    const selector = key
      ? `[data-agrune-key="${key}"]`
      : name
        ? `[data-agrune-name="${name}"]`
        : `[data-agrune-action]`

    // Find closest ancestor with data-agrune-group
    const groupEl = el.closest<HTMLElement>('[data-agrune-group]')
    const groupId = groupEl?.getAttribute('data-agrune-group') ?? undefined

    targets.push({
      targetId,
      selector,
      name,
      description,
      actionKind: action,
      groupId,
      sensitive,
    })
  })

  return targets
}

/**
 * Scans the document for elements annotated with `data-agrune-group`
 * and extracts group metadata.
 */
export function scanGroups(doc: Document): ScannedGroup[] {
  const elements = doc.querySelectorAll<HTMLElement>('[data-agrune-group]')
  const groups: ScannedGroup[] = []

  elements.forEach((el) => {
    const groupId = el.getAttribute('data-agrune-group') ?? ''
    const name = el.getAttribute('data-agrune-group-name') ?? ''
    const description = el.getAttribute('data-agrune-group-desc') ?? ''

    groups.push({ groupId, name, description })
  })

  return groups
}
