export interface CheckResult {
  ok: boolean
  message: string
}

export interface Check {
  name: string
  check: () => Promise<CheckResult>
  fix: () => Promise<void>
}
