export { ExtensionDriver } from './extension-driver.js'
export { SessionManager } from './session-manager.js'
export { CommandQueue } from './command-queue.js'
export { ActivityBlockStack } from './activity-tracker.js'
export type { ActivityBlock } from './activity-tracker.js'
export {
  encodeMessage,
  decodeMessages,
  createNativeMessagingTransport,
} from './native-messaging.js'
export type { NativeMessagingTransport } from './native-messaging.js'
