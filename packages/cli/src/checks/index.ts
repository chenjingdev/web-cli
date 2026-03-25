import type { Check, CheckResult } from './types.js'

export type { Check, CheckResult }

export interface CheckRunResult {
  check: Check
  result: CheckResult
}

export async function runAllChecks(checks: Check[]): Promise<CheckRunResult[]> {
  const results: CheckRunResult[] = []
  for (const check of checks) {
    const result = await check.check()
    results.push({ check, result })
  }
  return results
}
