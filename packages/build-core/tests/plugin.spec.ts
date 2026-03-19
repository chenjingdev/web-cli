import { describe, expect, it } from 'vitest'
import { webCliDomUnplugin } from '../src/plugin/index'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { WEBCLI_MANIFEST_UPDATE_EVENT } from '../src/hmr-events'

type HookContext = {
  warn: (message: string) => void
  error: (message: string) => never
  emitFile: (asset: { type: 'asset'; fileName: string; source: string }) => void
  meta?: { watchMode?: boolean }
}

describe('plugin', () => {
  it('virtual module을 resolve/load한다', () => {
    const pluginInstance = webCliDomUnplugin.rollup()
    const plugin = Array.isArray(pluginInstance) ? pluginInstance[0] : pluginInstance

    const resolveId =
      typeof plugin.resolveId === 'function'
        ? plugin.resolveId
        : plugin.resolveId?.handler
    const load =
      typeof plugin.load === 'function' ? plugin.load : plugin.load?.handler

    const resolved = resolveId?.call(
      {} as never,
      'virtual:webcli-dom/manifest',
      undefined,
      { attributes: {}, isEntry: false },
    )
    expect(resolved).toBe('webcli-dom:manifest')

    const packageResolved = resolveId?.call(
      {} as never,
      '@webcli-dom/build-core/manifest',
      undefined,
      { attributes: {}, isEntry: false },
    )
    expect(packageResolved).toBe('webcli-dom:manifest')

    const loaded = load?.call({} as never, 'webcli-dom:manifest', undefined)
    expect(typeof loaded).toBe('string')
    expect(String(loaded)).toContain('export default')
    expect(String(loaded)).toContain('export const runtimeOptions')
  })

  it('transform + generateBundle로 grouped manifest(v2)를 생성한다', async () => {
    const pluginInstance = webCliDomUnplugin.rollup()
    const plugin = Array.isArray(pluginInstance) ? pluginInstance[0] : pluginInstance
    const warnings: string[] = []
    const assets: Array<{ type: 'asset'; fileName: string; source: string }> = []

    const ctx: HookContext = {
      warn: msg => warnings.push(msg),
      error: msg => {
        throw new Error(msg)
      },
      emitFile: asset => assets.push(asset),
      meta: { watchMode: true },
    }

    const buildStart =
      typeof plugin.buildStart === 'function'
        ? plugin.buildStart
        : plugin.buildStart?.handler
    const transform =
      typeof plugin.transform === 'function'
        ? plugin.transform
        : plugin.transform?.handler
    const generateBundle =
      typeof plugin.generateBundle === 'function'
        ? plugin.generateBundle
        : plugin.generateBundle?.handler

    await buildStart?.call(ctx as never, {} as never)

    const source = `
      <nav data-webcli-group="navigation" data-webcli-group-desc="네비게이션 도구">
        <button data-webcli-action="click" data-webcli-name="home" data-webcli-desc="홈">Go</button>
        <button data-webcli-action="hover" data-webcli-name="menu" data-webcli-desc="메뉴">Skip</button>
      </nav>
    `
    const transformed = await transform?.call(
      ctx as never,
      source,
      '/Users/test/src/sample.html',
      undefined,
    )

    expect(transformed && typeof transformed === 'object' && 'code' in transformed).toBe(true)
    await generateBundle?.call(ctx as never, {} as never, {} as never, false)

    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some(message => message.includes('WCLI_COMPILE_UNSUPPORTED_ACTION'))).toBe(
      true,
    )
    expect(assets).toHaveLength(1)
    expect(assets[0].fileName).toBe('webcli.manifest.json')

    const manifest = JSON.parse(assets[0].source)
    expect(manifest.version).toBe(2)
    expect(manifest.exposureMode).toBe('grouped')
    expect(Array.isArray(manifest.groups)).toBe(true)

    const tools = manifest.groups.flatMap((group: { tools: unknown[] }) => group.tools)
    expect(tools.some((tool: { status: string }) => tool.status === 'active')).toBe(true)
    expect(
      tools.some((tool: { status: string }) => tool.status === 'skipped_unsupported_action'),
    ).toBe(true)
  })

  it('strict=false에서는 compile error를 warning으로 내보낸다', async () => {
    const pluginInstance = webCliDomUnplugin.rollup({ strict: false })
    const plugin = Array.isArray(pluginInstance) ? pluginInstance[0] : pluginInstance
    const warnings: string[] = []
    let errorCalled = false

    const ctx: HookContext = {
      warn: msg => warnings.push(msg),
      error: msg => {
        errorCalled = true
        throw new Error(msg)
      },
      emitFile: () => {},
      meta: { watchMode: true },
    }

    const transform =
      typeof plugin.transform === 'function'
        ? plugin.transform
        : plugin.transform?.handler

    await transform?.call(
      ctx as never,
      `<button data-webcli-action="click">Go</button>`,
      '/Users/test/src/invalid.html',
      undefined,
    )

    expect(errorCalled).toBe(false)
    expect(warnings.some(message => message.includes('WCLI_COMPILE_MISSING_ATTR'))).toBe(true)
  })

  it('vite handleHotUpdate에서 custom manifest-update 이벤트를 전송한다', async () => {
    const vitePlugin = webCliDomUnplugin.vite()
    const plugin = (Array.isArray(vitePlugin) ? vitePlugin[0] : vitePlugin) as any

    const configureServer = plugin.vite?.configureServer as
      | ((server: unknown) => void)
      | undefined
    const handleHotUpdate = plugin.vite?.handleHotUpdate as
      | ((ctx: unknown) => Promise<unknown>)
      | undefined
    expect(typeof configureServer).toBe('function')
    expect(typeof handleHotUpdate).toBe('function')

    const sent: Array<{ type: string; event: string; data: unknown }> = []

    configureServer?.({
      ws: {
        send: (payload: { type: string; event: string; data: unknown }) => {
          sent.push(payload)
        },
      },
      moduleGraph: {
        getModuleById: () => undefined,
        invalidateModule: () => {},
      },
    } as never)

    const tempFile = path.join(process.cwd(), '__tmp_webcli_hmr_test.tsx')
    await fs.writeFile(
      tempFile,
      `<button data-webcli-action="click" data-webcli-name="home" data-webcli-desc="홈">Home</button>`,
      'utf8',
    )

    try {
      const updated = await handleHotUpdate?.({
        file: tempFile,
        modules: [],
      } as never)

      const event = sent.find(payload => payload.event === WEBCLI_MANIFEST_UPDATE_EVENT)
      expect(event).toBeDefined()
      expect(event?.type).toBe('custom')
      expect(event?.data).toHaveProperty('manifest')
      expect(event?.data).toHaveProperty('runtimeOptions')
      expect(Array.isArray(updated)).toBe(true)
      expect(updated).toEqual([])
    } finally {
      await fs.rm(tempFile, { force: true })
    }
  })
})
