import { describe, it, expect } from 'vitest'
import { runAllChecks, type Check } from '../src/checks/index.js'

describe('runAllChecks', () => {
  it('collects results from all checks', async () => {
    const checks: Check[] = [
      {
        name: 'passing check',
        check: async () => ({ ok: true, message: 'good' }),
        fix: async () => {},
      },
      {
        name: 'failing check',
        check: async () => ({ ok: false, message: 'bad' }),
        fix: async () => {},
      },
    ]

    const results = await runAllChecks(checks)
    expect(results).toHaveLength(2)
    expect(results[0].result.ok).toBe(true)
    expect(results[1].result.ok).toBe(false)
  })
})
