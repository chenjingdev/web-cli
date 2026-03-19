import type { BrowserClientStatus, GuideReason } from './types'

type StatusPatch = Partial<BrowserClientStatus>

type CreateStatusMachineOptions = {
  companionBaseUrl: string
  updateStatus: (next: StatusPatch) => void
  onGuideRequired?: (reason: GuideReason) => void
}

type ApplyServerStatusOptions = {
  sessionId: string | null
  status?: 'pending' | 'approved' | 'denied'
  active: boolean
  agentActive?: boolean
  agentStopped?: boolean
}

export function createStatusMachine({
  companionBaseUrl,
  updateStatus,
  onGuideRequired,
}: CreateStatusMachineOptions) {
  let guideNotified: GuideReason | null = null

  const emitGuide = (reason: GuideReason) => {
    if (guideNotified === reason) return
    guideNotified = reason
    onGuideRequired?.(reason)
  }

  return {
    resetGuide() {
      guideNotified = null
    },

    applyServerStatus({ sessionId, status, active, agentActive, agentStopped }: ApplyServerStatusOptions) {
      if (status === 'denied') {
        updateStatus({
          state: 'denied',
          companionBaseUrl,
          sessionId,
          active,
          agentActive: false,
          agentStopped: false,
          lastError: null,
        })
        emitGuide('origin-denied')
        return
      }

      if (status === 'pending') {
        updateStatus({
          state: 'pending',
          companionBaseUrl,
          sessionId,
          active,
          agentActive: false,
          agentStopped: false,
          lastError: null,
        })
        emitGuide('origin-pending')
        return
      }

      guideNotified = null
      updateStatus({
        state: active ? 'connected' : 'connecting',
        companionBaseUrl,
        sessionId,
        active,
        agentActive: Boolean(agentActive),
        agentStopped: Boolean(agentStopped),
        lastError: null,
      })
    },

    setConnecting(sessionId: string | null, lastError: string | null = null) {
      updateStatus({
        state: 'connecting',
        companionBaseUrl,
        sessionId,
        active: false,
        agentActive: false,
        agentStopped: false,
        lastError,
      })
    },

    setCompanionUnavailable(sessionId: string | null, lastError: string | null) {
      updateStatus({
        state: 'unavailable',
        companionBaseUrl,
        sessionId,
        active: false,
        agentActive: false,
        agentStopped: false,
        lastError,
      })
      emitGuide('companion-unavailable')
    },

    setRuntimeUnavailable(sessionId: string | null) {
      updateStatus({
        state: 'unavailable',
        companionBaseUrl,
        sessionId,
        active: false,
        agentActive: false,
        agentStopped: false,
        lastError: 'window.webcliDom runtime is unavailable',
      })
      emitGuide('runtime-unavailable')
    },

    setStopped(sessionId: string | null) {
      updateStatus({
        state: 'stopped',
        companionBaseUrl,
        sessionId,
        active: false,
        agentActive: false,
        agentStopped: false,
      })
    },
  }
}
