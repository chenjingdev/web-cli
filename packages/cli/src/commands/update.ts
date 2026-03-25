import * as p from '@clack/prompts'
import { readVersionFile } from '../utils/version.js'
import { VERSION_FILE } from '../utils/paths.js'
import { AGRUNE_HOME, CLI_VERSION, CWS_EXTENSION_ID } from '../constants.js'
import { installRuntime, getAssetsDir } from './setup.js'
import { installNativeHostWrapper, installNativeHostManifest } from '../utils/native-host.js'

export async function runUpdate(): Promise<void> {
  p.intro('agrune update')

  const versionData = readVersionFile(VERSION_FILE)

  if (!versionData) {
    p.log.error('agrune이 설치되어 있지 않습니다. `setup`을 먼저 실행하세요.')
    p.outro('')
    return
  }

  if (versionData.version === CLI_VERSION) {
    p.outro(`이미 최신 버전입니다 (${CLI_VERSION})`)
    return
  }

  p.log.info(`${versionData.version} → ${CLI_VERSION} 업데이트`)

  const s = p.spinner()

  s.start('런타임 업데이트 중...')
  installRuntime(getAssetsDir(), AGRUNE_HOME)
  s.stop('런타임 업데이트 완료')

  s.start('네이티브 호스트 재등록 중...')
  installNativeHostWrapper()
  installNativeHostManifest(CWS_EXTENSION_ID)
  s.stop('네이티브 호스트 재등록 완료')

  p.outro(`${CLI_VERSION}으로 업데이트 완료!`)
}
