import * as p from '@clack/prompts'
import { runAllChecks } from '../checks/index.js'
import { runtimeFilesCheck } from '../checks/runtime-files.js'
import { nativeHostManifestCheck, nativeHostWrapperCheck } from '../checks/native-host.js'
import { claudeMcpCheck, codexMcpCheck } from '../checks/mcp-config.js'
import { readVersionFile } from '../utils/version.js'
import { VERSION_FILE } from '../utils/paths.js'
import { AGRUNE_HOME, CLI_VERSION } from '../constants.js'

export function getAllChecks() {
  return [
    runtimeFilesCheck(AGRUNE_HOME),
    nativeHostManifestCheck(),
    nativeHostWrapperCheck(),
    claudeMcpCheck(),
    codexMcpCheck(),
  ]
}

export async function runDoctor(): Promise<void> {
  p.intro('agrune doctor')

  const results = await runAllChecks(getAllChecks())

  let issues = 0
  for (const { check, result } of results) {
    if (result.ok) {
      p.log.success(`${check.name}: ${result.message}`)
    } else {
      p.log.error(`${check.name}: ${result.message}`)
      issues++
    }
  }

  const versionData = readVersionFile(VERSION_FILE)
  if (versionData && versionData.version !== CLI_VERSION) {
    p.log.warning(`버전 ${versionData.version} → ${CLI_VERSION} 업데이트 가능`)
  }

  if (issues > 0) {
    p.outro(`${issues}개 문제 발견. \`pnpm dlx @agrune/cli repair\`로 복구할 수 있습니다.`)
  } else {
    p.outro('모든 항목 정상!')
  }
}
