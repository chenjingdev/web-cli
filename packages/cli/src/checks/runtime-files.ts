import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Check } from './types.js'

export function runtimeFilesCheck(agruneHome: string): Check {
  const entryFile = join(agruneHome, 'mcp-server/bin/agrune-mcp.js')

  return {
    name: 'Runtime files',
    async check() {
      if (!existsSync(entryFile)) {
        return { ok: false, message: `${entryFile} not found` }
      }
      return { ok: true, message: 'mcp-server files present' }
    },
    async fix() {
      throw new Error('Runtime files missing. Run `pnpm dlx @agrune/cli setup --force` to reinstall.')
    },
  }
}
