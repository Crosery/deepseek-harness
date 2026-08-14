/**
 * Re-export shim: the Chat node business types live in the data layer
 * (packages/client/runtime/src/client/chat). This file keeps every
 * presentation-side import path stable.
 * @module @deepseek-ai/dsh-client-ui-conversation/contract
 */

export type {
  AssistantChatData, ChatNode, ChatNodeDataMap, ChatNodeKind, FinalAssistantChatData,
  ManualCompactionChatData, RetryChatData, ToolChatData, TurnTailChatData,
} from '@deepseek-ai/dsh-client-runtime/client'
export { isRunningTool, isSettledTool } from '@deepseek-ai/dsh-client-runtime/client'
