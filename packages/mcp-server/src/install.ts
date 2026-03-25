import { execSync } from 'node:child_process'
import {
  copyFileSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  rmSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve, dirname } from 'node:path'
import { homedir, platform } from 'node:os'
import { fileURLToPath } from 'node:url'

const HOST_NAME = 'com.agrune.agrune'
const MANIFEST_FILENAME = `${HOST_NAME}.json`
const AGRUNE_HOME = join(homedir(), '.agrune')
const EXTENSION_DIR = join(AGRUNE_HOME, 'extension')

export interface ExtensionManifest {
  key?: string
}

export interface ExtensionLoadPlan {
  shouldAttemptAutoLoad: boolean
  shouldOpenExtensionsPage: boolean
  instructions: string[]
}

export function getNativeHostPath(): string {
  const home = homedir()

  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', MANIFEST_FILENAME)
    case 'linux':
      return join(home, '.config', 'google-chrome', 'NativeMessagingHosts', MANIFEST_FILENAME)
    default:
      throw new Error(`Unsupported platform: ${process.platform}`)
  }
}

export function getNativeHostManifest(binaryPath: string, extensionId: string) {
  return {
    name: HOST_NAME,
    description: 'agrune MCP server native messaging host',
    path: binaryPath,
    type: 'stdio' as const,
    allowed_origins: [`chrome-extension://${extensionId}/`],
  }
}

export function readExtensionManifest(manifestPath: string): ExtensionManifest {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ExtensionManifest
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`Invalid extension manifest at ${manifestPath}`)
  }
  return manifest
}

export function deriveExtensionIdFromManifestKey(key: string): string {
  const publicKeyBytes = Buffer.from(key, 'base64')
  if (publicKeyBytes.length === 0) {
    throw new Error('Extension manifest key is empty or invalid')
  }

  const hash = createHash('sha256').update(publicKeyBytes).digest()
  let extensionId = ''

  for (const byte of hash.subarray(0, 16)) {
    extensionId += String.fromCharCode('a'.charCodeAt(0) + (byte >> 4))
    extensionId += String.fromCharCode('a'.charCodeAt(0) + (byte & 0x0f))
  }

  return extensionId
}

export function resolveExtensionId(
  manifestPath: string,
  extensionIdOverride?: string,
): string {
  if (extensionIdOverride) {
    return extensionIdOverride
  }

  const manifest = readExtensionManifest(manifestPath)
  if (!manifest.key) {
    throw new Error(
      `Extension manifest at ${manifestPath} is missing "key". Pass --extension-id or add a fixed key.`,
    )
  }

  return deriveExtensionIdFromManifestKey(manifest.key)
}

export function installNativeHost(binaryPath: string, extensionId: string): string {
  const manifestPath = getNativeHostPath()
  const manifest = getNativeHostManifest(binaryPath, extensionId)

  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')

  return manifestPath
}

export function isChromeRunning(): boolean {
  if (platform() !== 'darwin') {
    return false
  }

  try {
    execSync('pgrep -x "Google Chrome"', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function getExtensionLoadPlan(
  currentPlatform: NodeJS.Platform,
  extensionDir: string,
  chromeRunning: boolean,
): ExtensionLoadPlan {
  const manualSteps = [
    'chrome://extensions -> Developer mode ON -> Load unpacked',
    extensionDir,
  ]

  if (currentPlatform !== 'darwin') {
    return {
      shouldAttemptAutoLoad: false,
      shouldOpenExtensionsPage: false,
      instructions: manualSteps,
    }
  }

  if (chromeRunning) {
    return {
      shouldAttemptAutoLoad: false,
      shouldOpenExtensionsPage: true,
      instructions: [
        'Google Chrome is already running, so automatic unpacked extension loading may be ignored.',
        ...manualSteps,
      ],
    }
  }

  return {
    shouldAttemptAutoLoad: true,
    shouldOpenExtensionsPage: false,
    instructions: [
      'If the extension does not appear automatically, load it manually:',
      ...manualSteps,
    ],
  }
}

// --- Auto-install ---

function findProjectRoot(): string {
  const thisDir = typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url))
  let dir = resolve(thisDir)
  while (dir !== '/') {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    dir = resolve(dir, '..')
  }
  throw new Error('Could not find project root (no pnpm-workspace.yaml found)')
}

function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry)
    const destPath = join(dest, entry)
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

