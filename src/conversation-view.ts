/** Shared presentation runtime. Its legacy file location is not a harness protocol. */
export { mountPiView as mountConversationView } from './pi/webview-client';
export type { PiView as ConversationView, HostMessage as ConversationViewMessage } from './pi/webview-client';
export type { ViewHost as ConversationViewHost } from './pi/view-host';
