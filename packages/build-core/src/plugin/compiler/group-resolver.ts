import type { JSXElement, JSXOpeningElement } from '@babel/types'
import type { ResolvedWebCliDomOptions } from '../options'
import type { WebCliDiagnostic } from '../../types'
import { isLikelyDynamicExpression } from '../helpers'
import {
  GROUP_META_ATTRS,
  buildDiagnostic,
  findAttr,
  getJsxAttr,
  jsxAttrToStaticString,
  type AnyNode,
  type GroupContext,
} from './shared'

export interface HtmlGroupResolution {
  context: GroupContext
  stripNodes: AnyNode[]
  hasErrors: boolean
}

export interface JsxGroupResolution {
  context: GroupContext
  stripOpenings: JSXOpeningElement[]
  hasErrors: boolean
}

function readHtmlOptionalMeta(
  node: AnyNode,
  attrName: string,
  relativePath: string,
  diagnostics: WebCliDiagnostic[],
  fallbackLine: number,
  fallbackColumn: number,
): string | undefined {
  const attr = findAttr(node, attrName)
  if (!attr) return undefined

  const loc = node.sourceCodeLocation?.attrs?.[attrName]
  const line = loc?.startLine ?? fallbackLine
  const column = loc?.startCol ?? fallbackColumn

  if (!attr.value || attr.value.trim() === '') {
    diagnostics.push(
      buildDiagnostic(
        'error',
        'WCLI_COMPILE_EMPTY_ATTR',
        `${attrName} 값은 비어 있을 수 없습니다.`,
        relativePath,
        line,
        column,
      ),
    )
    return undefined
  }

  if (isLikelyDynamicExpression(attr.value)) {
    diagnostics.push(
      buildDiagnostic(
        'error',
        'WCLI_COMPILE_DYNAMIC_ATTR',
        `${attrName}는 정적 문자열이어야 합니다.`,
        relativePath,
        line,
        column,
      ),
    )
    return undefined
  }

  return attr.value.trim()
}

export function resolveHtmlGroupContext(
  node: AnyNode,
  options: ResolvedWebCliDomOptions,
  relativePath: string,
  diagnostics: WebCliDiagnostic[],
  fallbackLine: number,
  fallbackColumn: number,
): HtmlGroupResolution {
  let cursor: AnyNode | undefined = node
  let boundaryNode: AnyNode | undefined

  while (cursor) {
    if (findAttr(cursor, options.groupAttr)) {
      boundaryNode = cursor
      break
    }
    cursor = cursor.parentNode
  }

  const context: GroupContext = {
    groupId: 'default',
  }

  const metaSourceNode =
    boundaryNode ??
    (() => {
      let candidate: AnyNode | undefined = node
      while (candidate) {
        const current: AnyNode = candidate
        const hasMeta = GROUP_META_ATTRS.some(attrName => Boolean(findAttr(current, attrName)))
        if (hasMeta) return current
        candidate = current.parentNode
      }
      return undefined
    })()

  const startDiagnosticCount = diagnostics.length

  if (boundaryNode) {
    const groupId = readHtmlOptionalMeta(
      boundaryNode,
      options.groupAttr,
      relativePath,
      diagnostics,
      fallbackLine,
      fallbackColumn,
    )
    if (groupId) context.groupId = groupId
  }

  if (metaSourceNode) {
    context.groupName = readHtmlOptionalMeta(
      metaSourceNode,
      'data-webcli-group-name',
      relativePath,
      diagnostics,
      fallbackLine,
      fallbackColumn,
    )
    context.groupDesc = readHtmlOptionalMeta(
      metaSourceNode,
      'data-webcli-group-desc',
      relativePath,
      diagnostics,
      fallbackLine,
      fallbackColumn,
    )
  }

  const stripNodes = Array.from(
    new Set([boundaryNode, metaSourceNode].filter((value): value is AnyNode => Boolean(value))),
  )

  return {
    context,
    stripNodes,
    hasErrors: diagnostics.length > startDiagnosticCount,
  }
}

