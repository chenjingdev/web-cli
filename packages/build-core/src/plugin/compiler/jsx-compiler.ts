import { parse as babelParse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import type { JSXOpeningElement } from '@babel/types'
import type {
  WebCliCompiledTarget,
  WebCliDiagnostic,
  WebCliToolStatus,
} from '../../types'
import type { ResolvedWebCliDomOptions } from '../options'
import { planJsxNodeAttrStripEdits, planJsxTrackingAttrEdit, applyEdits } from './edit-planner'
import { resolveJsxGroupContext } from './group-resolver'
import { toCompiledTarget } from './target-builder'
import { validateJsxTargetNode } from './validators'
import {
  WEBCLI_ATTRS,
  buildDiagnostic,
  buildSelector,
  getExt,
  getJsxAttr,
  type CompileResult,
  type Edit,
} from './shared'

type TraverseFn = typeof import('@babel/traverse').default

const traverse: TraverseFn =
  (traverseModule as unknown as { default?: TraverseFn }).default ??
  (traverseModule as unknown as TraverseFn)

export function jsxCompile(
  code: string,
  relativePath: string,
  options: ResolvedWebCliDomOptions,
  emitTrackingAttr: boolean,
): CompileResult {
  const diagnostics: WebCliDiagnostic[] = []
  const entries: WebCliCompiledTarget[] = []
  const edits: Edit[] = []
  const attrsToStrip = new Set<string>([...WEBCLI_ATTRS, options.groupAttr])

  const ext = getExt(relativePath)
  const useTs = ext === '.ts' || ext === '.tsx'

  let ast
  try {
    ast = babelParse(code, {
      sourceType: 'module',
      plugins: useTs ? ['jsx', 'typescript'] : ['jsx'],
      errorRecovery: false,
    })
  } catch (err) {
    diagnostics.push(
      buildDiagnostic(
        'error',
        'WCLI_COMPILE_PARSE_ERROR',
        `JSX 파싱 실패: ${err instanceof Error ? err.message : String(err)}`,
        relativePath,
        1,
        1,
      ),
    )
    return { code, changed: false, entries, diagnostics }
  }

  traverse(ast, {
    JSXOpeningElement(path: any) {
      const node = path.node as JSXOpeningElement
      if (!getJsxAttr(node, 'data-webcli-action')) return

      const validated = validateJsxTargetNode(node, relativePath, diagnostics)
      if (!validated) return

      let hasHardError = false
      const group = resolveJsxGroupContext(
        path,
        options,
        relativePath,
        diagnostics,
        validated.line,
        validated.column,
      )

      if (group.hasErrors) {
        hasHardError = true
      }

      if (!emitTrackingAttr && (!options.preserveSourceAttrs || !validated.explicitKey)) {
        diagnostics.push(
          buildDiagnostic(
            'error',
            'WCLI_COMPILE_MISSING_ATTR',
            'emitTrackingAttr=none 사용 시 data-webcli-key를 명시하고 preserveSourceAttrs=true 여야 합니다.',
            relativePath,
            validated.line,
            validated.column,
          ),
        )
        hasHardError = true
      }

      if (hasHardError) return

      if (!options.preserveSourceAttrs) {
        // 동적 속성(name/desc)은 런타임에서 DOM에서 읽어야 하므로 제거하지 않는다
        const nodeAttrsToStrip = new Set(attrsToStrip)
        if (validated.targetName === null) nodeAttrsToStrip.delete('data-webcli-name')
        if (validated.targetDesc === null) nodeAttrsToStrip.delete('data-webcli-desc')
        edits.push(...planJsxNodeAttrStripEdits(node, nodeAttrsToStrip))
        for (const stripOpening of group.stripOpenings) {
          edits.push(...planJsxNodeAttrStripEdits(stripOpening, attrsToStrip))
        }
      }

      const supported = validated.action === 'click' || validated.action === 'fill'
      const status: WebCliToolStatus = supported ? 'active' : 'skipped_unsupported_action'

      if (!supported) {
        const diagLevel =
          options.unsupportedActionHandling === 'error' ? 'error' : 'warning'
        diagnostics.push(
          buildDiagnostic(
            diagLevel,
            'WCLI_COMPILE_UNSUPPORTED_ACTION',
            `지원하지 않는 action '${validated.action}' 입니다. v1에서는 click과 fill만 활성화됩니다.`,
            relativePath,
            validated.line,
            validated.column,
          ),
        )
      }

      if (emitTrackingAttr) {
        const trackingEdit = planJsxTrackingAttrEdit(node, validated.targetId)
        if (trackingEdit) {
          edits.push(trackingEdit)
        }
      }

      entries.push(
        toCompiledTarget({
          action: validated.action,
          status,
          group: group.context,
          targetId: validated.targetId,
          targetName: validated.targetName,
          targetDesc: validated.targetDesc,
          selector: buildSelector(emitTrackingAttr, validated.targetId),
          relativePath,
          sourceLine: validated.line,
          sourceColumn: validated.column,
        }),
      )
    },
  })

  const applied = applyEdits(code, edits)
  return {
    code: applied.code,
    changed: applied.changed,
    entries,
    diagnostics,
  }
}
