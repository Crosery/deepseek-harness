/**
 * Shared Chat business fold: registers every event→node state machine and
 * the `chat` view builder contributed by the data layer. Both client
 * platforms (web ui-conversation, terminal-conversation) register this same
 * fold, so one event log assembles into one snapshot shape everywhere.
 * @module @deepseek-ai/dsh-client-runtime/chat
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerAssistantConversationNode } from './assistant.ts'
import { registerChatConversationView } from './chat-snapshot-builder.ts'
import { registerCommandConversationNode } from './command.ts'
import { registerCompactionConversationNode } from './compaction.ts'
import { registerUnknownConversationFallback } from './fallback.ts'
import { registerInboxConversationNodes } from './inbox.ts'
import { registerMessageConversationNode } from './message.ts'
import { registerRetryConversationNode } from './retry.ts'
import { registerToolConversationNode } from './tool.ts'
import { registerTurnErrorConversationNode } from './turn-error.ts'
import { registerTurnMaxTokensConversationNode } from './turn-max-tokens.ts'
import { registerTurnTailConversationNode } from './turn-tail.ts'
import { deliverablesDefinition } from './turn-deliverables.ts'
import { workflowRunDefinition } from './workflow.ts'

/**
 * Register the Chat business definitions and target builder.
 * @param ctx - client cordis context carrying the conversation registries.
 */
export function registerConversationChat(ctx: Context): void {
  registerInboxConversationNodes(ctx)
  registerMessageConversationNode(ctx)
  registerAssistantConversationNode(ctx)
  registerToolConversationNode(ctx)
  registerCommandConversationNode(ctx)
  registerCompactionConversationNode(ctx)
  registerRetryConversationNode(ctx)
  registerTurnErrorConversationNode(ctx)
  registerTurnMaxTokensConversationNode(ctx)
  registerTurnTailConversationNode(ctx)
  registerUnknownConversationFallback(ctx)
  // State-only contributors: durable workflow-run and produced-file facts
  // fold into turn data and chat nodes for every platform.
  ctx.conversationEvents.register(workflowRunDefinition)
  ctx.conversationEvents.register(deliverablesDefinition)
  registerChatConversationView(ctx)
}
