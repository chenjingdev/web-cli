import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMPANION_CONFIG,
  createCommandError,
  isCommandErrorCode,
  mergeCompanionConfig,
  normalizeCompanionConfig,
} from '../src/index'

describe('core helpers', () => {
  it('config 병합 시 patch 값만 덮어쓴다', () => {
    const result = mergeCompanionConfig(DEFAULT_COMPANION_CONFIG, {
      clickDelayMs: 240,
      pointerAnimation: true,
    })

    expect(result).toEqual({
      clickDelayMs: 240,
      pointerAnimation: true,
      autoScroll: true,
      cursorName: 'default',
      auroraGlow: true,
      auroraTheme: 'dark',
    })
  })

  it('invalid config 입력은 기본값으로 정규화한다', () => {
    expect(
      normalizeCompanionConfig({
        clickDelayMs: -10,
      }),
    ).toEqual(DEFAULT_COMPANION_CONFIG)
  })

  it('structured command error를 생성한다', () => {
    const error = createCommandError('TARGET_NOT_FOUND', 'missing target', {
      targetId: 'auth-login',
    })

    expect(isCommandErrorCode(error.code)).toBe(true)
    expect(error.details?.targetId).toBe('auth-login')
  })

  it('AGENT_STOPPED를 유효한 command error code로 인식한다', () => {
    expect(isCommandErrorCode('AGENT_STOPPED')).toBe(true)
  })
})