export async function runInstall(options?: { extensionId?: string }): Promise<void> {
  console.log('agrune: Installing...\n')

  // 1. Create ~/.agrune/ directory
  mkdirSync(AGRUNE_HOME, { recursive: true })

  // 2. Find project root and build the extension
  const projectRoot = findProjectRoot()
  const extensionPkg = join(projectRoot, 'packages/extension')

  console.log('1. Building extension...')
  execSync('pnpm run build', { cwd: extensionPkg, stdio: 'inherit' })

  // 3. Copy extension to stable location (~/.agrune/extension/)
  console.log('2. Installing extension to ~/.agrune/extension/...')
  // Clean previous installation
  if (existsSync(EXTENSION_DIR)) {
    rmSync(EXTENSION_DIR, { recursive: true })
  }
  mkdirSync(EXTENSION_DIR, { recursive: true })

  // Copy dist/ directory (contains built JS)
  const distDir = join(extensionPkg, 'dist')
  if (existsSync(distDir)) {
    copyDir(distDir, join(EXTENSION_DIR, 'dist'))
  }

  // Copy manifest.json
  copyFileSync(join(extensionPkg, 'manifest.json'), join(EXTENSION_DIR, 'manifest.json'))

  // Copy icon files referenced by manifest
  const iconFile = join(extensionPkg, 'icon-128.png')
  if (existsSync(iconFile)) {
    copyFileSync(iconFile, join(EXTENSION_DIR, 'icon-128.png'))
  }

  // Copy popup.html if it exists (manifest references src/popup/popup.html)
  const popupHtml = join(extensionPkg, 'src/popup/popup.html')
  if (existsSync(popupHtml)) {
    mkdirSync(join(EXTENSION_DIR, 'src/popup'), { recursive: true })
    copyFileSync(popupHtml, join(EXTENSION_DIR, 'src/popup/popup.html'))
  }

  // 4. Build and copy mcp-server
  console.log('3. Building mcp-server...')
  execSync('pnpm run build', { cwd: join(projectRoot, 'packages/mcp-server'), stdio: 'inherit' })
  const mcpServerDist = join(projectRoot, 'packages/mcp-server/dist')
  const mcpServerDest = join(AGRUNE_HOME, 'mcp-server')
  if (existsSync(mcpServerDest)) rmSync(mcpServerDest, { recursive: true })
  copyDir(mcpServerDist, mcpServerDest)

  // 5. Create wrapper shell script (like Claude Code's pattern)
  console.log('4. Creating native host wrapper...')
  const wrapperPath = join(AGRUNE_HOME, 'native-host')
  const entryJs = join(AGRUNE_HOME, 'mcp-server/bin/agrune-mcp.js')
  writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      '# agrune native messaging host',
      '# Generated by agrune-mcp install - do not edit manually',
      `exec "${process.execPath}" "${entryJs}" --native-host`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  )

  // 6. Install Native Messaging Host config
  console.log('5. Installing native messaging host config...')
  const extensionManifestPath = join(EXTENSION_DIR, 'manifest.json')
  const extensionId = resolveExtensionId(extensionManifestPath, options?.extensionId)
  const hostPath = installNativeHost(wrapperPath, extensionId)
  console.log(`   -> ${hostPath}`)

  // 7. Open Chrome with the unpacked extension on macOS
  console.log('\n6. Loading extension in Chrome...')
  console.log('   Extension installed to:', EXTENSION_DIR)
  const loadPlan = getExtensionLoadPlan(platform(), EXTENSION_DIR, isChromeRunning())

  if (platform() === 'darwin' && loadPlan.shouldAttemptAutoLoad) {
    try {
      execSync(`open -a "Google Chrome" --args --load-extension="${EXTENSION_DIR}"`)
      console.log('   -> Chrome opened with extension loaded')
    } catch {
      console.log('   -> Could not auto-open Chrome. Please load manually:')
      for (const instruction of loadPlan.instructions) {
        console.log(`     ${instruction}`)
      }
    }
  } else {
    if (loadPlan.shouldOpenExtensionsPage) {
      try {
        execSync('open -a "Google Chrome" "chrome://extensions"')
        console.log('   -> Opened chrome://extensions for manual loading')
      } catch {
        console.log('   -> Could not open chrome://extensions automatically')
      }
    }

    console.log('   Load the extension manually:')
    for (const instruction of loadPlan.instructions) {
      console.log(`   ${instruction}`)
    }
  }

  // 8. Summary
  console.log('\nInstallation complete!')
  console.log(`\nNative messaging host configured for extension: ${extensionId}`)
}
