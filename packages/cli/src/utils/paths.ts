import { join } from 'node:path'
import { AGRUNE_HOME, HOST_NAME } from '../constants.js'
import { homedir } from 'node:os'

export const MCP_SERVER_DIR = join(AGRUNE_HOME, 'mcp-server')
export const VERSION_FILE = join(AGRUNE_HOME, 'version.json')
export const NATIVE_HOST_WRAPPER = join(AGRUNE_HOME, 'native-host')
export const MCP_SERVER_ENTRY = join(AGRUNE_HOME, 'mcp-server/bin/agrune-mcp.js')

const MANIFEST_FILENAME = `${HOST_NAME}.json`

export function getNativeHostManifestPath(): string {
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

export function getClaudeConfigPath(): string {
  const home = homedir()
  return join(home, '.claude.json')
}
