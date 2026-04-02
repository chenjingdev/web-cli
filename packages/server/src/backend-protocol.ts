export const BACKEND_HOST = '127.0.0.1'
export const BACKEND_PORT = 47654

export interface BackendHandshakeMessage {
  type: 'backend_handshake'
  role: 'agent-client' | 'native-host'
}

export interface BackendReadyMessage {
  type: 'backend_ready'
  role: 'agent-client' | 'native-host'
}

export interface BackendErrorMessage {
  type: 'backend_error'
  message: string
}

export interface AgentToolCallRequest {
  type: 'agent_request'
  requestId: string
  name: string
  args: Record<string, unknown>
}

export interface AgentToolCallResponse {
  type: 'agent_response'
  requestId: string
  text: string
  isError?: boolean
}

export type BackendControlMessage =
  | BackendHandshakeMessage
  | BackendReadyMessage
  | BackendErrorMessage
  | AgentToolCallRequest
  | AgentToolCallResponse