function readJsxOptionalMeta(
  node: JSXOpeningElement,
  attrName: string,
  relativePath: string,
  diagnostics: WebCliDiagnostic[],
  fallbackLine: number,
  fallbackColumn: number,
): string | undefined {
  const attr = getJsxAttr(node, attrName)
  if (!attr) return undefined

  const line = attr.loc?.start.line ?? fallbackLine
  const column = attr.loc?.start.column ?? fallbackColumn
  const parsed = jsxAttrToStaticString(attr)

  if (!parsed.isStatic) {
    diagnostics.push(
      buildDiagnostic(
        'error',
        'WCLI_COMPILE_DYNAMIC_ATTR',
        `${attrName}는 정적 문자열이어야 합니다.`,
        relativePath,
        line,
        column,
      ),
    )
    return undefined
  }

  if (!parsed.value || parsed.value.trim() === '') {
    diagnostics.push(
      buildDiagnostic(
        'error',
        'WCLI_COMPILE_EMPTY_ATTR',
        `${attrName} 값은 비어 있을 수 없습니다.`,
        relativePath,
        line,
        column,
      ),
    )
    return undefined
  }

  return parsed.value.trim()
}

function getJsxAncestorOpeningElements(path: any): JSXOpeningElement[] {
  const result: JSXOpeningElement[] = []
  const seen = new Set<JSXOpeningElement>()
  const pushUnique = (opening: JSXOpeningElement | null | undefined) => {
    if (!opening || seen.has(opening)) return
    seen.add(opening)
    result.push(opening)
  }

  let cursor = path
  while (cursor) {
    if (cursor.isJSXOpeningElement?.()) {
      pushUnique(cursor.node as JSXOpeningElement)
    }
    if (cursor.isJSXElement?.()) {
      pushUnique((cursor.node as JSXElement).openingElement)
    }
    cursor = cursor.parentPath
  }

  return result
}

export function resolveJsxGroupContext(
  path: any,
  options: ResolvedWebCliDomOptions,
  relativePath: string,
  diagnostics: WebCliDiagnostic[],
  fallbackLine: number,
  fallbackColumn: number,
): JsxGroupResolution {
  const ancestors = getJsxAncestorOpeningElements(path)
  const boundaryNode = ancestors.find((opening: JSXOpeningElement) => {
    return Boolean(getJsxAttr(opening, options.groupAttr))
  })

  const context: GroupContext = {
    groupId: 'default',
  }

  const startDiagnosticCount = diagnostics.length

  if (boundaryNode) {
    const groupId = readJsxOptionalMeta(
      boundaryNode,
      options.groupAttr,
      relativePath,
      diagnostics,
      fallbackLine,
      fallbackColumn,
    )
    if (groupId) context.groupId = groupId
  }

  const metaSourceNode =
    boundaryNode ??
    ancestors.find((opening: JSXOpeningElement) => {
      return GROUP_META_ATTRS.some(attrName => Boolean(getJsxAttr(opening, attrName)))
    })

  if (metaSourceNode) {
    context.groupName = readJsxOptionalMeta(
      metaSourceNode,
      'data-webcli-group-name',
      relativePath,
      diagnostics,
      fallbackLine,
      fallbackColumn,
    )
    context.groupDesc = readJsxOptionalMeta(
      metaSourceNode,
      'data-webcli-group-desc',
      relativePath,
      diagnostics,
      fallbackLine,
      fallbackColumn,
    )
  }

  const stripOpenings = Array.from(
    new Set(
      [boundaryNode, metaSourceNode].filter(
        (value): value is JSXOpeningElement => Boolean(value),
      ),
    ),
  )

  return {
    context,
    stripOpenings,
    hasErrors: diagnostics.length > startDiagnosticCount,
  }
}
