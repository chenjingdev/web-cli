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
 * Scans the document for elements annotated with `data-rune-action`
 * and extracts target metadata for each.
 */
export function scanAnnotations(doc: Document): ScannedTarget[] {
  const elements = doc.querySelectorAll<HTMLElement>('[data-rune-action]')
  const targets: ScannedTarget[] = []

  elements.forEach((el, index) => {
    const action = el.getAttribute('data-rune-action') as 'click' | 'fill'
    const name = el.getAttribute('data-rune-name') ?? ''
    const description = el.getAttribute('data-rune-desc') ?? ''
    const key = el.getAttribute('data-rune-key')
    const sensitive = el.hasAttribute('data-rune-sensitive')

    const targetId = key ?? `wcli_${index}`
    const selector = key
      ? `[data-rune-key="${key}"]`
      : name
        ? `[data-rune-name="${name}"]`
        : `[data-rune-action]`

    // Find closest ancestor with data-rune-group
    const groupEl = el.closest<HTMLElement>('[data-rune-group]')
    const groupId = groupEl?.getAttribute('data-rune-group') ?? undefined

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
 * Scans the document for elements annotated with `data-rune-group`
 * and extracts group metadata.
 */
export function scanGroups(doc: Document): ScannedGroup[] {
  const elements = doc.querySelectorAll<HTMLElement>('[data-rune-group]')
  const groups: ScannedGroup[] = []

  elements.forEach((el) => {
    const groupId = el.getAttribute('data-rune-group') ?? ''
    const name = el.getAttribute('data-rune-group-name') ?? ''
    const description = el.getAttribute('data-rune-group-desc') ?? ''

    groups.push({ groupId, name, description })
  })

  return groups
}
