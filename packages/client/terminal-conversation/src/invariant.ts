/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-terminal-conversation`.
 * @module @deepseek-ai/dsh-client-terminal-conversation/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-terminal-conversation'

/** Cordis companion plugin name. */
export const name = 'client-terminal-conversation-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package is a pure projection of the current
 * session's conversation snapshot onto the terminal. It emits no cordis
 * events, owns no cross-plugin mutable state, and its input handlers unwind
 * with the plugin fiber (proven by the client-context teardown tests).
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
