/**
 * Browser conversation plugin. `contract/` is the shared type boundary
 * between the independently implemented skeleton and chat domains; `apply.ts`
 * owns their slot assembly.
 */
export type {} from '@deepseek-ai/dsh-client-runtime/src/client/chat/assistant.ts'
export type {} from '@deepseek-ai/dsh-client-runtime/src/client/chat/command.ts'
export type {} from '@deepseek-ai/dsh-client-runtime/src/client/chat/compaction.ts'
export type {} from '@deepseek-ai/dsh-client-runtime/src/client/chat/fallback.ts'
export type {} from '@deepseek-ai/dsh-client-runtime/src/client/chat/message.ts'
export type {} from '@deepseek-ai/dsh-client-runtime/src/client/chat/retry.ts'
export type {} from '@deepseek-ai/dsh-client-runtime/src/client/chat/tool.ts'
export type {} from '@deepseek-ai/dsh-client-runtime/src/client/chat/turn-error.ts'
export type {} from '@deepseek-ai/dsh-client-runtime/src/client/chat/turn-max-tokens.ts'
export type {} from '@deepseek-ai/dsh-client-runtime/src/client/chat/turn-tail.ts'

export { apply, inject } from './apply.ts'
export { ConversationController } from './service.ts'
export type { IConversation } from './service.ts'
export type { DraftAttachmentId } from './input/contract.ts'

export type {
  CallId, ChatStoreState, SelectionTarget, ViewTab,
} from './contract/views.ts'
export type { ConversationKey } from './locales.ts'
export type {
  AssistantChatData, ChatNode, ChatNodeDataMap, ChatNodeKind, ManualCompactionChatData,
  RetryChatData, ToolChatData, TurnTailChatData,
} from './contract/chat-nodes.ts'
export type {
  ChatFileMentions, ChatNodeOwnerProps, ChatNodeViewProps,
  ChatStore, ChatViewInjected, ChatViewSlotProps, CommandRowOwnerProps, CommandRowProps, ComposerBarInjected,
  ComposerAttachment, ComposerChainProps, ConversationInjected,
  ConversationSessionHeaderInjected, ConversationSessionInjected, ConversationSlotProps, ConvViewOwnerProps,
  ConvViewProps, DetailsInjected, DetailsSlotProps, DetailsToolOwnerProps, EmptyWorkspaceOwnerProps,
  TurnTailOwnerProps, UseChatNodeTurnData,
} from './contract/slots.ts'
// Export discipline: packages/client/AGENTS.md.

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The outward face only; the concrete service stays inside this plugin. */
    conversation: import('./service.ts').IConversation
  }
}
