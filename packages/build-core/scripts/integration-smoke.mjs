import { constants as fsConstants } from 'node:fs'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const BUNDLERS = ['vite', 'rollup', 'webpack']

function parseBundlerArg() {
  const value = process.argv
    .find(arg => arg.startsWith('--bundler='))
    ?.split('=')[1]

  if (!value) return BUNDLERS
  if (!BUNDLERS.includes(value)) {
    throw new Error(`Unsupported bundler: ${value}`)
  }
  return [value]
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function createFixture(rootDir, registerFile) {
  await mkdir(rootDir, { recursive: true })

  const mainJs = `import ${JSON.stringify(registerFile)};
console.log('webcli-dom bundler smoke');
`

  const pageHtml = `<nav data-webcli-group="navigation" data-webcli-group-desc="네비게이션 클릭 도구">
  <button data-webcli-action="click" data-webcli-name="home" data-webcli-desc="홈 탭">Go</button>
  <button data-webcli-action="hover" data-webcli-name="secondary" data-webcli-desc="지원되지 않는 액션">Skip</button>
</nav>
`

  await writeFile(path.join(rootDir, 'main.js'), mainJs, 'utf8')
  await writeFile(path.join(rootDir, 'page.html'), pageHtml, 'utf8')
}

async function verifyManifest(outDir) {
  const manifestFile = path.join(outDir, 'webcli.manifest.json')
  const raw = await readFile(manifestFile, 'utf8')
  const manifest = JSON.parse(raw)
  assert(manifest.version === 2, 'manifest.version must be 2')
  assert(manifest.exposureMode === 'grouped', 'manifest.exposureMode must be grouped by default')
  assert(Array.isArray(manifest.groups), 'manifest.groups must be an array')

  const tools = manifest.groups.flatMap(group => group.tools)
  assert(tools.length > 0, 'manifest should include tools')
  assert(tools.some(tool => tool.status === 'active'), 'should include active tools')
  assert(
    tools.some(tool => tool.status === 'skipped_unsupported_action'),
    'should include skipped unsupported tools',
  )
}

async function runVite(vitePluginFactory, workDir) {
  const { build } = await import('vite')
  await build({
    configFile: false,
    root: workDir,
    logLevel: 'silent',
    plugins: [vitePluginFactory()],
    build: {
      emptyOutDir: true,
      outDir: 'dist',
      rollupOptions: {
        input: path.join(workDir, 'main.js'),
      },
    },
  })
  await verifyManifest(path.join(workDir, 'dist'))
}

async function runRollup(rollupPluginFactory, workDir) {
  const { rollup } = await import('rollup')
  const bundle = await rollup({
    input: path.join(workDir, 'main.js'),
    plugins: [rollupPluginFactory()],
  })
  await bundle.write({
    dir: path.join(workDir, 'dist'),
    entryFileNames: 'bundle.js',
    format: 'esm',
  })
  await bundle.close()
  await verifyManifest(path.join(workDir, 'dist'))
}

async function runWebpack(webpackPluginFactory, workDir) {
  const webpackMod = await import('webpack')
  const webpack = webpackMod.default ?? webpackMod

  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: 'production',
      context: workDir,
      entry: './main.js',
      output: {
        filename: 'bundle.js',
        path: path.join(workDir, 'dist'),
      },
      plugins: [webpackPluginFactory()],
    })

    compiler.run((error, stats) => {
      compiler.close(() => {})
      if (error) {
        reject(error)
        return
      }
      if (!stats || stats.hasErrors()) {
        reject(new Error(stats?.toString({ all: false, errors: true, warnings: true })))
        return
      }
      resolve(undefined)
    })
  })

  await verifyManifest(path.join(workDir, 'dist'))
}

async function runBundler(bundler, pluginFactories, registerFile) {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), `webcli-dom-${bundler}-`))
  const prevCwd = process.cwd()
  try {
    await createFixture(tmpRoot, registerFile)
    process.chdir(tmpRoot)

    if (bundler === 'vite') {
      await runVite(pluginFactories.vitePluginFactory, tmpRoot)
      return
    }
    if (bundler === 'rollup') {
      await runRollup(pluginFactories.rollupPluginFactory, tmpRoot)
      return
    }
    if (bundler === 'webpack') {
      await runWebpack(pluginFactories.webpackPluginFactory, tmpRoot)
      return
    }
    throw new Error(`Unsupported bundler: ${bundler}`)
  } finally {
    process.chdir(prevCwd)
    await rm(tmpRoot, { recursive: true, force: true })
  }
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(scriptDir, '..')
  const distViteFile = path.join(projectRoot, 'dist', 'vite.js')
  const distRollupFile = path.join(projectRoot, 'dist', 'rollup.js')
  const distWebpackFile = path.join(projectRoot, 'dist', 'webpack.js')
  const distRegisterFile = path.join(projectRoot, 'dist', 'register.js')

  await access(distViteFile, fsConstants.F_OK)
  await access(distRollupFile, fsConstants.F_OK)
  await access(distWebpackFile, fsConstants.F_OK)
  await access(distRegisterFile, fsConstants.F_OK)

  const viteModule = await import(pathToFileURL(distViteFile).href)
  const rollupModule = await import(pathToFileURL(distRollupFile).href)
  const webpackModule = await import(pathToFileURL(distWebpackFile).href)

  const pluginFactories = {
    vitePluginFactory: viteModule.default,
    rollupPluginFactory: rollupModule.default,
    webpackPluginFactory: webpackModule.default,
  }

  const bundlers = parseBundlerArg()

  for (const bundler of bundlers) {
    await runBundler(bundler, pluginFactories, distRegisterFile)
    console.log(`[integration] ${bundler}: ok`)
  }
}

await main()
