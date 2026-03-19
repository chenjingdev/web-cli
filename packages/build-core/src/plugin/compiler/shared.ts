import type { JSXAttribute, JSXOpeningElement } from '@babel/types'
import type {
  WebCliCompiledTarget,
  WebCliDiagnostic,
  WebCliToolStatus,
} from '../../types'
import { shortHash } from '../helpers'

export const TARGET_REQ_ATTRS = [
  'data-webcli-action',
  'data-webcli-name',
  'data-webcli-desc',
] as const

export const TARGET_OPT_ATTRS = ['data-webcli-key', 'data-webcli-group'] as const

export const GROUP_META_ATTRS = [
  'data-webcli-group-name',
  'data-webcli-group-desc',
] as const

export const WEBCLI_ATTRS = [...TARGET_REQ_ATTRS, ...TARGET_OPT_ATTRS, ...GROUP_META_ATTRS] as const

export const DOM_KEY_ATTR = 'data-webcli-key'

export interface CompileResult {
  code: string
  changed: boolean
  entries: WebCliCompiledTarget[]
  diagnostics: WebCliDiagnostic[]
}

export interface Edit {
  start: number
  end: number
  content: string
}

export type AnyNode = {
  nodeName?: string
  tagName?: string
  attrs?: Array<{ name: string; value: string }>
  childNodes?: AnyNode[]
  parentNode?: AnyNode
  sourceCodeLocation?: {
    startLine: number
    startCol: number
    attrs?: Record<
      string,
      {
        startLine: number
        startCol: number
        startOffset: number
        endOffset: number
      }
    >
    startTag?: {
      startOffset: number
      endOffset: number
    }
  }
}

export interface GroupContext {
  groupId: string
  groupName?: string
  groupDesc?: string
}

export function buildDiagnostic(
  level: 'warning' | 'error',
  code: WebCliDiagnostic['code'],
  message: string,
  file: string,
  line: number,
  column: number,
): WebCliDiagnostic {
  return { level, code, message, file, line, column }
}

export function mkTargetId(relativePath: string, line: number, column: number): string {
  return `wcli_${shortHash(`${relativePath}:${line}:${column}`)}`
}

export function getExt(file: string): string {
  const noQuery = file.split('?')[0]
  const idx = noQuery.lastIndexOf('.')
  if (idx < 0) return ''
  return noQuery.slice(idx).toLowerCase()
}

export function isHtmlLike(file: string): boolean {
  return ['.html', '.htm', '.vue', '.svelte'].includes(getExt(file))
}

export function canContainJsx(file: string): boolean {
  return ['.js', '.jsx', '.ts', '.tsx'].includes(getExt(file))
}

export function walkHtml(node: AnyNode, cb: (node: AnyNode) => void): void {
  cb(node)
  if (!node.childNodes?.length) return
  for (const child of node.childNodes) {
    walkHtml(child, cb)
  }
}

export function findAttr(
  node: AnyNode,
  name: string,
): { name: string; value: string } | undefined {
  return node.attrs?.find(attr => attr.name === name)
}

export function getAttrTrimmedValue(node: AnyNode, name: string): string | undefined {
  const attr = findAttr(node, name)
  if (!attr) return undefined
  const trimmed = attr.value.trim()
  return trimmed === '' ? undefined : trimmed
}

export function getJsxAttr(
  node: JSXOpeningElement,
  name: string,
): JSXAttribute | undefined {
  return node.attributes.find(
    attr => attr.type === 'JSXAttribute' && attr.name.name === name,
  ) as JSXAttribute | undefined
}

export function jsxAttrToStaticString(
  attr: JSXAttribute | undefined,
): { value?: string; isStatic: boolean } {
  if (!attr || !attr.value) return { value: undefined, isStatic: false }
  if (attr.value.type === 'StringLiteral') {
    return { value: attr.value.value, isStatic: true }
  }
  return { value: undefined, isStatic: false }
}

export function buildSelector(emitTrackingAttr: boolean, targetId: string): string {
  return emitTrackingAttr
    ? `[${DOM_KEY_ATTR}="${targetId}"]`
    : `[data-webcli-key="${targetId}"]`
}

export interface TargetBuildParams {
  action: string
  status: WebCliToolStatus
  group: GroupContext
  targetId: string
  targetName: string | null
  targetDesc: string | null
  selector: string
  relativePath: string
  sourceLine: number
  sourceColumn: number
}
